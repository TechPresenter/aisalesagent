"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  Phone,
  Trash2,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { FilterSelect } from "@/components/ui/filter-select";
import {
  ApiError,
  calendarApi,
  usersApi,
  type ApiCalendarEvent,
  type CalendarEventType,
  type WorkspaceMember,
} from "@/lib/api-client";
import {
  addDays,
  addMonths,
  eventsOn,
  isSameDay,
  monthGrid,
  startOfDay,
  timeLabel,
  viewLabel,
  viewWindow,
  weekGrid,
  type CalendarView as GridView,
} from "@/lib/calendar-grid";
import { useDebounced } from "@/lib/use-debounced";
import { toRole, useSessionUser } from "@/lib/use-session";
import { hasPermission } from "@appsgain/shared";
import { cn, formatDateTime } from "@/lib/utils";
import type { Tone } from "@/lib/status";

const ALL = "all";

const EVENT_TYPE: Record<CalendarEventType, { label: string; tone: Tone }> = {
  DEMO: { label: "Demo", tone: "green" },
  MEETING: { label: "Meeting", tone: "blue" },
  CALL: { label: "Call", tone: "amber" },
  FOLLOW_UP: { label: "Follow-up", tone: "purple" },
  REMINDER: { label: "Reminder", tone: "gray" },
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface CalendarViewProps {
  refreshKey: number;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
  onCreateAt: (day: Date) => void;
}

/** Feature List §11 — Calendar. */
export function CalendarView({
  refreshKey,
  onChanged,
  onError,
  onCreateAt,
}: CalendarViewProps) {
  const { user } = useSessionUser();
  const role = toRole(user?.role);
  const mayManage = role !== null && hasPermission(role, "calendar.manage");

  const [view, setView] = useState<GridView>("month");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [search, setSearch] = useState("");
  const [type, setType] = useState(ALL);
  const [ownerId, setOwnerId] = useState(ALL);

  const [events, setEvents] = useState<ApiCalendarEvent[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search, 300);
  const today = startOfDay(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = viewWindow(view, anchor);
      const result = await calendarApi.list({
        from: from.toISOString(),
        to: to.toISOString(),
        type: type === ALL ? undefined : [type as CalendarEventType],
        ownerId: ownerId === ALL ? undefined : ownerId,
        search: debouncedSearch.trim() || undefined,
      });
      setEvents(result);
      setSelectedId((current) =>
        current && result.some((e) => e.id === current) ? current : null,
      );
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not reach the server. Check that the API is running.",
      );
    } finally {
      setLoading(false);
    }
  }, [view, anchor, type, ownerId, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    usersApi
      .list({ status: ["ACTIVE"] })
      .then(setMembers)
      .catch(() => undefined);
  }, []);

  const step = (direction: -1 | 1) => {
    setAnchor((current) =>
      view === "month"
        ? addMonths(current, direction)
        : addDays(current, direction * (view === "week" ? 7 : 1)),
    );
  };

  const selected = events.find((e) => e.id === selectedId);

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_356px]">
      <Card className="flex min-w-0 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous"
              className="flex h-9 w-9 items-center justify-center rounded-btn border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-brand-navy"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={2.2} />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next"
              className="flex h-9 w-9 items-center justify-center rounded-btn border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-brand-navy"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={2.2} />
            </button>
            <button
              type="button"
              onClick={() => setAnchor(startOfDay(new Date()))}
              className="h-9 rounded-btn border border-slate-200 px-3 text-[13px] font-semibold text-brand-navy transition-colors hover:bg-slate-50"
            >
              Today
            </button>
            <h2 className="ml-1 text-[16px] font-bold tracking-tight text-brand-navy">
              {viewLabel(view, anchor)}
            </h2>
            {loading && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" strokeWidth={2.4} />
            )}
          </div>

          <div className="flex rounded-btn border border-slate-200 p-0.5">
            {(["month", "week", "day"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                className={cn(
                  "h-8 rounded-[6px] px-3 text-[12.5px] font-semibold capitalize transition-colors",
                  view === option
                    ? "bg-accent-blue text-white"
                    : "text-slate-500 hover:text-brand-navy",
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search events by title, lead or location..."
            className="min-w-[220px] flex-1"
          />
          <FilterSelect
            label="Type"
            value={type}
            onChange={setType}
            className="w-[140px]"
            options={[
              { value: ALL, label: "All Types" },
              ...Object.entries(EVENT_TYPE).map(([value, { label }]) => ({ value, label })),
            ]}
          />
          <FilterSelect
            label="Owner"
            value={ownerId}
            onChange={setOwnerId}
            className="w-[160px]"
            options={[
              { value: ALL, label: "Anyone" },
              ...members.map((m) => ({ value: m.id, label: m.name })),
            ]}
          />
        </div>

        {error ? (
          <div className="px-5 py-14 text-center">
            <p className="text-[13.5px] font-medium text-brand-navy">Could not load the calendar.</p>
            <p className="mt-1 text-[12.5px] text-slate-500">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 inline-flex h-9 items-center rounded-btn border border-slate-200 px-4 text-[13px] font-semibold text-accent-blue transition-colors hover:bg-slate-50"
            >
              Try again
            </button>
          </div>
        ) : view === "day" ? (
          <DayList
            day={anchor}
            events={eventsOn(events, anchor)}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onCreate={mayManage ? () => onCreateAt(anchor) : undefined}
          />
        ) : (
          <Grid
            cells={view === "month" ? monthGrid(anchor, today) : weekGrid(anchor, today)}
            events={events}
            compact={view === "month"}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onCreateAt={mayManage ? onCreateAt : undefined}
          />
        )}
      </Card>

      {selected ? (
        <div className="xl:sticky xl:top-6">
          <EventPanel
            key={selected.id}
            event={selected}
            mayManage={mayManage}
            onChanged={(message) => {
              onChanged(message);
              void load();
            }}
            onError={onError}
            onClose={() => setSelectedId(null)}
          />
        </div>
      ) : (
        <Card className="xl:sticky xl:top-6">
          <div className="px-5 py-8 text-center">
            <CalendarDays className="mx-auto h-7 w-7 text-slate-300" strokeWidth={1.6} />
            <p className="mt-2 text-[13px] font-medium text-brand-navy">
              {events.length === 0 ? "Nothing booked in this window." : "Pick an event."}
            </p>
            <p className="mt-1 text-[12.5px] text-slate-500">
              {events.length === 0
                ? "Demos booked from a call appear here automatically."
                : "Its details, lead and linked follow-up show up here."}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

function Grid({
  cells,
  events,
  compact,
  selectedId,
  onSelect,
  onCreateAt,
}: {
  cells: { date: Date; inFocus: boolean; isToday: boolean }[];
  events: ApiCalendarEvent[];
  compact: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateAt?: (day: Date) => void;
}) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <div className="min-w-[680px]">
        <div className="grid grid-cols-7 border-b border-slate-100">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="px-2 py-2 text-center text-[11.5px] font-semibold uppercase tracking-wide text-slate-500"
            >
              {day}
            </div>
          ))}
        </div>

        <div className={cn("grid grid-cols-7", compact ? "grid-rows-6" : "grid-rows-1")}>
          {cells.map((cell) => {
            const dayEvents = eventsOn(events, cell.date);
            const shown = compact ? dayEvents.slice(0, 3) : dayEvents;

            return (
              <div
                key={cell.date.toISOString()}
                onDoubleClick={() => onCreateAt?.(cell.date)}
                className={cn(
                  "min-h-[104px] border-b border-r border-slate-100 p-1.5",
                  compact ? "min-h-[104px]" : "min-h-[420px]",
                  !cell.inFocus && "bg-slate-50/60",
                  onCreateAt && "cursor-copy",
                )}
              >
                <div className="mb-1 flex items-center justify-between px-0.5">
                  <span
                    className={cn(
                      "tabular inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11.5px] font-semibold",
                      cell.isToday
                        ? "bg-accent-blue text-white"
                        : cell.inFocus
                          ? "text-brand-navy"
                          : "text-slate-400",
                    )}
                  >
                    {cell.date.getDate()}
                  </span>
                  {compact && dayEvents.length > shown.length && (
                    <span className="text-[10.5px] font-medium text-slate-400">
                      +{dayEvents.length - shown.length}
                    </span>
                  )}
                </div>

                <ul className="space-y-1">
                  {shown.map((event) => (
                    <li key={event.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(event.id)}
                        title={`${timeLabel(event.startAt)} — ${event.title}`}
                        className={cn(
                          "block w-full truncate rounded-[5px] px-1.5 py-1 text-left text-[11px] font-medium leading-tight transition-colors",
                          TYPE_CHIP[event.type],
                          event.id === selectedId && "ring-2 ring-brand-navy/25",
                        )}
                      >
                        {!event.allDay && (
                          <span className="tabular mr-1 opacity-70">
                            {timeLabel(event.startAt)}
                          </span>
                        )}
                        {event.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Tinted chips, one per event type. Kept as whole class strings so Tailwind sees them. */
const TYPE_CHIP: Record<CalendarEventType, string> = {
  DEMO: "bg-brand-green/[0.14] text-deep-green hover:bg-brand-green/[0.22]",
  MEETING: "bg-accent-blue/[0.13] text-accent-blue hover:bg-accent-blue/[0.2]",
  CALL: "bg-warning-amber/[0.16] text-[#B27400] hover:bg-warning-amber/[0.24]",
  FOLLOW_UP: "bg-accent-purple/[0.13] text-accent-purple hover:bg-accent-purple/[0.2]",
  REMINDER: "bg-slate-100 text-slate-600 hover:bg-slate-200",
};

function DayList({
  day,
  events,
  selectedId,
  onSelect,
  onCreate,
}: {
  day: Date;
  events: ApiCalendarEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate?: () => void;
}) {
  if (events.length === 0) {
    return (
      <div className="px-5 py-14 text-center">
        <p className="text-[13.5px] font-medium text-brand-navy">
          Nothing booked for {day.toLocaleDateString(undefined, { weekday: "long" })}.
        </p>
        {onCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="mt-2 text-[13px] font-semibold text-accent-blue hover:underline"
          >
            Book something
          </button>
        )}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {events.map((event) => (
        <li key={event.id}>
          <button
            type="button"
            onClick={() => onSelect(event.id)}
            className={cn(
              "flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors",
              event.id === selectedId ? "bg-accent-blue/[0.06]" : "hover:bg-slate-50/70",
            )}
          >
            <span className="tabular w-[72px] shrink-0 text-[12.5px] font-semibold text-brand-navy">
              {event.allDay ? "All day" : timeLabel(event.startAt)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate text-[13px] font-semibold text-brand-navy">
                  {event.title}
                </span>
                <Badge tone={EVENT_TYPE[event.type].tone}>{EVENT_TYPE[event.type].label}</Badge>
              </span>
              <span className="mt-0.5 block truncate text-[11.5px] text-slate-500">
                {[event.lead?.name, event.location, event.owner?.name]
                  .filter(Boolean)
                  .join(" · ") || "No details"}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function EventPanel({
  event,
  mayManage,
  onChanged,
  onError,
  onClose,
}: {
  event: ApiCalendarEvent;
  mayManage: boolean;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
  onClose: () => void;
}) {
  const [startAt, setStartAt] = useState(toLocalInput(event.startAt));
  const [endAt, setEndAt] = useState(toLocalInput(event.endAt));
  const [title, setTitle] = useState(event.title);
  const [location, setLocation] = useState(event.location ?? "");
  const [saving, setSaving] = useState(false);

  const dirty =
    title !== event.title ||
    location !== (event.location ?? "") ||
    startAt !== toLocalInput(event.startAt) ||
    endAt !== toLocalInput(event.endAt);

  async function save() {
    setSaving(true);
    try {
      await calendarApi.update(event.id, {
        title,
        location,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
      });
      onChanged(
        event.followUpId
          ? "Event saved — its follow-up moved with it."
          : "Event saved.",
      );
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : "Could not save the event.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this event? The follow-up it came from stays in the queue."))
      return;
    try {
      await calendarApi.remove(event.id);
      onChanged("Event deleted.");
      onClose();
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : "Could not delete the event.");
    }
  }

  return (
    <Card className="flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-[16px] font-bold tracking-tight text-brand-navy">
            {event.title}
          </h2>
          <p className="tabular mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-slate-500">
            <Badge tone={EVENT_TYPE[event.type].tone}>{EVENT_TYPE[event.type].label}</Badge>
            <span>{formatDateTime(event.startAt)}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close event"
          className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-navy"
        >
          <X className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {event.description && (
          <p className="mb-4 whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-700">
            {event.description}
          </p>
        )}

        {mayManage ? (
          <div className="space-y-3.5">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                className="h-9 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[12.5px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Starts</span>
                <input
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                  className="tabular h-9 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[12.5px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Ends</span>
                <input
                  type="datetime-local"
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                  className="tabular h-9 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[12.5px] font-medium text-brand-navy focus:border-brand-green focus:outline-none"
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Location</span>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={300}
                placeholder="Zoom, their office, a phone number..."
                className="h-9 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[12.5px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none"
              />
            </label>

            {dirty && (
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="flex h-9 w-full items-center justify-center gap-2 rounded-btn bg-accent-blue text-[13px] font-semibold text-white transition-colors hover:bg-[#1B6CD8] disabled:bg-slate-200 disabled:text-slate-400"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />}
                Save changes
              </button>
            )}
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-3">
            <Stat label="Starts" value={formatDateTime(event.startAt)} />
            <Stat label="Ends" value={formatDateTime(event.endAt)} />
            <Stat label="Location" value={event.location ?? "—"} />
            <Stat label="Owner" value={event.owner?.name ?? "—"} />
          </dl>
        )}

        {event.lead && (
          <section className="mt-5">
            <h3 className="text-[13px] font-bold text-brand-navy">Lead</h3>
            <Link
              href={`/leads/${event.lead.id}`}
              className="mt-2 block rounded-lg bg-slate-50 p-3 transition-colors hover:bg-slate-100"
            >
              <span className="block truncate text-[13px] font-semibold text-accent-blue">
                {event.lead.name}
              </span>
              <span className="tabular mt-0.5 flex items-center gap-1.5 text-[11.5px] text-slate-500">
                <Phone className="h-3 w-3" strokeWidth={2} />
                {event.lead.phone}
                {event.lead.city && (
                  <>
                    <MapPin className="ml-1 h-3 w-3" strokeWidth={2} />
                    {event.lead.city}
                  </>
                )}
              </span>
            </Link>
          </section>
        )}

        {event.followUp && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-accent-purple/[0.07] p-2.5 text-[12px] leading-relaxed text-accent-purple">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
            Linked to a follow-up in the queue. Moving this event moves that too.
          </p>
        )}

        {event.campaign && (
          <p className="mt-3 text-[12.5px] text-slate-600">
            Campaign:{" "}
            <Link
              href={`/campaigns/${event.campaign.id}`}
              className="font-semibold text-accent-blue hover:underline"
            >
              {event.campaign.name}
            </Link>
          </p>
        )}
      </div>

      {mayManage && (
        <div className="shrink-0 border-t border-slate-100 p-4">
          <button
            type="button"
            onClick={() => void remove()}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-btn border border-alert-red/50 text-[13px] font-semibold text-alert-red transition-colors hover:bg-alert-red/[0.07]"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
            Delete event
          </button>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="tabular truncate text-[12.5px] font-semibold text-brand-navy">{value}</dd>
    </div>
  );
}

/** See the identical helper on Follow-ups: `toISOString` here would shift by the offset. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export { isSameDay };
