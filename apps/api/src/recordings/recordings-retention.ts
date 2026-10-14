import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * How long recordings and transcripts are kept when a workspace has not chosen a period.
 *
 * 180 days is the TRD's default ("call-recording retention is configurable per tenant
 * (default 180 days)", docs/trd.md, Compliance). It applies to transcripts too: a
 * transcript is the same conversation in text, and keeping the words after the audio is
 * gone would defeat the point of deleting the audio.
 */
export const DEFAULT_RETENTION_DAYS = 180;

/**
 * Rows looked at, and deleted, per statement. Small enough that one batch is a short
 * statement on a serverless database, large enough that a backlog clears in one pass.
 */
export const RETENTION_BATCH_SIZE = 500;

const DAY_MS = 86_400_000;

/**
 * Where a stored recording's audio is deleted from.
 *
 * Nothing provides one yet: recordings point at the telephony vendor's own URL
 * (`storageBucket: "provider"`) because no storage adapter exists. RecordingsModule binds
 * RECORDING_OBJECT_STORE to null until one does, and both the retention sweep and
 * RecordingsService.remove() change behaviour when it is bound — the sweep deletes each
 * object before its row, and a user's delete marks the row for the sweep instead of
 * removing it outright.
 */
export interface RecordingObjectStore {
  /**
   * Deletes one object. Resolves when it is gone, including when it was already gone or
   * lives in a bucket the store does not manage (a vendor URL, say); rejects only when
   * the object may still exist, so its row is kept for the next sweep to retry.
   */
  deleteObject(location: { bucket: string; key: string }): Promise<void>;
}

export const RECORDING_OBJECT_STORE = Symbol("RECORDING_OBJECT_STORE");

export interface RetentionSweepOptions {
  /** The moment retention is judged against. Defaults to the start of the sweep. */
  now?: Date;
  /**
   * Epoch milliseconds after which no new batch is started, so a scheduler with a time
   * limit can bound the sweep. Whatever is left is picked up by the next run.
   */
  deadline?: number;
  batchSize?: number;
}

export interface RetentionSweepResult {
  recordingsDeleted: number;
  /** Recordings past retention whose stored audio could not be deleted, kept for a retry. */
  recordingsKept: number;
  transcriptsDeleted: number;
  segmentsDeleted: number;
  /** False when the deadline stopped the sweep with work left over. */
  complete: boolean;
}

/**
 * The retention period a workspace setting resolves to.
 *
 * Anything other than a whole number of days, one or more, means "not chosen". A zero
 * here would delete every recording the moment the sweep next runs, and nothing in the
 * product sets one on purpose — so it is treated as missing rather than obeyed.
 */
export function effectiveRetentionDays(configured: number | null | undefined): number {
  return typeof configured === "number" && Number.isInteger(configured) && configured >= 1
    ? configured
    : DEFAULT_RETENTION_DAYS;
}

/** Rows created before this moment are past a retention period of `configured` days. */
export function retentionCutoff(now: Date, configured: number | null | undefined): Date {
  return new Date(now.getTime() - effectiveRetentionDays(configured) * DAY_MS);
}

interface RetentionPolicy {
  recordingCutoff: Date;
  transcriptCutoff: Date;
}

/**
 * Deletes call recordings and transcripts that a workspace's retention no longer allows
 * it to keep (Feature List §8, docs/trd.md Compliance).
 *
 * A recording goes when its `expiresAt` has passed, or when it is older than the
 * workspace's `recordingRetentionDays`. A transcript, which has no expiry of its own, goes
 * when it is older than `transcriptRetentionDays`, together with its segments. Either
 * setting left empty means DEFAULT_RETENTION_DAYS. The plan catalogue's own
 * `recordingRetentionDays` is not consulted: whether a plan can shorten what a workspace
 * keeps is a pricing decision that has not been made, and this sweep only ever deletes.
 *
 * Like the integrations worker, it reads through the unscoped PrismaService because "what
 * is past retention, in any workspace?" has no single tenant to ask. It reads only tenant
 * ids and dates that way, and does every delete through that workspace's scoped client.
 *
 * It runs from the background worker, not from a request; nothing here is reachable over
 * HTTP. Running it twice, or on two instances at once, is safe: a second delete of the
 * same rows deletes nothing.
 */
