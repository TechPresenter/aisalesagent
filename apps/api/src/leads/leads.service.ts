import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  ActivityType,
  Prisma,
  type CalendarEvent,
  type Lead,
  type LeadActivity,
  type SuppressionSource,
} from "@prisma/client";
import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { IntegrationEventsService } from "../integrations/integration-events.service";
import { leadData } from "../integrations/events/payloads";
import { NotificationsService } from "../notifications/notifications.service";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import { scopedCreate, type TenantScopedClient } from "../prisma/tenant-scoped";
import {
  applyColumnMapping,
  dedupeImportRows,
  normalisePhone,
  parseConsentDate,
  type DedupeResult,
} from "./leads.dedupe";
import {
  MAX_IMPORT_ROWS,
  type CreateLeadDto,
  type ImportLeadsDto,
  type LeadFiltersDto,
  type ListLeadsDto,
  type UpdateLeadDto,
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
  /** Rows skipped because the number is on the workspace's do-not-call list. */
  suppressed: DedupeResult["suppressed"];
  rejected: DedupeResult["rejected"];
  /** Numbers the file itself marked do-not-call. On a commit, every one is now suppressed. */
  doNotCall: number;
  dryRun: boolean;
  /** The ImportBatch holding the attestation for this commit; null on a dry run. */
  batchId: string | null;
}

/** Where an import request came from, recorded on its ImportBatch. */
export interface ImportRequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Which wording of the import attestation the web app shows. Recorded on every batch, so
 * when the wording changes the old imports still say what their uploaders agreed to.
 * The text itself is counsel's; this only has to change in step with it.
 */
export const DEFAULT_IMPORT_ATTESTATION_VERSION = "draft-2026-10";

export function importAttestationVersion(): string {
  return process.env.IMPORT_ATTESTATION_VERSION?.trim() || DEFAULT_IMPORT_ATTESTATION_VERSION;
}

const DEFAULT_PAGE_SIZE = 25;

/** Rows per query while streaming an export: big enough to be quick, small enough to be flat. */
const EXPORT_BATCH_SIZE = 1_000;

const LEAD_ORDER: Prisma.LeadOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];

/** Anything that can write suppression rows: the scoped client or a transaction on it. */
type SuppressionWriter = Pick<TenantScopedClient, "suppression">;

/**
 * The suppression sources that are the workspace's own mark on a lead: someone switched
 * the lead to do-not-call (MANUAL), or a lead so marked was erased and its mark kept
 * (LEAD_DELETE). Switching a lead with the number back to callable takes these off — the
 * same right anyone with leads.edit had before the lead was erased.
 */
const LEAD_MARK_SOURCES: ReadonlySet<SuppressionSource> = new Set(["MANUAL", "LEAD_DELETE"]);

/**
 * Every other source holds a lead at do-not-call until whoever owns it lets go — nobody,
 * for the person's own opt-out; a manager in Settings, for a block — and this is what the
 * lead's switch answers when someone tries to turn it off. When a number is held for
 * several of these reasons, the first in this order is the one named.
 */
const STANDING_SUPPRESSIONS: { source: SuppressionSource; message: string }[] = [
  {
    source: "OUTCOME",
    message: "This person asked not to be called, so the lead stays do-not-call.",
  },
  {
    source: "IMPORT",
    message: "This number came in on a do-not-call list, so the lead stays do-not-call.",
  },
  {
    source: "SETTINGS",
    message:
      "This number is on the blocked list in Settings → Calls, so the lead stays " +
      "do-not-call. Someone who manages calling can remove it there.",
  },
];

/**
 * TRD §8 — /leads.
 *
 * Every query goes through `this.db`, the request-scoped client bound to the caller's
 * workspace. Note what is *not* in this file: not one `where: { tenantId }`. That is the
 * design — the filter is applied beneath this layer, so a query written here cannot
 * escape the tenant even if it tries to.
 *
 * Inside a transaction the same holds for `tx`, with one rule worth knowing: only
 * filterable writes (createMany, updateMany, deleteMany) are used there. The scoped
 * client checks ownership before a single-row update or delete with a query of its own,
 * outside the transaction, and on a one-connection pool that query would wait forever
 * for the connection the transaction is holding.
 */
