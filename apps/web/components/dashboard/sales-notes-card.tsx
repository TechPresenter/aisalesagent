import Link from "next/link";
import { ArrowRight, Sparkles, StickyNote } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { SalesNote } from "@/lib/types";

/**
 * Feature List §9 — the AI Sales Notes panel: the latest call's speaker-labelled
 * transcript preview, the AI summary and the 0–100 lead score.
 *
 * Brand Guidelines §3 puts AI-generated content in Accent Purple, so the transcript
 * marker and the summary block both carry purple rather than the brand green used for
 * human-positive outcomes — a reader can tell at a glance which text the model wrote.
 */
export function SalesNotesCard({ note, loading }: { note: SalesNote | null; loading?: boolean }) {
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader>
        <CardTitle>
          AI Sales Notes{" "}
          <span className="text-[13px] font-normal text-slate-400">(Latest Call)</span>
        </CardTitle>
        <Link
          href="/transcripts"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-btn border border-slate-200 px-3 py-1.5 text-[12.5px] font-medium text-brand-navy transition-colors hover:bg-slate-50"
        >
          View Full Transcript
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </CardHeader>

      {!note ? (
        <p className="px-5 py-12 text-center text-[13px] text-slate-400">
          {loading
            ? "Loading the latest call…"
            : "No transcribed calls yet. Summaries appear here after the AI agent completes a call."}
        </p>
      ) : (
        <div className="flex flex-1 flex-col gap-3 px-5 pb-5 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-purple/[0.12]">
                <StickyNote className="h-4 w-4 text-accent-purple" strokeWidth={1.9} />
              </span>
              {note.leadId ? (
                <Link
                  href={`/leads/${note.leadId}`}
                  className="text-[13.5px] font-bold text-brand-navy hover:text-brand-green"
                >
                  {note.leadName}
                </Link>
              ) : (
                <span className="text-[13.5px] font-bold text-brand-navy">{note.leadName}</span>
              )}
            </div>
            <span className="tabular shrink-0 text-[11.5px] text-slate-400">{note.timestamp}</span>
          </div>

          <div className="scrollbar-thin max-h-[168px] space-y-1.5 overflow-y-auto pr-1">
            {note.turns.map((turn, i) => (
              <p key={i} className="text-[12.5px] leading-relaxed text-slate-600">
                <span
                  className={
                    turn.speaker === "AI"
                      ? "font-bold text-accent-purple"
                      : "font-bold text-brand-navy"
                  }
                >
                  {turn.label ? `${turn.label}:` : turn.speaker === "AI" ? "AI:" : "Client:"}
                </span>{" "}
                {turn.text}
              </p>
            ))}
          </div>

          <div className="mt-auto rounded-xl bg-brand-green/[0.07] p-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-deep-green">
                <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
                AI Summary
              </span>
              {note.leadScore !== undefined && (
                <span className="tabular shrink-0 rounded-full bg-brand-green px-2.5 py-1 text-[11px] font-bold text-white">
                  Lead Score: {note.leadScore}/100
                </span>
              )}
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-slate-700">{note.summary}</p>
          </div>
        </div>
      )}
    </Card>
  );
}
