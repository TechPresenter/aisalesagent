"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, CalendarDays, Plus, Presentation, Sun } from "lucide-react";
import { PageTitle } from "@/components/shared/page-title";
import { PermissionGate } from "@/components/shared/permission-gate";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { CalendarView } from "@/components/calendar/calendar-view";
import { AddEventDialog } from "@/components/calendar/add-event-dialog";
import { calendarApi, type CalendarStats } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/status";

/** Feature List §11 — Calendar. */
export function CalendarScreen() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [defaultDay, setDefaultDay] = useState<Date | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const refresh = (message: string) => {
    setNotice({ tone: "ok", text: message });
    setRefreshKey((n) => n + 1);
  };

  const openFor = useCallback((day: Date) => {
    setDefaultDay(day);
    setAdding(true);
  }, []);

  return (
    <>
      <PageTitle
        title="Calendar"
        subtitle="Demos, meetings and follow-ups, in one place."
        actions={
          <PermissionGate permission="calendar.manage">
            <button
              type="button"
              onClick={() => {
                setDefaultDay(null);
                setAdding(true);
              }}
              className="inline-flex h-11 items-center gap-2 rounded-btn bg-accent-blue px-5 text-[14.5px] font-semibold text-white shadow-sm transition-colors hover:bg-[#1B6CD8]"
            >
              <Plus className="h-4 w-4" strokeWidth={2.6} />
              Add Event
            </button>
          </PermissionGate>
        }
      />

      <CalendarStatsStrip refreshKey={refreshKey} />

      {notice && (
        <div
          role="status"
          className={cn(
            "mb-4 rounded-btn px-4 py-2.5 text-[13px] font-medium",
            notice.tone === "ok"
              ? "bg-brand-green/[0.1] text-deep-green"
              : "bg-alert-red/[0.09] text-[#C93B3B]",
          )}
        >
          {notice.text}
        </div>
      )}

      <CalendarView
        refreshKey={refreshKey}
        onChanged={refresh}
        onError={(text) => setNotice({ tone: "bad", text })}
        onCreateAt={openFor}
      />

      <AddEventDialog
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={refresh}
        defaultDay={defaultDay}
      />
    </>
  );
}

function CalendarStatsStrip({ refreshKey }: { refreshKey: number }) {
  const [stats, setStats] = useState<CalendarStats | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setFailed(false);
    calendarApi
      .stats()
      .then((next) => {
        if (!cancelled) setStats(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load, refreshKey]);

  if (failed) {
    return (
      <Card className="mb-5 px-4 py-3 text-[13px] text-slate-500">
        Could not load calendar totals. The grid below still works.
        <button
          type="button"
          onClick={() => load()}
          className="ml-2 font-semibold text-accent-blue hover:underline"
        >
          Try again
        </button>
      </Card>
    );
  }

  const cards: { label: string; value: number; icon: typeof Sun; tone: Tone }[] = [
    { label: "Today", value: stats?.today ?? 0, icon: Sun, tone: "blue" },
    { label: "Next 7 Days", value: stats?.thisWeek ?? 0, icon: CalendarDays, tone: "blue" },
    { label: "Demos Ahead", value: stats?.demos ?? 0, icon: Presentation, tone: "green" },
    { label: "Follow-ups Ahead", value: stats?.followUps ?? 0, icon: CalendarCheck, tone: "purple" },
  ];

  return (
    <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(({ label, value, icon, tone }) =>
        stats ? (
          <StatCard key={label} label={label} value={value} sparkline={[]} icon={icon} tone={tone} />
        ) : (
          <Card key={label} className="flex items-center gap-3 p-4">
            <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-slate-100" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-6 w-16 animate-pulse rounded bg-slate-100" />
              <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
            </div>
          </Card>
        ),
      )}
    </div>
  );
}
