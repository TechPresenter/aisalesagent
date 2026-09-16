import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { CampaignStatus, Prisma, type Campaign } from "@prisma/client";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import { scopedCreate } from "../prisma/tenant-scoped";
import type {
  AddCampaignLeadsDto,
  CreateCampaignDto,
  ListCampaignsDto,
  UpdateCampaignDto,
} from "./dto/campaign.dto";

/** The performance figures the list and detail views show, counted per campaign. */
export interface CampaignStats {
  leads: number;
  calls: number;
  connected: number;
  interested: number;
  demoBooked: number;
  converted: number;
  followUps: number;
  creditsUsed: number;
  /** Percentages, rounded, of leads rather than of calls — the denominator people mean. */
  connectRate: number;
  conversionRate: number;
}

export type CampaignWithStats = Campaign & { stats: CampaignStats };

/** The KPI strip, the status donut and the 30-day series behind the Campaigns screen. */
export interface CampaignOverview {
  totalCampaigns: number;
  activeCampaigns: number;
  leadsReached: number;
  callsMade: number;
  conversions: number;
  statusBreakdown: { status: CampaignStatus; count: number }[];
  /** One point per day for the last 30 days, oldest first. */
  series: { date: string; calls: number; connected: number; conversions: number }[];
}

export interface PaginatedCampaigns {
  data: CampaignWithStats[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const DEFAULT_PAGE_SIZE = 25;

/**
 * The legal status transitions.
 *
 * Written as a table rather than as `if` statements scattered through the service,
 * because the interesting question — "can this campaign go from here to there" — should
 * have exactly one answer in exactly one place. ARCHIVED is terminal: a campaign that
 * has been archived stays archived, and reviving one is a duplicate, not a transition.
 */
const ALLOWED_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["PAUSED", "COMPLETED", "ARCHIVED"],
  PAUSED: ["ACTIVE", "COMPLETED", "ARCHIVED"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: [],
};

/**
 * TRD §8 — /campaigns.
 *
 * Same rule as LeadsService: every query goes through the request-scoped client, and
 * there is not one `where: { tenantId }` in this file. The filter lives beneath this
 * layer so a query written here cannot escape the workspace even by accident.
 */
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(private readonly tenantPrisma: TenantPrismaFactory) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  async list(query: ListCampaignsDto): Promise<PaginatedCampaigns> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.CampaignWhereInput = {};
    if (query.search) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: "insensitive" } },
        { description: { contains: term, mode: "insensitive" } },
      ];
    }
    if (query.status?.length) where.status = { in: query.status };
    if (query.type?.length) where.type = { in: query.type };

    const [rows, total] = await Promise.all([
      this.db.campaign.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.campaign.count({ where }),
    ]);

    // Stats for the page's campaigns in one pass rather than N+1 — a list of 25
    // campaigns should not be 250 queries.
    const data = await this.withStats(rows);

    return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /**
   * The page-level numbers, counted rather than derived from the visible page.
   *
   * The 30-day series is raw SQL because Prisma cannot group by a truncated date, and
   * the alternative — pulling every call and bucketing in Node — moves the whole table
   * across the wire to compute thirty numbers.
   *
   * Raw SQL bypasses the scoped client, so the tenant filter is no longer automatic
   * here. `tenantId` is bound as a parameter from the request context, never
   * interpolated, and this is the only place in the service where the workspace is named
   * explicitly — which is exactly why it is worth a reviewer's attention.
   */
  async overview(): Promise<CampaignOverview> {
    const { tenantId } = this.tenantPrisma.context;

    // Sequential rather than Promise.all. Six concurrent counts is nothing to a real
    // Postgres, but the WebAssembly dev database serves one query at a time and drops the
    // pool under a burst — the same failure that broke the seed until it was serialised.
    // Six round trips on a stats endpoint costs a few milliseconds and works everywhere.
    const totalCampaigns = await this.db.campaign.count();
    const activeCampaigns = await this.db.campaign.count({ where: { status: "ACTIVE" } });
    const statusGroups = await this.db.campaign.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const leadsReached = await this.db.campaignLead.count();
    const callsMade = await this.db.call.count({ where: { campaignId: { not: null } } });
    const conversions = await this.db.call.count({
      where: { campaignId: { not: null }, outcome: "DEMO_BOOKED" },
    });

    const rows = await this.tenantPrisma.raw<
      { day: Date; calls: bigint; connected: bigint; conversions: bigint }[]
    >`
      SELECT
        date_trunc('day', c.started_at) AS day,
        count(*) AS calls,
        count(*) FILTER (
          WHERE c.outcome IN ('INTERESTED', 'DEMO_BOOKED', 'FOLLOW_UP', 'NOT_INTERESTED')
        ) AS connected,
        count(*) FILTER (WHERE c.outcome = 'DEMO_BOOKED') AS conversions
      FROM calls c
      WHERE c.tenant_id = ${tenantId}
        AND c.campaign_id IS NOT NULL
        AND c.started_at >= now() - interval '30 days'
      GROUP BY 1
      ORDER BY 1
    `;

    return {
      totalCampaigns,
      activeCampaigns,
      leadsReached,
      callsMade,
      conversions,
      statusBreakdown: statusGroups.map((g) => ({ status: g.status, count: g._count._all })),
      series: rows.map((row) => ({
        date: new Date(row.day).toISOString().slice(0, 10),
        calls: Number(row.calls),
        connected: Number(row.connected),
        conversions: Number(row.conversions),
      })),
    };
  }

  async findOne(id: string): Promise<CampaignWithStats> {
    const campaign = await this.db.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException("Campaign not found");
    const [withStats] = await this.withStats([campaign]);
    return withStats;
  }

  async create(dto: CreateCampaignDto): Promise<CampaignWithStats> {
    this.assertCallWindow(dto);
    await this.assertAgentExists(dto.aiAgentId);

    const campaign = await this.uniqueName(dto.name, () =>
      this.db.campaign.create({
        data: scopedCreate<Prisma.CampaignUncheckedCreateInput>({
          name: dto.name,
          description: dto.description,
          type: dto.type ?? "AI_CALLING",
          // Always DRAFT. A campaign that could be born ACTIVE would start dialling before
          // anyone had reviewed its script.
          status: "DRAFT",
          targetAudience: dto.targetAudience,
          aiAgentId: dto.aiAgentId,
          callScript: dto.callScript,
          aiInstructions: dto.aiInstructions,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
          dailyCallLimit: dto.dailyCallLimit,
          callWindowStart: dto.callWindowStart,
          callWindowEnd: dto.callWindowEnd,
          callDays: dto.callDays,
          timezone: dto.timezone,
          language: dto.language,
          maxAttempts: dto.maxAttempts,
          retryDelayMinutes: dto.retryDelayMinutes,
        }),
      }),
    );

    const [withStats] = await this.withStats([campaign]);
    return withStats;
  }

  async update(id: string, dto: UpdateCampaignDto): Promise<CampaignWithStats> {
    this.assertCallWindow(dto);
    await this.assertAgentExists(dto.aiAgentId);

    await this.uniqueName(
      dto.name,
      () =>
        this.db.campaign.update({
          where: { id },
          data: {
            name: dto.name,
            description: dto.description,
            type: dto.type,
            targetAudience: dto.targetAudience,
            aiAgentId: dto.aiAgentId,
            callScript: dto.callScript,
            aiInstructions: dto.aiInstructions,
            startDate: dto.startDate ? new Date(dto.startDate) : undefined,
            endDate: dto.endDate ? new Date(dto.endDate) : undefined,
            dailyCallLimit: dto.dailyCallLimit,
            callWindowStart: dto.callWindowStart,
            callWindowEnd: dto.callWindowEnd,
            callDays: dto.callDays,
            timezone: dto.timezone,
            language: dto.language,
            maxAttempts: dto.maxAttempts,
            retryDelayMinutes: dto.retryDelayMinutes,
          },
        }),
      id,
    );

    return this.findOne(id);
  }

  /**
   * Status changes go through here, never through PATCH.
   *
   * Activation is the one that matters: it is the moment a campaign becomes able to
   * spend money and ring strangers, so it checks that there is an agent to speak, a
   * script to speak from and at least one lead to call. Refusing here is a validation
   * error someone can fix; not refusing is a silent no-op at 9am that nobody notices
   * until the day's calls did not happen.
   */
  async transition(id: string, next: CampaignStatus): Promise<CampaignWithStats> {
    const campaign = await this.db.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException("Campaign not found");

    if (campaign.status === next) return this.findOne(id);

    if (!ALLOWED_TRANSITIONS[campaign.status].includes(next)) {
      throw new BadRequestException(
        `A ${campaign.status.toLowerCase()} campaign cannot become ${next.toLowerCase()}.`,
      );
    }

    if (next === "ACTIVE") {
      const problems: string[] = [];
      if (campaign.type === "AI_CALLING" && !campaign.aiAgentId) {
        problems.push("assign an AI agent");
      }
      if (campaign.type === "AI_CALLING" && !campaign.callScript?.trim()) {
        problems.push("add a call script");
      }
      const leadCount = await this.db.campaignLead.count({ where: { campaignId: id } });
      if (leadCount === 0) problems.push("add at least one lead");

      if (problems.length > 0) {
        throw new BadRequestException(`Before activating, ${problems.join(", ")}.`);
      }
    }

    await this.db.campaign.update({ where: { id }, data: { status: next } });
    this.logger.log(`Campaign ${id}: ${campaign.status} -> ${next}`);
    return this.findOne(id);
  }

  /**
   * Adds leads to a campaign.
   *
   * `createMany` with `skipDuplicates` rather than a read-then-write: the composite key
   * (campaignId, leadId) already forbids a lead being added twice, so letting the
   * database enforce it removes the race where two people add overlapping selections at
   * the same time and one of them gets a constraint error.
   *
   * Leads on the do-not-call list are filtered out here rather than at dial time. Both
   * would work, but a campaign that says "40 leads" and calls 32 is a campaign whose
   * numbers nobody trusts.
   */
  async addLeads(
    id: string,
    dto: AddCampaignLeadsDto,
  ): Promise<{ added: number; skipped: number }> {
    const campaign = await this.db.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException("Campaign not found");

    if (campaign.status === "ARCHIVED" || campaign.status === "COMPLETED") {
      throw new BadRequestException("Leads cannot be added to a finished campaign.");
    }

    const where: Prisma.LeadWhereInput = { doNotCall: false };
    if (dto.leadIds?.length) {
      where.id = { in: dto.leadIds };
    } else if (dto.allMatchingFilter) {
      if (dto.status?.length) where.status = { in: dto.status as never };
    } else {
      throw new BadRequestException("Provide leadIds, or set allMatchingFilter.");
    }

    const eligible = await this.db.lead.findMany({ where, select: { id: true } });

    const result = await this.db.campaignLead.createMany({
      data: eligible.map((lead) =>
        scopedCreate<Prisma.CampaignLeadUncheckedCreateInput>({
          campaignId: id,
          leadId: lead.id,
          state: "PENDING",
        }),
      ),
      skipDuplicates: true,
    });

    const requested = dto.leadIds?.length ?? eligible.length;
    return { added: result.count, skipped: requested - result.count };
  }

  async removeLead(id: string, leadId: string): Promise<void> {
    await this.db.campaignLead.deleteMany({ where: { campaignId: id, leadId } });
  }

  /**
   * Duplicating a campaign copies its configuration and nothing else. Not its leads
   * (they are already being worked by the original), not its call history, and never its
   * status — the copy starts as a DRAFT so it cannot begin dialling the moment it exists.
   */
  async duplicate(id: string): Promise<CampaignWithStats> {
    const source = await this.db.campaign.findUnique({ where: { id } });
    if (!source) throw new NotFoundException("Campaign not found");

    const name = await this.uniqueCopyName(source.name);

    const copy = await this.db.campaign.create({
      data: scopedCreate<Prisma.CampaignUncheckedCreateInput>({
        name,
        description: source.description,
        type: source.type,
        status: "DRAFT",
        targetAudience: source.targetAudience,
        aiAgentId: source.aiAgentId,
        callScript: source.callScript,
        aiInstructions: source.aiInstructions,
        dailyCallLimit: source.dailyCallLimit,
        callWindowStart: source.callWindowStart,
        callWindowEnd: source.callWindowEnd,
        callDays: source.callDays,
        timezone: source.timezone,
        language: source.language,
        maxAttempts: source.maxAttempts,
        retryDelayMinutes: source.retryDelayMinutes,
      }),
    });

    const [withStats] = await this.withStats([copy]);
    return withStats;
  }

  async remove(id: string): Promise<void> {
    const campaign = await this.db.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException("Campaign not found");

    // A campaign that has placed calls is part of the audit trail — those calls point at
    // it, and deleting it would either orphan them or cascade away real history. It can
    // be archived instead, which is what the UI offers.
    const callCount = await this.db.call.count({ where: { campaignId: id } });
    if (callCount > 0) {
      throw new BadRequestException(
        "This campaign has call history and cannot be deleted. Archive it instead.",
      );
    }

    await this.db.campaign.delete({ where: { id } });
  }

  // ── internals ─────────────────────────────────────────────────────────────────────

  private async withStats(campaigns: Campaign[]): Promise<CampaignWithStats[]> {
    if (campaigns.length === 0) return [];
    const ids = campaigns.map((c) => c.id);

    // Six grouped queries for the whole page, rather than six per campaign.
    const [leadGroups, callGroups, outcomeGroups, followUpGroups, creditGroups] = await Promise.all(
      [
        this.db.campaignLead.groupBy({
          by: ["campaignId"],
          where: { campaignId: { in: ids } },
          _count: { _all: true },
        }),
        this.db.call.groupBy({
          by: ["campaignId"],
          where: { campaignId: { in: ids } },
          _count: { _all: true },
        }),
        this.db.call.groupBy({
          by: ["campaignId", "outcome"],
          where: { campaignId: { in: ids } },
          _count: { _all: true },
        }),
        this.db.followUp.groupBy({
          by: ["campaignId"],
          where: { campaignId: { in: ids } },
          _count: { _all: true },
        }),
        this.db.call.groupBy({
          by: ["campaignId"],
          where: { campaignId: { in: ids } },
          _sum: { creditsUsed: true },
        }),
      ],
    );

    const countBy = (
      groups: { campaignId: string | null; _count: { _all: number } }[],
      id: string,
    ) => groups.find((g) => g.campaignId === id)?._count._all ?? 0;

    return campaigns.map((campaign) => {
      const leads = countBy(leadGroups, campaign.id);
      const calls = countBy(callGroups, campaign.id);

      const outcomeCount = (outcome: string) =>
        outcomeGroups.find((g) => g.campaignId === campaign.id && g.outcome === outcome)?._count
          ._all ?? 0;

      // "Connected" is every call that produced a human outcome. A no-answer or a wrong
      // number did not connect, whatever the technical status said.
      const interested = outcomeCount("INTERESTED");
      const demoBooked = outcomeCount("DEMO_BOOKED");
      const connected =
        interested + demoBooked + outcomeCount("FOLLOW_UP") + outcomeCount("NOT_INTERESTED");

      const converted = outcomeCount("DEMO_BOOKED");
      const creditsUsed =
        creditGroups.find((g) => g.campaignId === campaign.id)?._sum.creditsUsed ?? 0;

      const pct = (part: number, whole: number) =>
        whole === 0 ? 0 : Math.round((part / whole) * 100);

      return {
        ...campaign,
        stats: {
          leads,
          calls,
          connected,
          interested,
          demoBooked,
          converted,
          followUps: countBy(followUpGroups, campaign.id),
          creditsUsed,
          connectRate: pct(connected, calls),
          conversionRate: pct(converted, leads),
        },
      };
    });
  }

  /**
   * Turns a unique-constraint violation on `(tenant_id, name)` into a 409 with a sentence
   * a person can act on.
   *
   * Without this the raw Prisma error escapes as a 500, which is wrong twice: the caller
   * did nothing internally wrong — they picked a taken name — and a 500 tells them
   * nothing about how to succeed. Worth catching rather than pre-checking with a SELECT,
   * because a pre-check loses the race between two people creating the same name at once
   * and the constraint does not.
   */
  private async uniqueName<T>(
    name: string | undefined,
    write: () => Promise<T>,
    excludeId?: string,
  ): Promise<T> {
    // Checked before the write as well as caught after it, which looks redundant and is
    // not. The catch below is the correct handling and the only one that closes the race
    // between two people submitting the same name at once — but it depends on the driver
    // reporting a unique violation as P2002, and the WebAssembly dev database cannot: it
    // returns an unparseable wire message that Prisma surfaces as an unknown error with
    // no code, and which leaves the connection unusable for the next query.
    //
    // So the pre-check carries the ordinary case on every database, and the catch stays
    // as the backstop that is actually correct under concurrency on a real Postgres.
    if (name) {
      const clash = await this.db.campaign.findFirst({
        where: excludeId ? { name, NOT: { id: excludeId } } : { name },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException(`A campaign named "${name}" already exists in this workspace.`);
      }
    }

    try {
      return await write();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        (error.meta?.target as string[] | undefined)?.includes("name")
      ) {
        throw new ConflictException(`A campaign named "${name}" already exists in this workspace.`);
      }
      throw error;
    }
  }

  /** A call window that ends before it starts would silently never fire. */
  private assertCallWindow(dto: { callWindowStart?: number; callWindowEnd?: number }): void {
    if (
      dto.callWindowStart !== undefined &&
      dto.callWindowEnd !== undefined &&
      dto.callWindowEnd <= dto.callWindowStart
    ) {
      throw new BadRequestException("The calling window must end after it starts.");
    }
  }

  /**
   * Checked explicitly rather than left to the foreign key: the scoped client would
   * reject another tenant's agent id with a constraint error, and "Foreign key violation"
   * is not something to show a salesperson.
   */
  private async assertAgentExists(aiAgentId?: string): Promise<void> {
    if (!aiAgentId) return;
    const agent = await this.db.aiAgent.findUnique({ where: { id: aiAgentId } });
    if (!agent) throw new BadRequestException("That AI agent does not exist in this workspace.");
  }

  /** "Q3 Outbound" -> "Q3 Outbound (copy)" -> "Q3 Outbound (copy 2)". */
  private async uniqueCopyName(base: string): Promise<string> {
    const candidate = `${base} (copy)`;
    const clash = await this.db.campaign.findFirst({ where: { name: candidate } });
    if (!clash) return candidate;

    for (let n = 2; n < 50; n += 1) {
      const next = `${base} (copy ${n})`;
      // eslint-disable-next-line no-await-in-loop
      const taken = await this.db.campaign.findFirst({ where: { name: next } });
      if (!taken) return next;
    }
    return `${base} (copy ${Date.now()})`;
  }
}
