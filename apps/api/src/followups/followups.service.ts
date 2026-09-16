import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  FollowUpChannel,
  FollowUpStatus,
  Prisma,
  Priority,
  type FollowUp,
} from "@prisma/client";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import { scopedCreate } from "../prisma/tenant-scoped";
import {
  dayBounds,
  deriveStatus,
  dueWindow,
  statusClause,
  type DerivedFollowUpStatus,
  type DueWithin,
} from "./followup-rules";

export type { DerivedFollowUpStatus } from "./followup-rules";

export interface FollowUpStats {
  total: number;
  pending: number;
  completed: number;
  cancelled: number;
  overdue: number;
  today: number;
}

const DEFAULT_PAGE_SIZE = 10;

/**
 * Feature List §10 — Follow-ups & Tasks.
 *
 * The date reasoning this screen turns on lives in followup-rules.ts, deliberately kept
 * free of Prisma and of any clock of its own so the boundaries can be tested at the
 * minute. What is left here is the querying.
 */
@Injectable()
export class FollowUpsService {
  constructor(private readonly tenantPrisma: TenantPrismaFactory) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  /**
   * The workspace's timezone, which every relative date on this screen is measured
   * against. Falls back to UTC rather than the server's locale: a server that is moved
   * between regions must not silently move everyone's idea of "today" with it.
   */
  private async timezone(): Promise<string> {
    const settings = await this.db.tenantSettings.findFirst({ select: { timezone: true } });
    return settings?.timezone ?? "UTC";
  }

  async list(query: {
    search?: string;
    status?: DerivedFollowUpStatus[];
    channel?: FollowUpChannel[];
    priority?: Priority[];
    assigneeId?: string;
    campaignId?: string;
    leadId?: string;
    dueWithin?: DueWithin;
    sort?: "dueAt" | "priority" | "createdAt";
    direction?: "asc" | "desc";
    page?: number;
    pageSize?: number;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const timezone = await this.timezone();
    const bounds = dayBounds(timezone);

    const where: Prisma.FollowUpWhereInput = {};
    if (query.assigneeId) where.assigneeId = query.assigneeId;
    if (query.campaignId) where.campaignId = query.campaignId;
    if (query.leadId) where.leadId = query.leadId;
    if (query.channel?.length) where.channel = { in: query.channel };
    if (query.priority?.length) where.priority = { in: query.priority };

    if (query.search) {
      const term = query.search.trim();
      const digits = term.replace(/\D/g, "");
      where.OR = [
        { notes: { contains: term, mode: "insensitive" } },
        { lead: { name: { contains: term, mode: "insensitive" } } },
        { lead: { contactPerson: { contains: term, mode: "insensitive" } } },
        { lead: { city: { contains: term, mode: "insensitive" } } },
        ...(digits.length >= 3 ? [{ lead: { phone: { contains: digits } } }] : []),
      ];
    }

    // The derived states are stored-status plus a date range, so they translate into a
    // where-clause rather than being filtered in memory after paging — which would make
    // page 2 of "Overdue" a different set of rows than page 1 implied.
    const clauses: Prisma.FollowUpWhereInput[] = [];
    const statusClauses = (query.status ?? []).map((status) => statusClause(status, bounds));
    if (statusClauses.length === 1) clauses.push(statusClauses[0]);
    else if (statusClauses.length > 1) clauses.push({ OR: statusClauses });

    const window = dueWindow(query.dueWithin, timezone);
    if (window) clauses.push({ dueAt: window });

    if (clauses.length > 0) where.AND = clauses;

    const sort = query.sort ?? "dueAt";
    const direction = query.direction ?? "asc";
    const orderBy: Prisma.FollowUpOrderByWithRelationInput[] =
      sort === "priority"
        ? [{ priority: direction }, { dueAt: "asc" }]
        : [{ [sort]: direction }, { id: "asc" }];

    const rows = await this.db.followUp.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: FOLLOWUP_INCLUDE,
    });

    const total = await this.db.followUp.count({ where });

