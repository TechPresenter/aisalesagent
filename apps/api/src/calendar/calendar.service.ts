import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { CalendarEventType, Prisma, type CalendarEvent } from "@prisma/client";
import { IntegrationEventsService } from "../integrations/integration-events.service";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import { scopedCreate } from "../prisma/tenant-scoped";
import { dayBounds, localDate, localMidnightPlusDays } from "../followups/followup-rules";

export interface CalendarStats {
  today: number;
  thisWeek: number;
  demos: number;
  followUps: number;
}

const EVENT_INCLUDE = {
  owner: { select: { id: true, name: true } },
  lead: { select: { id: true, name: true, phone: true, city: true } },
  campaign: { select: { id: true, name: true } },
  followUp: { select: { id: true, status: true, dueAt: true, channel: true } },
} satisfies Prisma.CalendarEventInclude;

/**
 * Feature List §11 — Calendar.
 *
 * The one query this screen really makes is "everything overlapping the window I am
 * looking at", and the important word is *overlapping*: an event that started before the
 * window and ends inside it belongs on the view. Filtering on `startAt` alone — the
 * obvious version — drops exactly the long meetings people most want to see, and the
 * omission is invisible because the rest of the grid looks right.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly tenantPrisma: TenantPrismaFactory,
    private readonly integrationEvents: IntegrationEventsService,
  ) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  private async timezone(): Promise<string> {
    const settings = await this.db.tenantSettings.findFirst({ select: { timezone: true } });
    return settings?.timezone ?? "UTC";
  }

  async list(query: {
    from: string;
    to: string;
    type?: CalendarEventType[];
    ownerId?: string;
    leadId?: string;
    campaignId?: string;
    search?: string;
  }) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException("The window must be two dates.");
    }
    if (to <= from) throw new BadRequestException("The window must end after it starts.");
    // A window wider than a year is not a calendar view, it is an accidental full-table
    // scan — almost always a client bug, and worth failing loudly rather than serving.
    if (to.getTime() - from.getTime() > 400 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException("That window is too wide. Ask for a year at most.");
    }

    const where: Prisma.CalendarEventWhereInput = {
      // Overlap, not containment: starts before the window ends AND ends after it starts.
      startAt: { lt: to },
      endAt: { gt: from },
    };
    if (query.type?.length) where.type = { in: query.type };
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.leadId) where.leadId = query.leadId;
    if (query.campaignId) where.campaignId = query.campaignId;
    if (query.search) {
      const term = query.search.trim();
      where.OR = [
        { title: { contains: term, mode: "insensitive" } },
        { description: { contains: term, mode: "insensitive" } },
        { location: { contains: term, mode: "insensitive" } },
        { lead: { name: { contains: term, mode: "insensitive" } } },
      ];
    }

    return this.db.calendarEvent.findMany({
      where,
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      include: EVENT_INCLUDE,
    });
  }

  async stats(): Promise<CalendarStats> {
    const timezone = await this.timezone();
    const bounds = dayBounds(timezone);
    const weekEnd = localMidnightPlusDays(timezone, localDate(timezone, new Date()), 7);

    const today = await this.db.calendarEvent.count({
      where: { startAt: { lt: bounds.end }, endAt: { gt: bounds.start } },
    });
    const thisWeek = await this.db.calendarEvent.count({
      where: { startAt: { lt: weekEnd }, endAt: { gt: bounds.start } },
    });
    const demos = await this.db.calendarEvent.count({
      where: { type: "DEMO", startAt: { gte: bounds.start } },
    });
    const followUps = await this.db.calendarEvent.count({
      where: { type: "FOLLOW_UP", startAt: { gte: bounds.start } },
    });

    return { today, thisWeek, demos, followUps };
  }

  async findOne(id: string) {
    const event = await this.db.calendarEvent.findUnique({ where: { id }, include: EVENT_INCLUDE });
    if (!event) throw new NotFoundException("Event not found");
    return event;
  }

  async create(input: {
    title: string;
    description?: string;
    type?: CalendarEventType;
    startAt: string;
    endAt: string;
    allDay?: boolean;
    location?: string;
    ownerId?: string;
    leadId?: string;
    campaignId?: string;
  }): Promise<CalendarEvent> {
    const { tenantId, userId } = this.tenantPrisma.context;
    const { startAt, endAt } = this.window(input.startAt, input.endAt);

    if (input.leadId) {
      const lead = await this.db.lead.findUnique({ where: { id: input.leadId } });
      if (!lead) throw new NotFoundException("That lead does not exist in this workspace.");
    }

    const event = await this.db.calendarEvent.create({
      data: scopedCreate<Prisma.CalendarEventUncheckedCreateInput>({
        title: input.title.trim(),
        description: input.description,
        type: input.type ?? "MEETING",
        startAt,
        endAt,
        allDay: input.allDay ?? false,
        location: input.location,
        ownerId: input.ownerId ?? userId,
        leadId: input.leadId,
        campaignId: input.campaignId,
      }),
    });

    // Copied onto a connected Google or Outlook calendar after the response, when one is.
    this.integrationEvents.syncCalendarEvent(tenantId, "upsert", event);
    return event;
  }

  /**
   * Updates an event, keeping a linked follow-up in step.
   *
   * The schema pairs them one-to-one so that "reschedule the demo" and "move the
   * follow-up" are the same act. Moving only the calendar side would leave the queue
   * telling someone to call at the old time — two screens disagreeing about the same
   * commitment, which is worse than either being wrong alone.
   */
  async update(
    id: string,
    input: {
      title?: string;
      description?: string;
      type?: CalendarEventType;
      startAt?: string;
      endAt?: string;
      allDay?: boolean;
      location?: string;
      ownerId?: string | null;
    },
  ): Promise<CalendarEvent> {
    const existing = await this.db.calendarEvent.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Event not found");

    const data: Prisma.CalendarEventUncheckedUpdateInput = {};
    if (input.title !== undefined) data.title = input.title.trim();
    if (input.description !== undefined) data.description = input.description;
    if (input.type !== undefined) data.type = input.type;
    if (input.allDay !== undefined) data.allDay = input.allDay;
    if (input.location !== undefined) data.location = input.location;
    if (input.ownerId !== undefined) data.ownerId = input.ownerId;

    let movedTo: Date | null = null;
    if (input.startAt !== undefined || input.endAt !== undefined) {
      const { startAt, endAt } = this.window(
        input.startAt ?? existing.startAt.toISOString(),
        input.endAt ?? existing.endAt.toISOString(),
      );
      data.startAt = startAt;
      data.endAt = endAt;
      if (startAt.getTime() !== existing.startAt.getTime()) movedTo = startAt;
    }

    const updated = await this.db.calendarEvent.update({ where: { id }, data });

    if (movedTo && existing.followUpId) {
      await this.db.followUp.update({
        where: { id: existing.followUpId },
        // The reminder has not been sent for the new time, whatever happened at the old
        // one — same rule as rescheduling from the queue side.
        data: { dueAt: movedTo, reminderSentAt: null },
      });
    }

    this.integrationEvents.syncCalendarEvent(this.tenantPrisma.context.tenantId, "upsert", updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.db.calendarEvent.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Event not found");
    // The follow-up outlives its calendar entry deliberately: deleting the appointment is
    // not the same as deciding the lead never needs calling back.
    await this.db.calendarEvent.delete({ where: { id } });
    this.integrationEvents.syncCalendarEvent(this.tenantPrisma.context.tenantId, "delete", existing);
  }

  private window(start: string, end: string): { startAt: Date; endAt: Date } {
    const startAt = new Date(start);
    const endAt = new Date(end);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new BadRequestException("Start and end must both be dates.");
    }
    if (endAt <= startAt) throw new BadRequestException("An event must end after it starts.");
    return { startAt, endAt };
  }
}
