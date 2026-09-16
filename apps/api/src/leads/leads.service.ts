import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ActivityType, Prisma, type Lead, type LeadActivity } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { NotificationsService } from "../notifications/notifications.service";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import { scopedCreate } from "../prisma/tenant-scoped";
import {
  applyColumnMapping,
  dedupeImportRows,
  normalisePhone,
  type DedupeResult,
} from "./leads.dedupe";
import type {
  CreateLeadDto,
  ImportLeadsDto,
  ListLeadsDto,
  UpdateLeadDto,
} from "./dto/lead.dto";

export interface PaginatedLeads {
  data: Lead[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface LeadStats {
  total: number;
  newToday: number;
  interested: number;
  demoBooked: number;
  converted: number;
  followUpsDue: number;
}

export type LeadActivityEntry = LeadActivity & {
  actor: { id: string; name: string } | null;
};

export interface ImportSummary {
  imported: number;
  duplicatesInFile: DedupeResult["duplicatesInFile"];
  duplicatesInDatabase: DedupeResult["duplicatesInDatabase"];
  rejected: DedupeResult["rejected"];
  dryRun: boolean;
}

const DEFAULT_PAGE_SIZE = 25;

/**
 * TRD §8 — /leads.
 *
 * Every query goes through `this.db`, the request-scoped client bound to the caller's
 * workspace. Note what is *not* in this file: not one `where: { tenantId }`. That is the
 * design — the filter is applied beneath this layer, so a query written here cannot
 * escape the tenant even if it tries to.
 */
@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaFactory,
    private readonly notifications: NotificationsService,
  ) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  async list(query: ListLeadsDto): Promise<PaginatedLeads> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.LeadWhereInput = {};