    return {
      data: rows.map((row) => ({ ...row, derivedStatus: deriveStatus(row, bounds) })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async stats(): Promise<FollowUpStats> {
    const bounds = dayBounds(await this.timezone());

    const total = await this.db.followUp.count();
    const pending = await this.db.followUp.count({ where: { status: "PENDING" } });
    const completed = await this.db.followUp.count({ where: { status: "COMPLETED" } });
    const cancelled = await this.db.followUp.count({ where: { status: "CANCELLED" } });
    const overdue = await this.db.followUp.count({
      where: statusClause("OVERDUE", bounds) as Prisma.FollowUpWhereInput,
    });
    const today = await this.db.followUp.count({
      where: statusClause("TODAY", bounds) as Prisma.FollowUpWhereInput,
    });

    return { total, pending, completed, cancelled, overdue, today };
  }

  async findOne(id: string) {
    const bounds = dayBounds(await this.timezone());
    const row = await this.db.followUp.findUnique({ where: { id }, include: FOLLOWUP_INCLUDE });
    if (!row) throw new NotFoundException("Follow-up not found");
    return { ...row, derivedStatus: deriveStatus(row, bounds) };
  }

  async create(input: {
    leadId: string;
    campaignId?: string;
    callId?: string;
    assigneeId?: string;
    dueAt: string;
    channel?: FollowUpChannel;
    priority?: Priority;
    notes?: string;
    remindAt?: string;
  }): Promise<FollowUp> {
    const { userId } = this.tenantPrisma.context;

    const lead = await this.db.lead.findUnique({ where: { id: input.leadId } });
    if (!lead) throw new NotFoundException("That lead does not exist in this workspace.");

    const dueAt = new Date(input.dueAt);
    if (Number.isNaN(dueAt.getTime())) throw new BadRequestException("The due date is not a date.");

    const remindAt = input.remindAt ? new Date(input.remindAt) : null;
    if (remindAt && Number.isNaN(remindAt.getTime())) {
      throw new BadRequestException("The reminder time is not a date.");
    }
    if (remindAt && remindAt > dueAt) {
      throw new BadRequestException("A reminder cannot be set for after the follow-up is due.");
    }

    const followUp = await this.db.followUp.create({
      data: scopedCreate<Prisma.FollowUpUncheckedCreateInput>({
        leadId: input.leadId,
        campaignId: input.campaignId,
        callId: input.callId,
        // Unassigned work is work nobody does, so it falls to whoever booked it unless
        // they named someone else.
        assigneeId: input.assigneeId ?? lead.ownerId ?? userId,
        dueAt,
        channel: input.channel ?? "CALL",
        priority: input.priority ?? "MEDIUM",
        status: "PENDING",
        notes: input.notes,
        remindAt,
        isAiGenerated: false,
      }),
    });

    await this.recordActivity(
      input.leadId,
      "FOLLOWUP_CREATED",
      `Follow-up scheduled for ${dueAt.toISOString().slice(0, 10)}`,
    );

    return followUp;
  }

  async update(
    id: string,
    input: {
      dueAt?: string;
      assigneeId?: string | null;
      channel?: FollowUpChannel;
      priority?: Priority;
      notes?: string;
      remindAt?: string | null;
      status?: FollowUpStatus;
    },
  ): Promise<FollowUp> {
    const existing = await this.db.followUp.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Follow-up not found");

    const data: Prisma.FollowUpUncheckedUpdateInput = {};

    if (input.dueAt !== undefined) {
      const dueAt = new Date(input.dueAt);
      if (Number.isNaN(dueAt.getTime())) throw new BadRequestException("The due date is not a date.");
      data.dueAt = dueAt;
      // A rescheduled follow-up has not had its reminder sent for the new time, whatever
      // happened at the old one — otherwise moving a task forward silently loses its alert.
      data.reminderSentAt = null;
    }
    if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId;
    if (input.channel !== undefined) data.channel = input.channel;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.remindAt !== undefined) {
      data.remindAt = input.remindAt ? new Date(input.remindAt) : null;
      data.reminderSentAt = null;
    }

    if (input.status !== undefined && input.status !== existing.status) {
      data.status = input.status;
      data.completedAt = input.status === "COMPLETED" ? new Date() : null;
      if (input.status === "COMPLETED") {
        await this.recordActivity(existing.leadId, "FOLLOWUP_COMPLETED", "Follow-up completed");
      }
    }

    return this.db.followUp.update({ where: { id }, data });
  }

  /**
   * Marks follow-ups done in one call.
   *
   * Written as one `updateMany` filtered on `status: PENDING` rather than a loop of
   * updates: it is a single statement, and the filter means completing a list someone
   * else has already worked through does not overwrite their completion timestamps with
   * this moment.
   */
  async completeMany(ids: string[]): Promise<{ completed: number }> {
    if (ids.length === 0) return { completed: 0 };

    const targets = await this.db.followUp.findMany({
      where: { id: { in: ids }, status: "PENDING" },
      select: { id: true, leadId: true },
    });

    if (targets.length === 0) return { completed: 0 };

    const result = await this.db.followUp.updateMany({
      where: { id: { in: targets.map((t) => t.id) }, status: "PENDING" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    for (const target of targets) {
      await this.recordActivity(target.leadId, "FOLLOWUP_COMPLETED", "Follow-up completed");
    }

    return { completed: result.count };
  }

  async remove(id: string): Promise<void> {
    const existing = await this.db.followUp.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Follow-up not found");
    await this.db.followUp.delete({ where: { id } });
  }

  /** Best-effort timeline row; see LeadsService.record for why this never throws. */
  private async recordActivity(
    leadId: string,
    type: "FOLLOWUP_CREATED" | "FOLLOWUP_COMPLETED",
    summary: string,
  ): Promise<void> {
    try {
      await this.db.leadActivity.create({
        data: scopedCreate<Prisma.LeadActivityUncheckedCreateInput>({
          leadId,
          actorId: this.tenantPrisma.context.userId,
          type,
          summary,
        }),
      });
    } catch {
      /* a missing timeline row must not fail the action the user just took */
    }
  }
}

const FOLLOWUP_INCLUDE = {
  lead: {
    select: {
      id: true,
      name: true,
      contactPerson: true,
      phone: true,
      city: true,
      status: true,
      score: true,
    },
  },
  campaign: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  call: {
    select: {
      id: true,
      startedAt: true,
      durationSeconds: true,
      outcome: true,
      aiAgent: { select: { id: true, name: true, language: true } },
    },
  },
} satisfies Prisma.FollowUpInclude;
