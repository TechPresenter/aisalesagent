import type { PrismaService } from "../prisma/prisma.service";
import {
  DEFAULT_RETENTION_DAYS,
  RecordingsRetention,
  effectiveRetentionDays,
  retentionCutoff,
  type RecordingObjectStore,
} from "./recordings-retention";

/**
 * The sweep only ever deletes, so most of these tests are about what it must *not* do:
 * delete before the stored audio is gone, spin forever on audio it cannot delete, run
 * past its deadline, or touch a workspace with nothing due. The SQL itself is exercised
 * against Postgres in test/recordings.e2e-spec.ts.
 */

const DAY = 86_400_000;
const NOW = new Date("2026-10-14T00:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

describe("effectiveRetentionDays", () => {
  it("uses a workspace's own whole number of days", () => {
    expect(effectiveRetentionDays(30)).toBe(30);
    expect(effectiveRetentionDays(1)).toBe(1);
  });

  it.each([null, undefined, 0, -7, 1.5, Number.NaN])(
    "treats %p as not chosen, giving the 180-day default",
    (value) => {
      expect(effectiveRetentionDays(value)).toBe(DEFAULT_RETENTION_DAYS);
      expect(DEFAULT_RETENTION_DAYS).toBe(180);
    },
  );

  it("puts the cutoff that many days before now", () => {
    expect(retentionCutoff(NOW, 30)).toEqual(daysAgo(30));
    expect(retentionCutoff(NOW, null)).toEqual(daysAgo(180));
  });
});

interface RecordingRow {
  id: string;
  tenantId: string;
  createdAt: Date;
  expiresAt: Date | null;
  storageBucket: string;
  storageKey: string;
}
interface TranscriptRow {
  id: string;
  tenantId: string;
  createdAt: Date;
}
interface SegmentRow {
  id: string;
  tenantId: string;
  transcriptId: string;
}
interface SettingsRow {
  tenantId: string;
  recordingRetentionDays: number | null;
  transcriptRetentionDays: number | null;
}

/**
 * Just enough of PrismaService for the sweep: the two aggregates, the settings read and a
 * tenant-scoped client that understands the exact filters the sweep sends.
 */
function fakePrisma(data: {
  recordings?: RecordingRow[];
  transcripts?: TranscriptRow[];
  segments?: SegmentRow[];
  settings?: SettingsRow[];
}) {
  const recordings = [...(data.recordings ?? [])];
  const transcripts = [...(data.transcripts ?? [])];
  const segments = [...(data.segments ?? [])];
  const settings = data.settings ?? [];

  const min = (dates: (Date | null)[]) => {
    const present = dates.filter((d): d is Date => d !== null);
    return present.length ? new Date(Math.min(...present.map((d) => d.getTime()))) : null;
  };
  const byTenant = <T extends { tenantId: string }>(rows: T[]) =>
    [...new Set(rows.map((r) => r.tenantId))].map((tenantId) => ({
      tenantId,
      rows: rows.filter((r) => r.tenantId === tenantId),
    }));
  const removeWhere = <T>(rows: T[], match: (row: T) => boolean) => {
    let count = 0;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (match(rows[i])) {
        rows.splice(i, 1);
        count += 1;
      }
    }
    return { count };
  };

  const forTenant = jest.fn((tenantId: string) => ({
    recording: {
      findMany: async (args: {
        where: {
          id: { notIn: string[] };
          OR: [{ expiresAt: { lte: Date } }, { createdAt: { lt: Date } }];
        };
        take: number;
      }) => {
        const [{ expiresAt: expiry }, { createdAt: age }] = args.where.OR;
        return recordings
          .filter(
            (r) =>
              r.tenantId === tenantId &&
              !args.where.id.notIn.includes(r.id) &&
              ((r.expiresAt !== null && r.expiresAt <= expiry.lte) || r.createdAt < age.lt),
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(0, args.take);
      },
      deleteMany: async (args: { where: { id: { in: string[] } } }) =>
        removeWhere(recordings, (r) => r.tenantId === tenantId && args.where.id.in.includes(r.id)),
    },
    transcript: {
      findMany: async (args: { where: { createdAt: { lt: Date } }; take: number }) =>
        transcripts
          .filter((t) => t.tenantId === tenantId && t.createdAt < args.where.createdAt.lt)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(0, args.take),
      deleteMany: async (args: { where: { id: { in: string[] } } }) =>
        removeWhere(transcripts, (t) => t.tenantId === tenantId && args.where.id.in.includes(t.id)),
    },
    transcriptSegment: {
      deleteMany: async (args: { where: { transcriptId: { in: string[] } } }) =>
        removeWhere(
          segments,
          (s) => s.tenantId === tenantId && args.where.transcriptId.in.includes(s.transcriptId),
        ),
    },
    $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
  }));

  const prisma = {
    recording: {
      groupBy: async () =>
        byTenant(recordings).map(({ tenantId, rows }) => ({
          tenantId,
          _min: {
            createdAt: min(rows.map((r) => r.createdAt)),
            expiresAt: min(rows.map((r) => r.expiresAt)),
          },
        })),
    },
    transcript: {
      groupBy: async () =>
        byTenant(transcripts).map(({ tenantId, rows }) => ({
          tenantId,
          _min: { createdAt: min(rows.map((t) => t.createdAt)) },
        })),
    },
    tenantSettings: {
      findMany: async (args: { where: { tenantId: { in: string[] } } }) =>
        settings.filter((s) => args.where.tenantId.in.includes(s.tenantId)),
    },
    forTenant,
  } as unknown as PrismaService;

  return { prisma, forTenant, recordings, transcripts, segments };
}

function recording(
  id: string,
  tenantId: string,
  createdDaysAgo: number,
  expiresAt: Date | null = null,
): RecordingRow {
  return {
    id,
    tenantId,
    createdAt: daysAgo(createdDaysAgo),
    expiresAt,
    storageBucket: "recordings",
    storageKey: `${tenantId}/${id}.mp3`,
  };
}

describe("RecordingsRetention.sweep", () => {
  it("deletes recordings past expiry or past the workspace's retention, and nothing younger", async () => {
    const db = fakePrisma({
      recordings: [
        recording("expired", "t1", 5, daysAgo(1)),
        recording("old", "t1", 181),
        recording("fresh", "t1", 5),
        recording("expires-later", "t1", 5, new Date(NOW.getTime() + DAY)),
        recording("t2-past-30", "t2", 31),
        recording("t2-within-30", "t2", 29),
      ],
      settings: [{ tenantId: "t2", recordingRetentionDays: 30, transcriptRetentionDays: null }],
    });

    const result = await new RecordingsRetention(db.prisma, null).sweep({ now: NOW, batchSize: 1 });

    expect(db.recordings.map((r) => r.id).sort()).toEqual([
      "expires-later",
      "fresh",
      "t2-within-30",
    ]);
    expect(result).toEqual({
      recordingsDeleted: 3,
      recordingsKept: 0,
      transcriptsDeleted: 0,
      segmentsDeleted: 0,
      complete: true,
    });
  });

  it("deletes transcripts and their segments past the workspace's transcript retention", async () => {
    const db = fakePrisma({
      transcripts: [
        { id: "old", tenantId: "t1", createdAt: daysAgo(200) },
        { id: "fresh", tenantId: "t1", createdAt: daysAgo(100) },
        { id: "t2-old", tenantId: "t2", createdAt: daysAgo(11) },
      ],
      segments: [
        { id: "s1", tenantId: "t1", transcriptId: "old" },
        { id: "s2", tenantId: "t1", transcriptId: "old" },
        { id: "s3", tenantId: "t1", transcriptId: "fresh" },
        { id: "s4", tenantId: "t2", transcriptId: "t2-old" },
      ],
      settings: [{ tenantId: "t2", recordingRetentionDays: null, transcriptRetentionDays: 10 }],
    });

    const result = await new RecordingsRetention(db.prisma, null).sweep({ now: NOW });

    expect(db.transcripts.map((t) => t.id)).toEqual(["fresh"]);
    expect(db.segments.map((s) => s.id)).toEqual(["s3"]);
    expect(result.transcriptsDeleted).toBe(2);
    expect(result.segmentsDeleted).toBe(3);
  });

  it("never opens a workspace that has nothing past retention", async () => {
    const db = fakePrisma({
      recordings: [recording("fresh", "t1", 10)],
      transcripts: [{ id: "fresh", tenantId: "t1", createdAt: daysAgo(10) }],
    });

    await new RecordingsRetention(db.prisma, null).sweep({ now: NOW });

    expect(db.forTenant).not.toHaveBeenCalled();
  });

  it("deletes the stored audio before the row", async () => {
    const order: string[] = [];
    const db = fakePrisma({ recordings: [recording("old", "t1", 200)] });
    const store: RecordingObjectStore = {
      deleteObject: jest.fn(async ({ key }) => {
        order.push(`object:${key}`);
        expect(db.recordings).toHaveLength(1);
      }),
    };

    await new RecordingsRetention(db.prisma, store).sweep({ now: NOW });

    expect(order).toEqual(["object:t1/old.mp3"]);
    expect(store.deleteObject).toHaveBeenCalledWith({ bucket: "recordings", key: "t1/old.mp3" });
    expect(db.recordings).toHaveLength(0);
  });

  it("keeps the row when its audio cannot be deleted, and does not retry it in the same pass", async () => {
    const db = fakePrisma({
      recordings: [recording("stuck", "t1", 200), recording("ok", "t1", 199)],
    });
    const store: RecordingObjectStore = {
      deleteObject: jest.fn(async ({ key }) => {
        if (key.endsWith("stuck.mp3")) throw new Error("bucket unavailable");
      }),
    };

    const result = await new RecordingsRetention(db.prisma, store).sweep({
      now: NOW,
      batchSize: 1,
    });

    expect(db.recordings.map((r) => r.id)).toEqual(["stuck"]);
    expect(result.recordingsDeleted).toBe(1);
    expect(result.recordingsKept).toBe(1);
    expect(store.deleteObject).toHaveBeenCalledTimes(2);
  });

  it("stops at the deadline and says the sweep is incomplete", async () => {
    const db = fakePrisma({
      recordings: [recording("a", "t1", 200), recording("b", "t1", 201)],
    });

    const result = await new RecordingsRetention(db.prisma, null).sweep({
      now: NOW,
      deadline: Date.now() - 1,
    });

    expect(result.complete).toBe(false);
    expect(db.recordings).toHaveLength(2);
  });
});
