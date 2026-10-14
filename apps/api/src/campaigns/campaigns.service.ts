import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  CampaignStatus,
  Prisma,
  type AiAgent,
  type Campaign,
  type CampaignLeadState,
  type LeadStatus,
} from "@prisma/client";
import { normalisePhone } from "../leads/leads.dedupe";
import { leadWhere } from "../leads/leads.service";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import { scopedCreate } from "../prisma/tenant-scoped";
import { scriptFromAgent } from "./campaign-script";
import {
  CALL_WINDOW_ORDER_MESSAGE,
  DATE_ORDER_MESSAGE,
  MAX_LEADS_PER_ADD,
  type AddCampaignLeadsDto,
  type CreateCampaignDto,
  type ListCampaignLeadsDto,
  type ListCampaignsDto,
  type UpdateCampaignDto,
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

/** One lead in a campaign, with where the dialer has got to with it. */
export interface CampaignLeadRow {
  leadId: string;
  state: CampaignLeadState;
  attempts: number;
  lastAttemptAt: Date | null;
  nextAttemptAt: Date | null;
  addedAt: Date;
  lead: {
    id: string;
    name: string;
    contactPerson: string | null;
    phone: string;
    city: string | null;
    status: LeadStatus;
    doNotCall: boolean;
  };
}

export interface PaginatedCampaignLeads {
  data: CampaignLeadRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** The schedule fields that are judged together, as they will be stored. */
interface Schedule {
  callWindowStart: number | null;
  callWindowEnd: number | null;
  startDate: Date | null;
  endDate: Date | null;
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
    const startDate = toDate(dto.startDate) ?? null;
    const endDate = toDate(dto.endDate) ?? null;
    this.assertSchedule({
      callWindowStart: dto.callWindowStart ?? null,
      callWindowEnd: dto.callWindowEnd ?? null,
      startDate,
      endDate,
    });
    const agent = await this.agentFor(dto.aiAgentId);

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
          callScript: dto.callScript?.trim()
            ? dto.callScript
            : ((agent && scriptFromAgent(agent)) ?? dto.callScript),
          aiInstructions: dto.aiInstructions,
          startDate,
          endDate,
          dailyCallLimit: dto.dailyCallLimit,
          callWindowStart: dto.callWindowStart,
          callWindowEnd: dto.callWindowEnd,
          callDays: dto.callDays,
          // Empty unless someone picked a zone: the gate then reads the workspace's calling
          // timezone at dial time, so a campaign follows the workspace if that changes.
          timezone: dto.timezone ?? null,
          language: dto.language,
          maxAttempts: dto.maxAttempts,
          retryDelayMinutes: dto.retryDelayMinutes,
        }),
      }),
    );

    const [withStats] = await this.withStats([campaign]);
    return withStats;
  }

  /**
   * PATCH. A field left out keeps its value; null clears one that may be empty (see
   * UpdateCampaignDto). The schedule is judged as it will be stored — this request's
   * values over the saved ones — because a request that moves only the start of the
   * window can still put it after the end.
   */
  async update(id: string, dto: UpdateCampaignDto): Promise<CampaignWithStats> {
    const current = await this.db.campaign.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("Campaign not found");

    const startDate = toDate(dto.startDate);
    const endDate = toDate(dto.endDate);
    this.assertSchedule({
      callWindowStart:
        dto.callWindowStart === undefined ? current.callWindowStart : dto.callWindowStart,
      callWindowEnd: dto.callWindowEnd === undefined ? current.callWindowEnd : dto.callWindowEnd,
      startDate: startDate === undefined ? current.startDate : startDate,
      endDate: endDate === undefined ? current.endDate : endDate,
    });

    const named = await this.agentFor(dto.aiAgentId);
    const agentId = dto.aiAgentId === undefined ? current.aiAgentId : dto.aiAgentId;
    const script = dto.callScript === undefined ? current.callScript : dto.callScript;

    // Same rule as create: an agent and no script means the agent's script. It applies to
    // any save, so a campaign made before this rule existed is fixed the first time
    // someone touches it.
    let callScript = dto.callScript;
    if (agentId && !script?.trim()) {
      const agent = named ?? (await this.db.aiAgent.findUnique({ where: { id: agentId } }));
      const fromAgent = agent && scriptFromAgent(agent);
      if (fromAgent) callScript = fromAgent;
    }

    await this.uniqueName(
      dto.name ?? undefined,
      () =>
        this.db.campaign.update({
          where: { id },
          data: {
            // `?? undefined` on the columns that cannot be empty: a null there means
            // nothing, and is ignored rather than passed on to fail as a database error.
            name: dto.name ?? undefined,
            description: dto.description,
            type: dto.type ?? undefined,
            targetAudience: dto.targetAudience,
            aiAgentId: dto.aiAgentId,
            callScript,
            aiInstructions: dto.aiInstructions,
            startDate,
            endDate,
            dailyCallLimit: dto.dailyCallLimit,
            callWindowStart: dto.callWindowStart,
            callWindowEnd: dto.callWindowEnd,
            callDays: dto.callDays ?? undefined,
            timezone: dto.timezone,
            language: dto.language ?? undefined,
            maxAttempts: dto.maxAttempts ?? undefined,
            retryDelayMinutes: dto.retryDelayMinutes ?? undefined,
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

    let matching: Prisma.LeadWhereInput;
    let requested: number;
    if (dto.leadIds?.length) {
      matching = { id: { in: dto.leadIds } };
      requested = dto.leadIds.length;
    } else if (dto.allMatchingFilter) {
      matching = leadWhere(dto);
      requested = await this.db.lead.count({ where: matching });
      // Refused rather than quietly cut at the cap: "added 10,000" from a filter that
      // matched 40,000 reads as "added them all" to anyone not doing the arithmetic.
      if (requested > MAX_LEADS_PER_ADD) {
        throw new BadRequestException(
          `That filter matches ${requested.toLocaleString("en-IN")} leads. At most ` +
            `${MAX_LEADS_PER_ADD.toLocaleString("en-IN")} can be added at once, so narrow ` +
            "the filter and add them in parts.",
        );
      }
    } else {
      throw new BadRequestException("Provide leadIds, or set allMatchingFilter.");
    }

    const eligible = await this.db.lead.findMany({
      where: { AND: [matching, { doNotCall: false }] },
      select: { id: true },
    });

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

    // Skipped: already in the campaign, marked do-not-call, or (for an id list) not a
    // lead in this workspace.
    return { added: result.count, skipped: requested - result.count };
  }

  /** The campaign's leads, most recently added first, for the campaign page. */
  async listLeads(id: string, query: ListCampaignLeadsDto): Promise<PaginatedCampaignLeads> {
    const campaign = await this.db.campaign.findUnique({ where: { id }, select: { id: true } });
    if (!campaign) throw new NotFoundException("Campaign not found");

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.CampaignLeadWhereInput = { campaignId: id };
    if (query.state?.length) where.state = { in: query.state };
    const term = query.search?.trim();
    if (term) {
      // Matched the way the Leads list matches (leadWhere): the phone by the normalised
      // form of what was typed, since that is how phones are stored.
      where.lead = {
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { city: { contains: term, mode: "insensitive" } },
          { phone: { contains: normalisePhone(term).value ?? term } },
        ],
      };
    }

    // Sequential, for the same reason as overview(): the dev database serves one query at
    // a time.
    const rows = await this.db.campaignLead.findMany({
      where,
      orderBy: [{ addedAt: "desc" }, { leadId: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        leadId: true,
        state: true,
        attempts: true,
        lastAttemptAt: true,
        nextAttemptAt: true,
        addedAt: true,
        lead: {
          select: {
            id: true,
            name: true,
            contactPerson: true,
            phone: true,
            city: true,
            status: true,
            doNotCall: true,
          },
        },
      },
    });
    const total = await this.db.campaignLead.count({ where });

    return {
      data: rows,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
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

  /**
   * The schedule as it will be stored. A call window that ends before it starts would
   * silently never fire, and half a window would be completed at dial time by the
   * workspace's other half, which can land on either side of it. The DTO checks a request
   * that carries both ends; this also catches a PATCH that moves only one of them.
   */
  private assertSchedule(schedule: Schedule): void {
    const { callWindowStart: start, callWindowEnd: end } = schedule;
    if ((start === null) !== (end === null)) {
      throw new BadRequestException(
        "Set both ends of the calling window, or neither to use the workspace's hours.",
      );
    }
    if (start !== null && end !== null && end <= start) {
      throw new BadRequestException(CALL_WINDOW_ORDER_MESSAGE);
    }
    if (schedule.startDate && schedule.endDate && schedule.endDate <= schedule.startDate) {
      throw new BadRequestException(DATE_ORDER_MESSAGE);
    }
  }

  /**
   * The agent a request names, read through the scoped client. Checked explicitly rather
   * than left to the foreign key: the scoped client would reject another tenant's agent id
   * with a constraint error, and "Foreign key violation" is not something to show a
   * salesperson.
   */
  private async agentFor(aiAgentId?: string | null): Promise<AiAgent | null> {
    if (!aiAgentId) return null;
    const agent = await this.db.aiAgent.findUnique({ where: { id: aiAgentId } });
    if (!agent) throw new BadRequestException("That AI agent does not exist in this workspace.");
    return agent;
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

/** A date from a request: undefined stays undefined (unchanged), null stays null (cleared). */
function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined || value === null) return value;
  return new Date(value);
}