@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaFactory,
    private readonly notifications: NotificationsService,
    private readonly integrationEvents: IntegrationEventsService,
  ) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  async list(query: ListLeadsDto): Promise<PaginatedLeads> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where = leadWhere(query);

    const [data, total] = await Promise.all([
      this.db.lead.findMany({
        where,
        orderBy: LEAD_ORDER,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.lead.count({ where }),
    ]);

    return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /**
   * `GET /leads/export` — every lead the list's filters select, as CSV.
   *
   * Streamed a thousand rows at a time with a keyset cursor rather than read whole: a
   * workspace with two hundred thousand leads should cost the API one batch of memory, not
   * all of them. The first batch is read before the stream is handed back, so a database
   * that is down fails the request with a proper error status instead of a 200 with an
   * empty file.
   */
  async export(filters: LeadFiltersDto): Promise<Readable> {
    const db = this.db;
    const where = leadWhere(filters);
    // The position is carried as values, not as a row to look up: Prisma's `cursor` finds
    // its place by re-reading the cursor row, so a lead deleted while the export runs
    // would end the file early, silently and with a 200.
    const page = (after?: { createdAt: Date; id: string }) =>
      db.lead.findMany({
        where: after
          ? {
              AND: [
                where,
                {
                  OR: [
                    { createdAt: { lt: after.createdAt } },
                    { createdAt: after.createdAt, id: { lt: after.id } },
                  ],
                },
              ],
            }
          : where,
        orderBy: LEAD_ORDER,
        take: EXPORT_BATCH_SIZE,
        include: { owner: { select: { email: true } } },
      });

    const first = await page();

    async function* lines(): AsyncGenerator<string> {
      // The byte-order mark is for Excel, which otherwise reads UTF-8 as the local code
      // page and turns every name written in Devanagari into mojibake.
      yield `\uFEFF${EXPORT_COLUMNS.map((column) => column.header).join(",")}\r\n`;
      let batch = first;
      while (batch.length > 0) {
        yield batch
          .map((lead) => `${EXPORT_COLUMNS.map((c) => csvCell(c.value(lead))).join(",")}\r\n`)
          .join("");
        if (batch.length < EXPORT_BATCH_SIZE) return;
        const last = batch[batch.length - 1];
        batch = await page({ createdAt: last.createdAt, id: last.id });
      }
    }

    return Readable.from(lines());
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
    const consentCapturedAt = consentDate(dto.consentCapturedAt);

    // A number on the do-not-call list stays on it whoever adds it back as a lead, and
    // whatever the form says: the opt-out belongs to the person, not to the row.
    const rows = await this.db.suppression.findMany({
      where: { phone },
      select: { source: true },
    });
    const suppressed = rows.length > 0;
    const doNotCall = suppressed || dto.doNotCall === true;
    // Asking for do-not-call is a mark of the workspace's own, recorded even when the
    // number is already blocked for another reason, so that it outlasts that reason.
    const addMark =
      dto.doNotCall === true && !rows.some((row) => LEAD_MARK_SOURCES.has(row.source));

    let lead: Lead;
    try {
      lead = await this.db.$transaction(async (tx) => {
        const created = await tx.lead.create({
          data: scopedCreate<Prisma.LeadUncheckedCreateInput>({
            name: dto.name.trim(),
            phone,
            city: dto.city?.trim() || null,
            source: dto.source ?? "UPLOAD",
            status: dto.status ?? "NEW",
            score: dto.score ?? 0,
            customFields: (dto.customFields ?? undefined) as Prisma.InputJsonValue,
            doNotCall,
            lawfulBasis: dto.lawfulBasis ?? null,
            consentCapturedAt,
          }),
        });
        if (addMark) {
          await this.suppress(tx, [phone], "MANUAL", "Marked do not call when the lead was added");
        }
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("A lead with this phone number already exists");
      }
      throw error;
    }

    await this.record(
      lead.id,
      "CREATED",
      `Lead created from ${lead.source.toLowerCase()}${
        suppressed ? ". The number is on the do-not-call list" : ""
      }`,
    );

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

    this.integrationEvents.emit(this.tenantPrisma.context.tenantId, "lead.created", {
      lead: leadData(lead),
    });

    return lead;
  }

  async update(id: string, dto: UpdateLeadDto): Promise<Lead> {
    const data: Prisma.LeadUpdateManyMutationInput = {};

    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.city !== undefined) data.city = dto.city.trim() || null;
    if (dto.source !== undefined) data.source = dto.source;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.score !== undefined) data.score = dto.score;
    if (dto.customFields !== undefined) {
      data.customFields = dto.customFields as Prisma.InputJsonValue;
    }
    if (dto.lawfulBasis !== undefined) data.lawfulBasis = dto.lawfulBasis;
    if (dto.consentCapturedAt !== undefined) {
      data.consentCapturedAt =
        dto.consentCapturedAt === null ? null : consentDate(dto.consentCapturedAt);
    }

    let phone: string | undefined;
    if (dto.phone !== undefined) {
      const { value, reason } = normalisePhone(dto.phone);
      if (!value) throw new BadRequestException(`Invalid phone number: ${reason}`);
      data.phone = phone = value;
    }

    // Read before writing, so the timeline can say what actually changed rather than what
    // was submitted — a PATCH that sets status to the value it already had is not a status
    // change, and recording it as one would make the history lie by repetition.
    const before = await this.db.lead.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Lead not found");

    // Every reason the number is on the do-not-call list: one row per source.
    const number = phone ?? before.phone;
    const moved = number !== before.phone;
    const rows = await this.db.suppression.findMany({
      where: { phone: number },
      select: { id: true, source: true },
    });
    const marks = rows.filter((row) => LEAD_MARK_SOURCES.has(row.source));
    const standing = STANDING_SUPPRESSIONS.find(({ source }) =>
      rows.some((row) => row.source === source),
    );

    let doNotCall = dto.doNotCall ?? before.doNotCall;
    let clearMarks = false;

    if (rows.length > 0 && !doNotCall) {
      if (moved) {
        // Moving a lead onto a suppressed number moves it onto the list's terms, too.
        if (dto.doNotCall === false) {
          throw new ConflictException(
            "That number is on this workspace's do-not-call list, so the lead cannot be callable.",
          );
        }
        doNotCall = true;
      } else if (standing) {
        // Someone with leads.edit may take back the workspace's own mark on a lead. Not
        // the person's opt-out, and not a manager's block in Settings, which needs
        // calling.manage. A lead that was already callable is left as it is: the request
        // changes nothing, so there is nothing to refuse.
        if (before.doNotCall) throw new ConflictException(standing.message);
      } else if (dto.doNotCall === false) {
        // Only the workspace's own marks hold the number, and switching the lead back to
        // callable is exactly what takes them off. Never on an edit that did not ask.
        clearMarks = marks.length > 0;
      }
    }
    if (doNotCall !== before.doNotCall) data.doNotCall = doNotCall;

    // The lead's own mark goes on the list when someone switches it on — beside any other
    // reason already there, so it outlasts that reason — and whenever a do-not-call lead
    // turns out to have no row at all (marked before the list existed), so the mark
    // outlives the lead as every mark now does.
    const addMark =
      doNotCall &&
      marks.length === 0 &&
      (rows.length === 0 || (dto.doNotCall === true && !before.doNotCall));

    let after: Lead;
    try {
      after = await this.db.$transaction(async (tx) => {
        // The read above already proved the lead exists, so an edit with nothing to write
        // — an empty body, or a do-not-call switch set to what it already was — skips the
        // write rather than reading updateMany's zero as "not found".
        if (Object.keys(data).length > 0) {
          const { count } = await tx.lead.updateMany({ where: { id }, data });
          if (count === 0) throw new NotFoundException("Lead not found");
        }

        if (addMark) {
          await this.suppress(tx, [number], "MANUAL", "Marked do not call on the lead");
        } else if (clearMarks) {
          await tx.suppression.deleteMany({ where: { id: { in: marks.map((row) => row.id) } } });
        }

        // Deleted since the read above, by someone else: the same answer as never there.
        const updated = await tx.lead.findFirst({ where: { id } });
        if (!updated) throw new NotFoundException("Lead not found");
        return updated;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("Another lead in this workspace already has that number");
      }
      throw error;
    }

    for (const entry of diffLead(before, after)) {
      await this.record(id, entry.type, entry.summary, entry.metadata);
    }

    if (before.status !== after.status) {
      this.integrationEvents.emit(this.tenantPrisma.context.tenantId, "lead.status_changed", {
        lead: leadData(after),
        previousStatus: before.status,
        status: after.status,
      });
    }

    return after;
  }

  /**
   * Erases a lead, and the copies of it that live outside the lead's own rows.
   *
   * Deleting the row cascades to its calls, recordings, transcripts, notes, follow-ups,
   * timeline and campaign memberships. It does not reach the places that hold the lead's
   * name or number by value rather than by foreign key, so those are cleared here in the
   * same transaction — an erasure that leaves "Call finished with Asha Verma" in the bell
   * is not one:
   *
   *   - notifications pointing at the lead, its calls or its follow-ups are deleted;
   *   - calendar events for it are deleted, and removed from a synced Google or Outlook
   *     calendar once the transaction commits;
   *   - webhook deliveries that carried it keep their envelope but lose the data and
   *     the receiver's response, and any not yet sent are given up on.
   *
   * What is kept: the number's suppression rows, when the lead was do-not-call. That is the
   * one fact about this person the workspace must go on holding, because the alternative
   * is calling them again after they asked not to be. A do-not-call lead whose number has
   * no row at all — marked before the list existed, or held there by a Settings entry
   * since removed — leaves a LEAD_DELETE row behind. That counts as the workspace's own
   * mark, as the lead's switch was: it is not a reason the person gave.
   */
  async remove(id: string): Promise<void> {
    const lead = await this.db.lead.findUnique({
      where: { id },
      select: { id: true, phone: true, doNotCall: true },
    });
    if (!lead) throw new NotFoundException("Lead not found");

    const deletedEvents = await this.db.$transaction(
      async (tx) => {
        // One after another: a transaction is one connection, and queries on it queue.
        const calls = await tx.call.findMany({ where: { leadId: id }, select: { id: true } });
        const followUps = await tx.followUp.findMany({
          where: { leadId: id },
          select: { id: true },
        });
        const followUpIds = followUps.map((followUp) => followUp.id);

        await tx.notification.deleteMany({
          where: {
            OR: [
              { linkPath: { startsWith: `/leads/${id}` } },
              { resourceId: { in: [id, ...calls.map((call) => call.id), ...followUpIds] } },
            ],
          },
        });

        const events = await tx.calendarEvent.findMany({
          where: { OR: [{ leadId: id }, { followUpId: { in: followUpIds } }] },
        });
        if (events.length > 0) {
          await tx.calendarEvent.deleteMany({ where: { id: { in: events.map((e) => e.id) } } });
        }

        // Every event that carries a lead names it in one of these three places — see
        // integrations/events/payloads.ts.
        const deliveries = await tx.webhookDelivery.findMany({
          where: {
            OR: [
              { payload: { path: ["data", "lead", "id"], equals: id } },
              { payload: { path: ["data", "call", "leadId"], equals: id } },
              { payload: { path: ["data", "followUp", "leadId"], equals: id } },
            ],
          },
          select: { id: true, payload: true, status: true },
        });
        for (const delivery of deliveries) {
          const unsent = delivery.status === "PENDING" || delivery.status === "FAILED";
          await tx.webhookDelivery.updateMany({
            where: { id: delivery.id },
            data: {
              payload: redactedEnvelope(delivery.payload),
              responseBody: null,
              ...(unsent
                ? {
                    status: "EXHAUSTED",
                    nextAttemptAt: null,
                    error: "Not sent: the lead it described was erased.",
                  }
                : {}),
            },
          });
        }

        if (lead.doNotCall) {
          const held = await tx.suppression.findFirst({
            where: { phone: lead.phone },
            select: { id: true },
          });
          if (!held) {
            await this.suppress(tx, [lead.phone], "LEAD_DELETE", "Kept when the lead was erased");
          }
        }

        await tx.lead.deleteMany({ where: { id } });
        return events;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );

    const { tenantId } = this.tenantPrisma.context;
    for (const event of deletedEvents.filter((row: CalendarEvent) => row.externalId)) {
      this.integrationEvents.syncCalendarEvent(tenantId, "delete", event);
    }
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
   * Puts numbers on the do-not-call list for one reason. A number already on it for that
   * same reason keeps the row it has — the first one recorded is the one worth keeping,
   * and `skipDuplicates` turns the second into a no-op rather than an error. A number on
   * it for a different reason gets a second row, so each can be taken back on its own.
   */
  private async suppress(
    db: SuppressionWriter,
    phones: string[],
    source: SuppressionSource,
    reason: string,
  ): Promise<void> {
    if (phones.length === 0) return;
    const createdById = this.tenantPrisma.context.userId;
    await db.suppression.createMany({
      data: phones.map((phone) =>
        scopedCreate<Prisma.SuppressionCreateManyInput>({ phone, source, reason, createdById }),
      ),
      skipDuplicates: true,
    });
  }

  /**
   * Feature List §2 — "Bulk CSV/XLSX import: column mapping and de-duplication on import."
   *
   * Three passes, in this order for a reason:
   *   1. Parse and map — turn the file into rows keyed by the fields we know.
   *   2. De-duplicate against the file, the workspace's leads and its do-not-call list,
   *      in memory.
   *   3. Write what survives — the batch, the leads, their timeline rows and the file's
   *      own opt-outs — in one transaction, so a failure part-way leaves nothing behind
   *      and a retry of the same file starts clean.
   *
   * Doing the existence checks as one `findMany` of normalised numbers rather than a query
   * per row is the difference between a 5,000-row import taking a second and taking
   * several minutes. The same goes for the writes: one `createMany` for the leads and one
   * for their timeline rows, never a row at a time.
   *
   * A commit needs the uploader's attestation and the lawful basis it rests on, and is
   * recorded as an ImportBatch: who, from where, which file and which wording they agreed
   * to. The file is identified twice: by the SHA-256 of the CSV this request carried, and
   * — when the browser sends them — by the SHA-256 of the file as picked plus an id shared
   * by every request of that upload, since a big file arrives as several requests and no
   * one of them is the file. A dry run needs neither, because it writes nothing.
   */
  async import(
    dto: ImportLeadsDto,
    meta: ImportRequestMeta = { ipAddress: null, userAgent: null },
  ): Promise<ImportSummary> {
    // Checked before the file is even parsed: no amount of valid data stands in for the
    // statement that the workspace may contact these people.
    if (!dto.dryRun) {
      if (dto.attestation !== true) {
        throw new BadRequestException(
          "Confirm that this workspace may lawfully contact everyone in the file before importing it.",
        );
      }
      if (!dto.lawfulBasis) {
        throw new BadRequestException("Choose the basis on which these leads may be contacted.");
      }
    }

    let records: Record<string, string>[];
    try {
      records = parse(dto.csv, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
        // One past the cap is enough to know the file is over it, and parsing stops
        // there rather than working through the rest of a file that will be refused.
        to: MAX_IMPORT_ROWS + 1,
      }) as Record<string, string>[];
    } catch (error) {
      throw new BadRequestException(
        `Could not parse CSV: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }

    if (records.length === 0) {
      throw new BadRequestException("The file has no data rows");
    }
    if (records.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `The file has more than ${MAX_IMPORT_ROWS.toLocaleString("en-IN")} rows. ` +
          `Import it in parts of at most ${MAX_IMPORT_ROWS.toLocaleString("en-IN")} rows each.`,
      );
    }

    const rows = applyColumnMapping(records, dto.mapping);

    // Candidate numbers first, so each existence check is one indexed lookup over exactly
    // the numbers this file mentions.
    const candidatePhones = [
      ...new Set(
        rows
          .map((row) => normalisePhone(typeof row.phone === "string" ? row.phone : "").value)
          .filter((phone): phone is string => Boolean(phone)),
      ),
    ];

    const [existing, suppressed] = await Promise.all([
      this.db.lead.findMany({ where: { phone: { in: candidatePhones } }, select: { phone: true } }),
      this.db.suppression.findMany({
        where: { phone: { in: candidatePhones } },
        select: { phone: true },
      }),
    ]);

    const result = dedupeImportRows(
      rows,
      new Set(existing.map((lead) => lead.phone)),
      new Set(suppressed.map((row) => row.phone)),
    );

    if (dto.dryRun) {
      return { ...toSummary(result, 0), dryRun: true, batchId: null };
    }

    const { userId } = this.tenantPrisma.context;
    const source = dto.source ?? "UPLOAD";
    const lawfulBasis = dto.lawfulBasis as string;
    const uploader = await this.db.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    const { batchId, imported, markedDoNotCall } = await this.db.$transaction(
      async (tx) => {
        const batch = await tx.importBatch.create({
          data: scopedCreate<Prisma.ImportBatchUncheckedCreateInput>({
            userId,
            userEmail: uploader?.email ?? null,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            csvSha256: createHash("sha256").update(dto.csv, "utf8").digest("hex"),
            fileSha256: dto.fileSha256?.toLowerCase() ?? null,
            uploadId: dto.uploadId ?? null,
            rowCount: records.length,
            source,
            lawfulBasis,
            attestationVersion: importAttestationVersion(),
          }),
        });

        if (result.toInsert.length > 0) {
          await tx.lead.createMany({
            data: result.toInsert.map((lead) =>
              scopedCreate<Prisma.LeadCreateManyInput>({
                name: lead.name,
                phone: lead.phone,
                city: lead.city,
                source,
                status: "NEW",
                customFields: (lead.customFields ?? undefined) as Prisma.InputJsonValue,
                doNotCall: lead.doNotCall,
                lawfulBasis,
                consentCapturedAt: lead.consentCapturedAt,
                importBatchId: batch.id,
              }),
            ),
            // Belt to the in-memory brace: two imports running concurrently can both pass
            // the existence check and race to insert the same number. The unique
            // constraint decides, and skipDuplicates turns the loser into a skip rather
            // than a 500.
            skipDuplicates: true,
          });
        }

        // Read back by batch rather than trusting `toInsert`: `skipDuplicates` means the
        // set that landed may be smaller than the set offered, and a timeline row for a
        // lead this import did not create would point at someone else's.
        const inserted = await tx.lead.findMany({
          where: { importBatchId: batch.id },
          select: { id: true },
        });
        if (inserted.length > 0) {
          await tx.leadActivity.createMany({
            data: inserted.map((lead) =>
              scopedCreate<Prisma.LeadActivityCreateManyInput>({
                leadId: lead.id,
                actorId: userId,
                type: "IMPORTED",
                summary: `Imported from ${source}`,
                metadata: { importBatchId: batch.id },
              }),
            ),
          });
        }

        // The file's own opt-outs: every number it marks do-not-call goes on the list,
        // and any lead already holding that number — including one this import skipped
        // as a duplicate — is marked to match.
        let marked: { id: string }[] = [];
        if (result.doNotCallPhones.length > 0) {
          await this.suppress(
            tx,
            result.doNotCallPhones,
            "IMPORT",
            "Marked do not call in an imported file",
          );
          marked = await tx.lead.findMany({
            where: { phone: { in: result.doNotCallPhones }, doNotCall: false },
            select: { id: true },
          });
          if (marked.length > 0) {
            await tx.lead.updateMany({
              where: { id: { in: marked.map((lead) => lead.id) } },
              data: { doNotCall: true },
            });
            await tx.leadActivity.createMany({
              data: marked.map((lead) =>
                scopedCreate<Prisma.LeadActivityCreateManyInput>({
                  leadId: lead.id,
                  actorId: userId,
                  type: "UPDATED",
                  summary: "Marked do not call by an imported file",
                  metadata: { field: "doNotCall", from: false, to: true, importBatchId: batch.id },
                }),
              ),
            });
          }
        }

        await tx.importBatch.updateMany({
          where: { id: batch.id },
          data: {
            importedCount: inserted.length,
            summary: {
              imported: inserted.length,
              duplicatesInFile: result.duplicatesInFile.length,
              duplicatesInDatabase: result.duplicatesInDatabase.length,
              suppressed: result.suppressed.length,
              rejected: result.rejected.length,
              doNotCall: result.doNotCallPhones.length,
              leadsMarkedDoNotCall: marked.length,
            },
          },
        });

        return { batchId: batch.id, imported: inserted.length, markedDoNotCall: marked.length };
      },
      // Ten thousand rows is three bulk statements and a read-back, not ten thousand round
      // trips, but on a cold serverless connection it still deserves more than the default
      // five seconds.
      { maxWait: 10_000, timeout: 60_000 },
    );

    this.logger.log(
      `Import ${batchId}: ${imported} inserted, ` +
        `${result.duplicatesInFile.length} in-file duplicates, ` +
        `${result.duplicatesInDatabase.length} existing, ` +
        `${result.suppressed.length} suppressed, ` +
        `${result.rejected.length} rejected, ` +
        `${markedDoNotCall} more leads marked do not call by the file's opt-outs`,
    );

    // One event for the whole file rather than one per row: a thousand-lead import is one
    // thing that happened, and a Slack channel should hear about it once.
    if (imported > 0) {
      this.integrationEvents.emit(this.tenantPrisma.context.tenantId, "leads.imported", {
        imported,
        duplicates: result.duplicatesInFile.length + result.duplicatesInDatabase.length,
        rejected: result.rejected.length,
        // Added beside the original three rather than folded into one of them: a receiver
        // filtering on `rejected` keeps meaning what it meant.
        suppressed: result.suppressed.length,
        source,
      });
    }

    return { ...toSummary(result, imported), dryRun: false, batchId };
  }
}

/**
 * The filters `GET /leads` and `GET /leads/export` share, as a where clause. One function
 * for both, so an export can never hold a different set of rows than the list showed.
 * Adding "all matching" leads to a campaign uses it too, for the same reason.
 */
export function leadWhere(query: LeadFiltersDto): Prisma.LeadWhereInput {
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

  // Bands rather than bounds — see the note on LeadFiltersDto.scoreBand.
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

  return where;
}

type ExportedLead = Lead & { owner: { email: string } | null };

/** The export's columns, in order. Snake-case headers, so the file re-imports cleanly. */
const EXPORT_COLUMNS: { header: string; value: (lead: ExportedLead) => unknown }[] = [
  { header: "id", value: (lead) => lead.id },
  { header: "name", value: (lead) => lead.name },
  { header: "contact_person", value: (lead) => lead.contactPerson },
  { header: "job_title", value: (lead) => lead.jobTitle },
  { header: "phone", value: (lead) => lead.phone },
  { header: "email", value: (lead) => lead.email },
  { header: "website", value: (lead) => lead.website },
  { header: "address", value: (lead) => lead.address },
  { header: "city", value: (lead) => lead.city },
  { header: "state", value: (lead) => lead.state },
  { header: "country", value: (lead) => lead.country },
  { header: "industry", value: (lead) => lead.industry },
  { header: "company_size", value: (lead) => lead.companySize },
  { header: "source", value: (lead) => lead.source },
  { header: "status", value: (lead) => lead.status },
  { header: "score", value: (lead) => lead.score },
  { header: "temperature", value: (lead) => lead.temperature },
  { header: "owner_email", value: (lead) => lead.owner?.email },
  { header: "do_not_call", value: (lead) => (lead.doNotCall ? "yes" : "no") },
  { header: "lawful_basis", value: (lead) => lead.lawfulBasis },
  { header: "consent_captured_at", value: (lead) => lead.consentCapturedAt },
  { header: "last_contacted_at", value: (lead) => lead.lastContactedAt },
  { header: "created_at", value: (lead) => lead.createdAt },
  { header: "custom_fields", value: (lead) => lead.customFields },
];

/**
 * One CSV cell, quoted when it has to be and defused when it could be a formula.
 *
 * A lead's name comes from whoever filled in a form or a spreadsheet, and a spreadsheet
 * that opens "=HYPERLINK(...)" runs it. A leading = + - @ tab or carriage return is
 * prefixed with an apostrophe, the convention spreadsheets read as "this is text".
 * Phone numbers are stored as digits without a +, so they pass through untouched.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * What a webhook delivery keeps once the lead it carried is erased: the envelope — event,
 * id, time — so the delivery log still reads as a history, and nothing of the person.
 */
function redactedEnvelope(payload: Prisma.JsonValue): Prisma.InputJsonValue {
  const envelope =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Prisma.JsonObject)
      : {};
  return {
    id: envelope.id ?? null,
    event: envelope.event ?? null,
    createdAt: envelope.createdAt ?? null,
    workspaceId: envelope.workspaceId ?? null,
    data: { redacted: true, reason: "The lead this event described was erased." },
  };
}

/** A consent date from a form or API call: ISO 8601, a real calendar date, not in the future. */
function consentDate(value: string | undefined): Date | null {
  if (value === undefined) return null;
  const date = parseConsentDate(value);
  if (date === undefined) {
    throw new BadRequestException("consentCapturedAt must be a real date, written YYYY-MM-DD.");
  }
  if (date && date.getTime() > Date.now() + 86_400_000) {
    throw new BadRequestException("consentCapturedAt cannot be in the future.");
  }
  return date;
}

/**
 * Turns a before/after pair into the timeline rows it deserves.
 *
 * Status and score get their own activity types because those are the two fields anyone
 * ever filters a timeline by; everything else collapses into a single UPDATED row naming
 * the fields, rather than one row per field, so renaming a lead and fixing its city does
 * not push the call history off the screen. Do-not-call is the exception that gets a row
 * of its own: when someone asks "why was this person (not) called", it is the answer.
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

  if (before.doNotCall !== after.doNotCall) {
    entries.push({
      type: "UPDATED",
      summary: after.doNotCall ? "Marked do not call" : "Do not call removed",
      metadata: { field: "doNotCall", from: before.doNotCall, to: after.doNotCall },
    });
  }

  const OTHER = [
    "name",
    "phone",
    "city",
    "source",
    "customFields",
    "lawfulBasis",
    "consentCapturedAt",
  ] as const;
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

function toSummary(
  result: DedupeResult,
  imported: number,
): Omit<ImportSummary, "dryRun" | "batchId"> {
  return {
    imported,
    duplicatesInFile: result.duplicatesInFile,
    duplicatesInDatabase: result.duplicatesInDatabase,
    suppressed: result.suppressed,
    rejected: result.rejected,
    doNotCall: result.doNotCallPhones.length,
  };
}
