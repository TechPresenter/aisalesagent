import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, type Recording } from "@prisma/client";
import { createHmac, timingSafeEqual } from "node:crypto";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";

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
  private readonly logger = new Logger(RecordingsService.name);

  constructor(private readonly tenantPrisma: TenantPrismaFactory) {}

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

    const where: Prisma.RecordingWhereInput = {};
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
    const total = await this.db.recording.count();
    const sums = await this.db.recording.aggregate({
      _sum: { durationSeconds: true, sizeBytes: true },
    });

    // "Expiring soon" is what makes retention visible before it deletes something. A
    // workspace on a 7-day plan should be able to see what it is about to lose.
    const soon = new Date();
    soon.setDate(soon.getDate() + 7);
    const expiringSoon = await this.db.recording.count({
      where: { expiresAt: { not: null, lte: soon } },
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
   * Not a permanent URL, and not the raw storage key: either would be a credential that
   * never expires, sitting in a browser history.
   */
  async signedUrl(id: string): Promise<{ url: string; expiresAt: string }> {
    const recording = await this.db.recording.findUnique({ where: { id } });
    if (!recording) throw new NotFoundException("Recording not found");

    const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
    const signature = this.sign(id, expiresAt);

    return {
      url: `/api/recordings/${id}/audio?expires=${expiresAt}&signature=${signature}`,
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
    if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;

    const expected = Buffer.from(this.sign(id, expires));
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
    const recording = await this.db.recording.findUnique({ where: { id } });
    if (!recording) throw new NotFoundException("Recording not found");
    return { ...recording, sizeBytes: Number(recording.sizeBytes) };
  }

  /**
   * Deletes the metadata row. The object in storage is removed by the same sweep that
   * handles retention — deleting it inline would leave the row gone and the file
   * orphaned if the storage call failed.
   */
  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.db.recording.delete({ where: { id } });
    this.logger.log(`Recording ${id} metadata deleted; object storage sweep will follow.`);
  }

  private sign(id: string, expires: number): string {
    const secret = process.env.JWT_ACCESS_SECRET ?? "";
    return createHmac("sha256", secret).update(`${id}.${expires}`).digest("base64url");
  }
}

function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}
