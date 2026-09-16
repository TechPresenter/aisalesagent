"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Pencil, Smile, Sparkles } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { notesApi, type NoteStats } from "@/lib/api-client";
import type { Tone } from "@/lib/status";

/**
 * Sales Notes KPI strip.
 *
 * "AI Written" and "Edited" sit next to each other deliberately: the second is the number
 * of AI notes a person has since rewritten, and the ratio between them is the only honest
 * read on whether the model's notes are being trusted as written.
 */
export function NotesStatsStrip({ refreshKey = 0 }: { refreshKey?: number }) {
  const [stats, setStats] = useState<NoteStats | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setFailed(false);
    notesApi
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
        Could not load note totals. The rest of the page still works.
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

  const cards: { label: string; value: number; icon: typeof FileText; tone: Tone }[] = [
    { label: "Total Notes", value: stats?.total ?? 0, icon: FileText, tone: "blue" },
    { label: "Positive Notes", value: stats?.positive ?? 0, icon: Smile, tone: "green" },
    { label: "AI Written", value: stats?.aiGenerated ?? 0, icon: Sparkles, tone: "purple" },
    { label: "Edited", value: stats?.edited ?? 0, icon: Pencil, tone: "amber" },
  ];

  return (
    <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(({ label, value, icon, tone }) =>
        stats ? (
          <StatCard
            key={label}
            label={label}
            value={value}
            sparkline={[]}
            icon={icon}
            tone={tone}
          />
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
