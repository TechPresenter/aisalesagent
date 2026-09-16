"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Smile, Meh, Frown, Sparkles } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { transcriptsApi, type TranscriptStats } from "@/lib/api-client";
import type { Tone } from "@/lib/status";

/**
 * Transcripts KPI strip.
 *
 * "Analysed" is counted separately from "Transcripts" on purpose: transcription and the
 * AI analysis pass are different steps that fail independently, and the gap between the
 * two numbers is the thing worth noticing.
 */
export function TranscriptsStatsStrip() {
  const [stats, setStats] = useState<TranscriptStats | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setFailed(false);
    transcriptsApi
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

  useEffect(() => load(), [load]);

  if (failed) {
    return (
      <Card className="mb-5 px-4 py-3 text-[13px] text-slate-500">
        Could not load transcript totals. The rest of the page still works.
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
    { label: "Transcripts", value: stats?.total ?? 0, icon: FileText, tone: "blue" },
    { label: "Positive", value: stats?.positive ?? 0, icon: Smile, tone: "green" },
    { label: "Neutral", value: stats?.neutral ?? 0, icon: Meh, tone: "gray" },
    { label: "Negative", value: stats?.negative ?? 0, icon: Frown, tone: "red" },
    { label: "AI Analysed", value: stats?.analysed ?? 0, icon: Sparkles, tone: "purple" },
  ];

  return (
    <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
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
