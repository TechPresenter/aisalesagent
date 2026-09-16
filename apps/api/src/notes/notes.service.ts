import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { NoteType, Prisma, Sentiment, type SalesNote } from "@prisma/client";
import { hasPermission, type Role } from "@appsgain/shared";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import { scopedCreate } from "../prisma/tenant-scoped";

export interface NoteStats {
  total: number;
  positive: number;
  aiGenerated: number;
  edited: number;
  byType: { type: NoteType; count: number }[];
}

const DEFAULT_PAGE_SIZE = 15;

/**
 * Feature List §9 — Sales Notes.
 *
 * The distinction this service exists to keep straight: a note is either something a
 * person wrote or something the AI produced, and once a person edits an AI note it
 * becomes theirs. `isAiGenerated` flips to false on the first human edit, because a note
 * still labelled "AI-generated" after someone rewrote it misattributes their words to a
 * machine — and, worse, invites a reader to discount something a colleague actually said.
 */
@Injectable()
export class NotesService {
  constructor(private readonly tenantPrisma: TenantPrismaFactory) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  async list(query: {
    search?: string;
    leadId?: string;
    campaignId?: string;
    type?: NoteType[];
    sentiment?: Sentiment[];
    authorId?: string;
    aiOnly?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.SalesNoteWhereInput = {};
    if (query.leadId) where.leadId = query.leadId;
    if (query.campaignId) where.campaignId = query.campaignId;
    if (query.type?.length) where.type = { in: query.type };
    if (query.sentiment?.length) where.sentiment = { in: query.sentiment };
    if (query.authorId) where.authorId = query.authorId;
    if (query.aiOnly !== undefined) where.isAiGenerated = query.aiOnly;

    if (query.search) {
      const term = query.search.trim();
      where.OR = [
        { title: { contains: term, mode: "insensitive" } },
        { content: { contains: term, mode: "insensitive" } },
        { lead: { name: { contains: term, mode: "insensitive" } } },
        { lead: { contactPerson: { contains: term, mode: "insensitive" } } },
      ];
    }

    const data = await this.db.salesNote.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        lead: { select: { id: true, name: true, contactPerson: true, city: true } },
        author: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        call: {
          select: {
            id: true,
            startedAt: true,
            durationSeconds: true,
            outcome: true,
            aiAgent: { select: { id: true, name: true } },
          },
        },
      },
    });

    const total = await this.db.salesNote.count({ where });

    return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async stats(): Promise<NoteStats> {
    const total = await this.db.salesNote.count();
    const positive = await this.db.salesNote.count({ where: { sentiment: "POSITIVE" } });
    const aiGenerated = await this.db.salesNote.count({ where: { isAiGenerated: true } });
    // Edited counts AI notes a human has since revised — the measure of how much the
    // AI's output is actually trusted as written.
    const edited = await this.db.salesNote.count({ where: { editedAt: { not: null } } });

    const groups = await this.db.salesNote.groupBy({
      by: ["type"],
      _count: { _all: true },
    });

    return {
      total,
      positive,
      aiGenerated,
      edited,
      byType: groups.map((g) => ({ type: g.type, count: g._count._all })),
    };
  }

  async findOne(id: string) {
    const note = await this.db.salesNote.findUnique({
      where: { id },
      include: {
        lead: { select: { id: true, name: true, contactPerson: true, city: true } },
        author: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        call: {
          select: {
            id: true,
            startedAt: true,
            durationSeconds: true,
            outcome: true,
            aiAgent: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!note) throw new NotFoundException("Note not found");
    return note;
  }

  async create(input: {
    leadId: string;
    callId?: string;
    campaignId?: string;
    title?: string;
    content: string;
    type?: NoteType;
    sentiment?: Sentiment;
  }): Promise<SalesNote> {
    const { userId } = this.tenantPrisma.context;

    // Checked rather than left to the foreign key: "Foreign key violation" is not
    // something to show a salesperson, and the scoped client would reject another
    // tenant's lead id with exactly that.
    const lead = await this.db.lead.findUnique({ where: { id: input.leadId } });
    if (!lead) throw new NotFoundException("That lead does not exist in this workspace.");

    if (input.callId) {
      const call = await this.db.call.findUnique({ where: { id: input.callId } });
      if (!call) throw new NotFoundException("That call does not exist in this workspace.");
    }

    const note = await this.db.salesNote.create({
      data: scopedCreate<Prisma.SalesNoteUncheckedCreateInput>({
        leadId: input.leadId,
        callId: input.callId,
        campaignId: input.campaignId,
        authorId: userId,
        title: input.title,
        content: input.content,
        type: input.type ?? "GENERAL",
        sentiment: input.sentiment,
        // Written by a person through this endpoint, so never AI-generated. The pipeline
        // writes its own notes directly and sets this itself.
        isAiGenerated: false,
      }),
    });

    await this.db.leadActivity.create({
      data: scopedCreate<Prisma.LeadActivityUncheckedCreateInput>({
        leadId: input.leadId,
        actorId: userId,
        type: "NOTE_ADDED",
        summary: input.title?.trim() || truncate(input.content, 80),
      }),
    });

    return note;
  }

  /**
   * Edits a note.
   *
   * Authorship matters here: anyone with `notes.edit` may revise an AI-generated note —
   * that is the point of AI drafts — but a note a colleague wrote is theirs, and only its
   * author or someone who can delete notes may rewrite it. Silently letting anyone
   * overwrite a teammate's account of a call would make the record untrustworthy.
   */
  async update(
    id: string,
    input: { title?: string; content?: string; type?: NoteType; sentiment?: Sentiment },
    actor: { userId: string; role: Role },
  ): Promise<SalesNote> {
    const existing = await this.db.salesNote.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Note not found");

    const isOwn = existing.authorId === actor.userId;
    const mayEditOthers = hasPermission(actor.role, "notes.delete");

    if (!existing.isAiGenerated && !isOwn && !mayEditOthers) {
      throw new ForbiddenException(
        "This note was written by someone else. Ask them to change it, or add your own.",
      );
    }

    const contentChanged = input.content !== undefined && input.content !== existing.content;

    return this.db.salesNote.update({
      where: { id },
      data: {
        title: input.title,
        content: input.content,
        type: input.type,
        sentiment: input.sentiment,
        // The first human edit takes ownership: the text is no longer what the AI wrote.
        ...(existing.isAiGenerated && contentChanged
          ? { isAiGenerated: false, authorId: actor.userId, editedAt: new Date() }
          : contentChanged
            ? { editedAt: new Date() }
            : {}),
      },
    });
  }

  async remove(id: string, actor: { userId: string; role: Role }): Promise<void> {
    const existing = await this.db.salesNote.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Note not found");

    const isOwn = existing.authorId === actor.userId;
    if (!isOwn && !hasPermission(actor.role, "notes.delete")) {
      throw new ForbiddenException("You can only delete notes you wrote.");
    }

    await this.db.salesNote.delete({ where: { id } });
  }
}

function truncate(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}