    if (query.search) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: "insensitive" } },
        { city: { contains: term, mode: "insensitive" } },
        // Searching a phone by what the user typed means normalising their input the
        // same way the stored value was normalised — otherwise typing the number exactly
        // as it appears in the table finds nothing.
        { phone: { contains: normalisePhone(term).value ?? term } },
      ];
    }

    if (query.status?.length) where.status = { in: query.status };
    if (query.source?.length) where.source = { in: query.source };
    if (query.city) where.city = { equals: query.city, mode: "insensitive" };

    // Bands rather than bounds — see the note on ListLeadsDto.scoreBand.
    if (query.scoreBand) {
      const bands = { high: [75, 100], medium: [50, 74], low: [0, 49] } as const;
      const [min, max] = bands[query.scoreBand];
      where.score = { gte: min, lte: max };
    }

    // "unassigned" is a real filter, not a missing one: a workspace needs to find the
    // leads nobody owns, and `ownerId=` empty would be indistinguishable from omitting it.
    if (query.ownerId) {
      where.ownerId = query.ownerId === "unassigned" ? null : query.ownerId;
    }

    if (query.createdWithinDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - query.createdWithinDays);
      where.createdAt = { gte: cutoff };
    }

    const [data, total] = await Promise.all([
      this.db.lead.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.lead.count({ where }),
    ]);

    return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /**
   * The KPI strip above the table.
   *
   * Counted in the database rather than derived from a page of rows — the strip says
   * "612 total leads" and a page holds ten, so the only way to be right is to ask. Each
   * count is its own query so Postgres can use the (tenant_id, status) index rather than
   * loading every row to group in memory.
   */
  async stats(): Promise<LeadStats> {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [total, newToday, interested, demoBooked, converted, followUpsDue] =
      await Promise.all([
        this.db.lead.count(),
        this.db.lead.count({ where: { createdAt: { gte: startOfToday } } }),
        this.db.lead.count({ where: { status: "INTERESTED" } }),
        this.db.lead.count({ where: { status: "DEMO_BOOKED" } }),
        this.db.lead.count({ where: { status: "CONVERTED" } }),
        // Due, not merely open: an overdue follow-up is still due, so the bound is an
        // upper one. `TODAY` and `OVERDUE` are not stored statuses — see the FollowUp
        // model — which is exactly why this is a date comparison and not an equality.
        this.db.followUp.count({
          where: { status: "PENDING", dueAt: { lte: new Date(startOfToday.getTime() + 86_400_000) } },
        }),
      ]);

    return { total, newToday, interested, demoBooked, converted, followUpsDue };
  }

  /** How many leads came from each source — one grouped count, not one query per source. */
  async sourceBreakdown(): Promise<{ source: string; count: number }[]> {
    const groups = await this.db.lead.groupBy({ by: ["source"], _count: { _all: true } });
    return groups.map((g) => ({ source: String(g.source), count: g._count._all }));
  }

  /** Leads per status — the Analytics funnel. */
  async statusBreakdown(): Promise<{ status: string; count: number }[]> {
    const groups = await this.db.lead.groupBy({ by: ["status"], _count: { _all: true } });
    return groups.map((g) => ({ status: String(g.status), count: g._count._all }));
  }

  /**
   * Leads per city, carrying the interested and converted counts inside each — the
   * Analytics table. One grouped query over (city, status), not three queries per city.
   */
  async cityBreakdown(
    limit = 8,
  ): Promise<{ city: string; leads: number; interested: number; converted: number }[]> {
    type Row = { city: string; leads: number; interested: number; converted: number };

    const groups = await this.db.lead.groupBy({
      by: ["city", "status"],
      _count: { _all: true },
    });

    const byCity = new Map<string, Row>();
    for (const group of groups) {
      // A lead with no city still belongs somewhere, or the totals stop adding up.
      const city = group.city?.trim() || "Unknown";
      const row: Row = byCity.get(city) ?? { city, leads: 0, interested: 0, converted: 0 };
      row.leads += group._count._all;
      if (group.status === "INTERESTED") row.interested += group._count._all;
      if (group.status === "CONVERTED") row.converted += group._count._all;
      byCity.set(city, row);
    }

    return Array.from(byCity.values())
      .sort((a, b) => b.leads - a.leads)
      .slice(0, limit);
  }

  async findOne(id: string): Promise<Lead> {
    const lead = await this.db.lead.findUnique({ where: { id } });
    // The scoped client already returns null for another tenant's row, so this 404 covers
    // both "no such lead" and "not yours" with the same response — as it should.
    if (!lead) throw new NotFoundException("Lead not found");
    return lead;
  }

  async create(dto: CreateLeadDto): Promise<Lead> {
    const { value: phone, reason } = normalisePhone(dto.phone);
    if (!phone) throw new BadRequestException(`Invalid phone number: ${reason}`);

    try {
      const lead = await this.db.lead.create({
        data: scopedCreate<Prisma.LeadUncheckedCreateInput>({
          name: dto.name.trim(),
          phone,
          city: dto.city?.trim() || null,
          source: dto.source ?? "UPLOAD",
          status: dto.status ?? "NEW",
          score: dto.score ?? 0,
          customFields: (dto.customFields ?? undefined) as Prisma.InputJsonValue,
        }),
      });
      await this.record(lead.id, "CREATED", `Lead created from ${lead.source.toLowerCase()}`);

      // Workspace-wide: a new lead has no owner yet, so there is nobody in particular to
      // tell. Imports raise nothing — a thousand rows is one job, not a thousand notices.
      await this.notifications.raise({
        type: "NEW_LEAD",
        title: `New lead: ${lead.name}`,
        body: `Added from ${lead.source.toLowerCase().replace(/_/g, " ")}${
          lead.city ? ` · ${lead.city}` : ""
        }.`,
        linkPath: `/leads/${lead.id}`,
        resourceType: "lead",
        resourceId: lead.id,
      });

      return lead;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("A lead with this phone number already exists");
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateLeadDto): Promise<Lead> {
    const data: Prisma.LeadUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.city !== undefined) data.city = dto.city.trim() || null;
    if (dto.source !== undefined) data.source = dto.source;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.score !== undefined) data.score = dto.score;
    if (dto.customFields !== undefined) {
      data.customFields = dto.customFields as Prisma.InputJsonValue;
    }

    if (dto.phone !== undefined) {
      const { value, reason } = normalisePhone(dto.phone);
      if (!value) throw new BadRequestException(`Invalid phone number: ${reason}`);
      data.phone = value;
    }

    // Read before writing, so the timeline can say what actually changed rather than what
    // was submitted — a PATCH that sets status to the value it already had is not a status
    // change, and recording it as one would make the history lie by repetition.
    const before = await this.db.lead.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Lead not found");

    let after: Lead;
    try {
      // The scoped client pre-checks ownership before letting an update through, so a
      // lead belonging to another workspace 404s here rather than being modified.
      after = await this.db.lead.update({ where: { id }, data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("Another lead in this workspace already has that number");
      }
      throw error;
    }

    for (const entry of diffLead(before, after)) {
      await this.record(id, entry.type, entry.summary, entry.metadata);
    }

    return after;
  }

  async remove(id: string): Promise<void> {
    await this.db.lead.delete({ where: { id } });
  }

  /**
   * Feature List §2 — the lead's activity timeline.
   *
   * Append-only and read whole: a lead accumulates tens of these, not thousands, and
   * paginating a timeline that fits on one screen would cost more than it saves.
   */
  async activity(leadId: string): Promise<LeadActivityEntry[]> {
    const lead = await this.db.lead.findUnique({ where: { id: leadId }, select: { id: true } });
    if (!lead) throw new NotFoundException("Lead not found");

    return this.db.leadActivity.findMany({
      where: { leadId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      include: { actor: { select: { id: true, name: true } } },
    });
  }

  /**
   * Writes one timeline row.
   *
   * Failures are logged and swallowed on purpose. The timeline is a record of work, not
   * the work itself: losing a row is a gap in the history, but throwing here would fail
   * an edit the user already made and watched succeed, which is strictly worse.
   */
  private async record(
    leadId: string,
    type: ActivityType,
    summary: string,
    metadata?: Prisma.InputJsonValue,
  ): Promise<void> {
    try {
      await this.db.leadActivity.create({
        data: scopedCreate<Prisma.LeadActivityUncheckedCreateInput>({
          leadId,
          actorId: this.tenantPrisma.context.userId,
          type,
          summary,
          metadata,
        }),
      });
    } catch (error) {
      this.logger.warn(
        `Could not record ${type} on lead ${leadId}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  /**
   * Feature List §2 — "Bulk CSV/XLSX import: column mapping and de-duplication on import."
   *
   * Three passes, in this order for a reason:
   *   1. Parse and map — turn the file into rows keyed by the fields we know.
   *   2. De-duplicate against both the file and the workspace, in memory.
   *   3. Insert what survives, in one transaction.
   *
   * Doing the existence check as one `findMany` of normalised numbers rather than a query
   * per row is the difference between a 5,000-row import taking a second and taking
   * several minutes.
   */
  async import(dto: ImportLeadsDto): Promise<ImportSummary> {
    let records: Record<string, string>[];
    try {
      records = parse(dto.csv, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
      }) as Record<string, string>[];
    } catch (error) {
      throw new BadRequestException(
        `Could not parse CSV: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }

    if (records.length === 0) {
      throw new BadRequestException("The file has no data rows");
    }

    const rows = applyColumnMapping(records, dto.mapping);

    // Candidate numbers first, so the existence check is one indexed lookup over exactly
    // the numbers this file mentions.
    const candidatePhones = rows
      .map((row) => normalisePhone(typeof row.phone === "string" ? row.phone : "").value)
      .filter((phone): phone is string => Boolean(phone));

    const existing = await this.db.lead.findMany({
      where: { phone: { in: candidatePhones } },
      select: { phone: true },
    });

    const result = dedupeImportRows(rows, new Set(existing.map((lead) => lead.phone)));

    if (dto.dryRun) {
      return { ...toSummary(result, 0), dryRun: true };
    }

    if (result.toInsert.length > 0) {
      await this.db.lead.createMany({
        data: result.toInsert.map((lead) =>
          scopedCreate<Prisma.LeadCreateManyInput>({
            name: lead.name,
            phone: lead.phone,
            city: lead.city,
            source: dto.source ?? "UPLOAD",
            status: "NEW",
            customFields: (lead.customFields ?? undefined) as Prisma.InputJsonValue,
          }),
        ),
        // Belt to the in-memory brace: two imports running concurrently can both pass the
        // existence check and race to insert the same number. The unique constraint
        // decides, and skipDuplicates turns the loser into a skip rather than a 500.
        skipDuplicates: true,
      });

      // Read back rather than trusting `toInsert`: `skipDuplicates` means the set that
      // landed may be smaller than the set offered, and a timeline row for a lead that
      // was not created would point at nothing.
      const inserted = await this.db.lead.findMany({
        where: { phone: { in: result.toInsert.map((lead) => lead.phone) } },
        select: { id: true },
      });
      for (const lead of inserted) {
        await this.record(lead.id, "IMPORTED", `Imported from ${dto.source ?? "UPLOAD"}`);
      }
    }

    this.logger.log(
      `Import: ${result.toInsert.length} inserted, ` +
        `${result.duplicatesInFile.length} in-file duplicates, ` +
        `${result.duplicatesInDatabase.length} existing, ` +
        `${result.rejected.length} rejected`,
    );

    return { ...toSummary(result, result.toInsert.length), dryRun: false };
  }
}

/**
 * Turns a before/after pair into the timeline rows it deserves.
 *
 * Status and score get their own activity types because those are the two fields anyone
 * ever filters a timeline by; everything else collapses into a single UPDATED row naming
 * the fields, rather than one row per field, so renaming a lead and fixing its city does
 * not push the call history off the screen.
 */
function diffLead(
  before: Lead,
  after: Lead,
): { type: ActivityType; summary: string; metadata?: Prisma.InputJsonValue }[] {
  const entries: { type: ActivityType; summary: string; metadata?: Prisma.InputJsonValue }[] = [];

  if (before.status !== after.status) {
    entries.push({
      type: "STATUS_CHANGED",
      summary: `Status changed from ${label(before.status)} to ${label(after.status)}`,
      metadata: { field: "status", from: before.status, to: after.status },
    });
  }

  if (before.score !== after.score) {
    entries.push({
      type: "SCORE_CHANGED",
      summary: `Score moved from ${before.score} to ${after.score}`,
      metadata: { field: "score", from: before.score, to: after.score },
    });
  }

  if (before.ownerId !== after.ownerId) {
    entries.push({
      type: "ASSIGNED",
      summary: after.ownerId ? "Lead reassigned" : "Lead unassigned",
      metadata: { field: "ownerId", from: before.ownerId, to: after.ownerId },
    });
  }

  const OTHER = ["name", "phone", "city", "source", "customFields"] as const;
  const changed = OTHER.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
  if (changed.length > 0) {
    entries.push({
      type: "UPDATED",
      summary: `Updated ${changed.join(", ")}`,
      metadata: {
        fields: changed.map((field) => ({
          field,
          from: before[field] as Prisma.InputJsonValue,
          to: after[field] as Prisma.InputJsonValue,
        })),
      } as Prisma.InputJsonValue,
    });
  }

  return entries;
}

/** SCHEDULED_DEMO becomes "Scheduled demo". */
function label(value: string): string {
  const words = value.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function toSummary(result: DedupeResult, imported: number): Omit<ImportSummary, "dryRun"> {
  return {
    imported,
    duplicatesInFile: result.duplicatesInFile,
    duplicatesInDatabase: result.duplicatesInDatabase,
    rejected: result.rejected,
  };
}