@Injectable()
export class RecordingsRetention {
  private readonly logger = new Logger(RecordingsRetention.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(RECORDING_OBJECT_STORE) private readonly store: RecordingObjectStore | null,
  ) {}

  async sweep(options: RetentionSweepOptions = {}): Promise<RetentionSweepResult> {
    const now = options.now ?? new Date();
    const batchSize = Math.max(1, options.batchSize ?? RETENTION_BATCH_SIZE);
    const outOfTime = () => options.deadline !== undefined && Date.now() >= options.deadline;
    const result: RetentionSweepResult = {
      recordingsDeleted: 0,
      recordingsKept: 0,
      transcriptsDeleted: 0,
      segmentsDeleted: 0,
      complete: true,
    };

    // One aggregate per table finds the workspaces with anything old enough to matter, so
    // a workspace with nothing due costs nothing beyond its row in this result.
    const [recordingGroups, transcriptGroups] = await Promise.all([
      this.prisma.recording.groupBy({
        by: ["tenantId"],
        _min: { createdAt: true, expiresAt: true },
      }),
      this.prisma.transcript.groupBy({ by: ["tenantId"], _min: { createdAt: true } }),
    ]);
    const policies = await this.policies(
      [...recordingGroups, ...transcriptGroups].map((group) => group.tenantId),
      now,
    );

    for (const group of recordingGroups) {
      const policy = policies.get(group.tenantId) ?? this.defaultPolicy(now);
      const { createdAt: oldest, expiresAt: soonestExpiry } = group._min;
      const due =
        (soonestExpiry !== null && soonestExpiry <= now) ||
        (oldest !== null && oldest < policy.recordingCutoff);
      if (!due) continue;

      // eslint-disable-next-line no-await-in-loop
      const finished = await this.sweepRecordings(
        group.tenantId,
        now,
        policy.recordingCutoff,
        batchSize,
        outOfTime,
        result,
      );
      if (!finished) return this.stopped(result);
    }

    for (const group of transcriptGroups) {
      const policy = policies.get(group.tenantId) ?? this.defaultPolicy(now);
      const oldest = group._min.createdAt;
      if (oldest === null || oldest >= policy.transcriptCutoff) continue;

      // eslint-disable-next-line no-await-in-loop
      const finished = await this.sweepTranscripts(
        group.tenantId,
        policy.transcriptCutoff,
        batchSize,
        outOfTime,
        result,
      );
      if (!finished) return this.stopped(result);
    }

    this.report(result);
    return result;
  }

  /**
   * Deletes one workspace's recordings past retention, a batch at a time. Returns false
   * when the deadline stopped it.
   *
   * With an object store bound, each recording's audio is deleted before its row: the row
   * is the only record of where the audio is, so removing it first would orphan the file
   * for good if the storage call then failed. A recording whose audio could not be
   * deleted keeps its row and is skipped for the rest of this pass, so one stuck object
   * cannot hold the sweep in a loop; the next sweep tries it again.
   */
  private async sweepRecordings(
    tenantId: string,
    now: Date,
    cutoff: Date,
    batchSize: number,
    outOfTime: () => boolean,
    result: RetentionSweepResult,
  ): Promise<boolean> {
    const db = this.prisma.forTenant(tenantId);
    const kept: string[] = [];

    for (;;) {
      if (outOfTime()) return false;

      // eslint-disable-next-line no-await-in-loop
      const rows = await db.recording.findMany({
        where: {
          id: { notIn: kept },
          OR: [{ expiresAt: { lte: now } }, { createdAt: { lt: cutoff } }],
        },
        select: { id: true, storageBucket: true, storageKey: true },
        orderBy: { createdAt: "asc" },
        take: batchSize,
      });
      if (rows.length === 0) return true;

      const removable: string[] = [];
      for (const row of rows) {
        // eslint-disable-next-line no-await-in-loop
        if (await this.deleteStoredAudio(row)) removable.push(row.id);
        else kept.push(row.id);
      }

      if (removable.length > 0) {
        // eslint-disable-next-line no-await-in-loop
        const { count } = await db.recording.deleteMany({ where: { id: { in: removable } } });
        result.recordingsDeleted += count;
      }
      result.recordingsKept += rows.length - removable.length;

      if (rows.length < batchSize) return true;
    }
  }

