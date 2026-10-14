import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type Recording } from "@prisma/client";
import { createHmac, timingSafeEqual } from "node:crypto";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import { RECORDING_OBJECT_STORE, type RecordingObjectStore } from "./recordings-retention";

export interface RecordingStats {
  total: number;
  totalDurationSeconds: number;
  storageBytes: number;
  expiringSoon: number;
}

/** How long a download link stays valid. Short, because it is a bearer token for audio. */
const SIGNED_URL_TTL_SECONDS = 300;

/**
 * Feature List §8 — Recordings.
 *
 * The audio itself never passes through this service. Recordings live in object storage
 * and are reached through a short-lived signed URL, which matters for two reasons: a
 * call recording is among the most sensitive things this product holds, and streaming
 * media through the API would tie up a Node process for the length of a phone call.
 */
@Injectable()
export class RecordingsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaFactory,
    @Inject(RECORDING_OBJECT_STORE) private readonly store: RecordingObjectStore | null,
  ) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  async list(query: {
    search?: string;
    campaignId?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    const where: Prisma.RecordingWhereInput = notExpired();
    const callWhere: Prisma.CallWhereInput = {};

    if (query.campaignId) callWhere.campaignId = query.campaignId;
    if (query.search) {
      const term = query.search.trim();
      callWhere.OR = [
        { phone: { contains: term.replace(/\D/g, "") || term } },
        { lead: { name: { contains: term, mode: "insensitive" } } },
      ];
    }
    if (query.from || query.to) {
      callWhere.startedAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: endOfDay(new Date(query.to)) } : {}),
      };
    }
    if (Object.keys(callWhere).length > 0) where.call = callWhere;

    const data = await this.db.recording.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        call: {
          select: {
            id: true,
            phone: true,
            startedAt: true,
            outcome: true,
            lead: { select: { id: true, name: true, contactPerson: true } },
            aiAgent: { select: { id: true, name: true } },
            campaign: { select: { id: true, name: true } },
            transcript: { select: { id: true } },
          },
        },
      },
    });

    const total = await this.db.recording.count({ where });

    // BigInt does not survive JSON, so sizes are narrowed to Number here. A recording is
    // megabytes, not petabytes, so the precision loss is theoretical.
    return {
      data: data.map((row) => ({ ...row, sizeBytes: Number(row.sizeBytes) })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async stats(): Promise<RecordingStats> {
    const now = new Date();
    const live = notExpired(now);
    const total = await this.db.recording.count({ where: live });
    const sums = await this.db.recording.aggregate({
      where: live,
      _sum: { durationSeconds: true, sizeBytes: true },
    });

    // "Expiring soon" is what makes retention visible before it deletes something. A
    // workspace on a 7-day plan should be able to see what it is about to lose.
    const soon = new Date(now);
    soon.setDate(soon.getDate() + 7);
    const expiringSoon = await this.db.recording.count({
      where: { expiresAt: { gt: now, lte: soon } },
    });

    return {
      total,
      totalDurationSeconds: sums._sum.durationSeconds ?? 0,
      storageBytes: Number(sums._sum.sizeBytes ?? 0),
      expiringSoon,
    };
  }

  /**
   * Issues a short-lived, signed link to the audio.
   *
   * The signature covers the recording id and the expiry, so a link cannot be edited to
   * point at a different recording or to last longer. Tenancy is checked *here*, before
   * anything is signed — the scoped client has already refused to find another
   * workspace's recording by the time this runs, which is what makes the link safe to
   * hand out.
   *
   * Absolute, on the API's own origin: the web app opens it in a new tab or hands it to
   * an <audio> element, and a relative path would resolve against the web app, which has
   * no /api routes.
   *
   * Not a permanent URL, and not the raw storage key: either would be a credential that
   * never expires, sitting in a browser history.
   */
  async signedUrl(id: string): Promise<{ url: string; expiresAt: string }> {
    await this.findLive(id);

    const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
    const signature = this.sign(id, expiresAt);

    return {
      url: `${apiBaseUrl()}/api/recordings/${id}/audio?expires=${expiresAt}&signature=${signature}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  /**
   * Verifies a signature from a download request.
   *
   * `timingSafeEqual` rather than `===`: comparing signatures with a short-circuiting
   * string comparison leaks, byte by byte, how much of a guess was correct.
   */
  verifySignature(id: string, expires: number, signature: string): boolean {
    const secret = signingSecret();
    // Without a secret every signature would be an HMAC under an empty key — something
    // anyone can compute. No secret means no link is valid, not every link.
    if (!secret) return false;
    if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;

    const expected = Buffer.from(hmac(secret, id, expires));
    const provided = Buffer.from(signature);
    if (expected.length !== provided.length) return false;

    return timingSafeEqual(expected, provided);
  }

  /**
   * `Omit` rather than an intersection: `Recording & { sizeBytes: number }` makes the
   * field `bigint & number`, which is `never` — a type that silently accepts nothing.
   * The column is a BigInt in Prisma and a Number on the wire, so the override has to
   * replace it, not add to it.
   */
  async findOne(id: string): Promise<Omit<Recording, "sizeBytes"> & { sizeBytes: number }> {
    const recording = await this.findLive(id);
    return { ...recording, sizeBytes: Number(recording.sizeBytes) };
  }

  /**
   * Deletes a recording at a user's request.
   *
   * While nothing is stored — no object store is bound, so the audio sits at the
   * telephony vendor or nowhere — that is just the row. Once a store exists, the row is
   * instead marked expired, which hides it at once and hands it to the retention sweep:
   * the sweep deletes the stored audio before the row, so a storage failure leaves a row
   * to retry from rather than a file nothing points at.
   */
  async remove(id: string): Promise<void> {
    await this.findLive(id);

    if (this.store) {
      await this.db.recording.updateMany({ where: { id }, data: { expiresAt: new Date() } });
      return;
    }
    await this.db.recording.delete({ where: { id } });
  }

  /**
   * A recording this workspace can still see. One whose expiry has passed is gone as far
   * as the product is concerned, even in the hours before the retention sweep deletes it.
   */
  private async findLive(id: string): Promise<Recording> {
    const recording = await this.db.recording.findFirst({ where: { id, ...notExpired() } });
    if (!recording) throw new NotFoundException("Recording not found");
    return recording;
  }

  private sign(id: string, expires: number): string {
    const secret = signingSecret();
    if (!secret) {
      // Unreachable in a correctly configured deployment — the env check at boot requires
      // JWT_ACCESS_SECRET — but refusing here keeps a misconfiguration from minting links
      // anyone could forge.
      throw new ServiceUnavailableException(
        "Recording links are unavailable because this server has no signing secret.",
      );
    }
    return hmac(secret, id, expires);
  }
}

/** Recordings whose expiry has not passed (or that have none). */
function notExpired(now = new Date()): Prisma.RecordingWhereInput {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

function signingSecret(): string | null {
  const secret = process.env.JWT_ACCESS_SECRET;
  return secret && secret.trim() ? secret : null;
}

function hmac(secret: string, id: string, expires: number): string {
  return createHmac("sha256", secret).update(`${id}.${expires}`).digest("base64url");
}

/**
 * The API's public origin, for links that leave the app. The same variable and the same
 * local fallback as the OAuth callback URL (OAuthService.redirectUri).
 */
function apiBaseUrl(): string {
  const base =
    process.env.API_PUBLIC_URL?.trim() || `http://localhost:${process.env.API_PORT ?? "4000"}`;
  return base.replace(/\/+$/, "");
}

function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}
