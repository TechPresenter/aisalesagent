import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";

export interface TranscriptStats {
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  analysed: number;
}

/** A search hit, with the utterance that matched so the reader can see why. */
export interface TranscriptMatch {
  segmentId: string;
  speakerLabel: string;
  text: string;
  startMs: number;
}

const DEFAULT_PAGE_SIZE = 15;

/**
 * Feature List §7 — Transcripts.
 *
 * What separates this screen from Call History is the search: the same rows, found by
 * what was *said* rather than by who was called. That is why the query reaches into
 * `TranscriptSegment` rather than matching a summary — a summary is a paraphrase, and
 * searching one means missing the exact phrase someone typed in.
 */
@Injectable()
export class TranscriptsService {
  constructor(private readonly tenantPrisma: TenantPrismaFactory) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  async list(query: {
    search?: string;
    campaignId?: string;
    agentId?: string;
    outcome?: string[];
    sentiment?: string[];
    page?: number;
    pageSize?: number;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.TranscriptWhereInput = {};
    const callWhere: Prisma.CallWhereInput = {};

    if (query.campaignId) callWhere.campaignId = query.campaignId;
    if (query.agentId) callWhere.aiAgentId = query.agentId;
    if (query.outcome?.length) callWhere.outcome = { in: query.outcome as never };
    if (Object.keys(callWhere).length > 0) where.call = callWhere;

    if (query.sentiment?.length) where.sentiment = { in: query.sentiment as never };

    const term = query.search?.trim();
    if (term) {
      // Matching the words themselves, the summary, or who was called — someone
      // searching "pricing" wants every call where pricing came up, whichever of those
      // it appears in.
      where.OR = [
        { segments: { some: { text: { contains: term, mode: "insensitive" } } } },
        { summary: { contains: term, mode: "insensitive" } },
        { call: { lead: { name: { contains: term, mode: "insensitive" } } } },
      ];
    }

    const rows = await this.db.transcript.findMany({
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
            durationSeconds: true,
            outcome: true,
            status: true,
            lead: { select: { id: true, name: true, contactPerson: true, city: true } },
            aiAgent: { select: { id: true, name: true, language: true } },
            campaign: { select: { id: true, name: true } },
            recording: { select: { id: true, durationSeconds: true } },
          },
        },
        _count: { select: { segments: true } },
      },
    });

    const total = await this.db.transcript.count({ where });

    // The matching utterances, fetched only when there is a search term and only for the
    // page being shown. Returning them lets the list show *why* a row matched, which is
    // the difference between a search result and a list that mysteriously got shorter.
    const matches = term ? await this.matchesFor(rows.map((r) => r.id), term) : new Map();

    return {
      data: rows.map((row) => ({
        ...row,
        segmentCount: row._count.segments,
        matches: matches.get(row.id) ?? [],
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async stats(): Promise<TranscriptStats> {
    const total = await this.db.transcript.count();
    const positive = await this.db.transcript.count({ where: { sentiment: "POSITIVE" } });
    const neutral = await this.db.transcript.count({ where: { sentiment: "NEUTRAL" } });
    const negative = await this.db.transcript.count({ where: { sentiment: "NEGATIVE" } });
    // Analysed rather than merely transcribed: the AI pass is separate and can fail on
    // its own, and the gap between the two is worth being able to see.
    const analysed = await this.db.transcript.count({ where: { analysedAt: { not: null } } });

    return { total, positive, neutral, negative, analysed };
  }

  async findOne(id: string) {
    const transcript = await this.db.transcript.findUnique({
      where: { id },
      include: {
        call: {
          select: {
            id: true,
            phone: true,
            durationSeconds: true,
            startedAt: true,
            outcome: true,
            creditsUsed: true,
            provider: true,
            lead: { select: { id: true, name: true, contactPerson: true, city: true } },
            aiAgent: { select: { id: true, name: true, language: true } },
            campaign: { select: { id: true, name: true } },
            recording: { select: { id: true, durationSeconds: true } },
          },
        },
      },
    });
    if (!transcript) throw new NotFoundException("Transcript not found");
    return transcript;
  }

  async segments(id: string) {
    // Confirming the parent first, so a bad id is a 404 rather than an empty array that
    // reads as "a transcript with nothing in it".
    const exists = await this.db.transcript.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Transcript not found");

    return this.db.transcriptSegment.findMany({
      where: { transcriptId: id },
      orderBy: { sequence: "asc" },
    });
  }

  /** Plain text, for copy and download. */
  async asText(id: string): Promise<string> {
    const transcript = await this.findOne(id);
    const segments = await this.segments(id);

    const header = [
      transcript.call?.lead?.name ?? transcript.call?.phone ?? "Call",
      transcript.call?.startedAt ? new Date(transcript.call.startedAt).toISOString() : "",
    ]
      .filter(Boolean)
      .join(" — ");

    const body = segments.map(
      (segment) => `[${formatOffset(segment.startMs)}] ${segment.speakerLabel}: ${segment.text}`,
    );

    return [header, "", ...body].join("\n");
  }

  /**
   * Up to three matching utterances per transcript.
   *
   * Capped because a long call can contain a common word twenty times, and a search
   * result that unrolls the whole conversation is not a result, it is the transcript.
   */
  private async matchesFor(
    transcriptIds: string[],
    term: string,
  ): Promise<Map<string, TranscriptMatch[]>> {
    if (transcriptIds.length === 0) return new Map();

    const segments = await this.db.transcriptSegment.findMany({
      where: {
        transcriptId: { in: transcriptIds },
        text: { contains: term, mode: "insensitive" },
      },
      orderBy: [{ transcriptId: "asc" }, { sequence: "asc" }],
      select: {
        id: true,
        transcriptId: true,
        speakerLabel: true,
        text: true,
        startMs: true,
      },
    });

    const byTranscript = new Map<string, TranscriptMatch[]>();
    for (const segment of segments) {
      const list = byTranscript.get(segment.transcriptId) ?? [];
      if (list.length >= 3) continue;
      list.push({
        segmentId: segment.id,
        speakerLabel: segment.speakerLabel,
        text: segment.text,
        startMs: segment.startMs,
      });
      byTranscript.set(segment.transcriptId, list);
    }

    return byTranscript;
  }
}

function formatOffset(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