  /**
   * Deletes one workspace's transcripts past retention, segments first, in one
   * transaction per batch. The foreign key would cascade the segments anyway; deleting
   * them explicitly keeps each batch's size visible and the count reportable.
   */
  private async sweepTranscripts(
    tenantId: string,
    cutoff: Date,
    batchSize: number,
    outOfTime: () => boolean,
    result: RetentionSweepResult,
  ): Promise<boolean> {
    const db = this.prisma.forTenant(tenantId);

    for (;;) {
      if (outOfTime()) return false;

      // eslint-disable-next-line no-await-in-loop
      const rows = await db.transcript.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: batchSize,
      });
      if (rows.length === 0) return true;

      const ids = rows.map((row) => row.id);
      // eslint-disable-next-line no-await-in-loop
      const [segments, transcripts] = await db.$transaction([
        db.transcriptSegment.deleteMany({ where: { transcriptId: { in: ids } } }),
        db.transcript.deleteMany({ where: { id: { in: ids } } }),
      ]);
      result.segmentsDeleted += segments.count;
      result.transcriptsDeleted += transcripts.count;

      if (rows.length < batchSize) return true;
    }
  }

  /** True when the recording's audio is gone (or there is no store to hold any). */
  private async deleteStoredAudio(row: {
    id: string;
    storageBucket: string;
    storageKey: string;
  }): Promise<boolean> {
    if (!this.store) return true;
    try {
      await this.store.deleteObject({ bucket: row.storageBucket, key: row.storageKey });
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      this.logger.warn(`Could not delete stored audio for recording ${row.id}: ${reason}`);
      return false;
    }
  }

  /** Each workspace's cutoffs. A workspace with no settings row gets the defaults. */
  private async policies(tenantIds: string[], now: Date): Promise<Map<string, RetentionPolicy>> {
    const unique = [...new Set(tenantIds)];
    if (unique.length === 0) return new Map();

    const settings = await this.prisma.tenantSettings.findMany({
      where: { tenantId: { in: unique } },
      select: { tenantId: true, recordingRetentionDays: true, transcriptRetentionDays: true },
    });
    return new Map(
      settings.map((row) => [
        row.tenantId,
        {
          recordingCutoff: retentionCutoff(now, row.recordingRetentionDays),
          transcriptCutoff: retentionCutoff(now, row.transcriptRetentionDays),
        },
      ]),
    );
  }

  private defaultPolicy(now: Date): RetentionPolicy {
    const cutoff = retentionCutoff(now, null);
    return { recordingCutoff: cutoff, transcriptCutoff: cutoff };
  }

  private stopped(result: RetentionSweepResult): RetentionSweepResult {
    result.complete = false;
    this.report(result);
    return result;
  }

  /** One line when something was deleted or kept; ids and counts only, never content. */
  private report(result: RetentionSweepResult): void {
    const touched =
      result.recordingsDeleted + result.recordingsKept + result.transcriptsDeleted > 0;
    if (!touched) return;
    this.logger.log(
      `Retention sweep deleted ${result.recordingsDeleted} recording(s) and ` +
        `${result.transcriptsDeleted} transcript(s) with ${result.segmentsDeleted} segment(s)` +
        (result.recordingsKept > 0
          ? `; kept ${result.recordingsKept} recording(s) whose audio could not be deleted`
          : "") +
        (result.complete ? "." : "; stopped at the deadline, the next sweep continues."),
    );
  }
}
