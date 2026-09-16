"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, MapPin, Megaphone, Play, User, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Waveform } from "@/components/calls/waveform";
import { AgentAvatar } from "@/components/calls/call-status-badge";
import { transcriptsApi, type ApiCallDetailed, type TranscriptSegment } from "@/lib/api-client";
import { CALL_OUTCOME, CALL_STATUS } from "@/lib/status";
import { formatDateTime, formatDuration } from "@/lib/utils";

/**
 * The selected call, on the right of Call History.
 *
 * Transcript segments are fetched only when a call is selected and only when one exists,
 * rather than being included in every row of the list — a page of fifteen calls should
 * not carry fifteen transcripts the reader will never open.
 */
export function CallDetailPanel({
  call,
  onClose,
}: {
  call: ApiCallDetailed;
  onClose: () => void;
}) {
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);

  useEffect(() => {
    if (!call.transcript) {
      setSegments(null);
      return;
    }

    let cancelled = false;
    setLoadingTranscript(true);
    transcriptsApi
      .segments(call.transcript.id)
      .then((rows) => {
        if (!cancelled) setSegments(rows);
      })
      .catch(() => {
        if (!cancelled) setSegments([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTranscript(false);
      });

    return () => {
      cancelled = true;
    };
  }, [call.transcript]);

  const status = CALL_STATUS[call.status];
  const outcome = call.outcome ? CALL_OUTCOME[call.outcome] : null;

  return (
    <Card className="flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <span className="flex items-center gap-2">
          <Badge tone={status?.tone ?? "gray"}>{status?.label ?? call.status}</Badge>
          {outcome && <Badge tone={outcome.tone}>{outcome.label}</Badge>}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close call details"
          className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-navy"
        >
          <X className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[16px] font-bold tracking-tight text-brand-navy">
              {call.lead?.name ?? call.phone}
            </h2>
            <p className="tabular text-[12.5px] text-slate-500">{call.phone}</p>
          </div>
          {call.lead && (
            <Link
              href={`/leads/${call.lead.id}`}
              aria-label="Open the lead"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-btn border border-slate-200 text-accent-blue transition-colors hover:bg-slate-50"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.2} />
            </Link>
          )}
        </div>

        <dl className="mt-3 space-y-1.5">
          {call.lead?.contactPerson && <MetaRow icon={User} value={call.lead.contactPerson} />}
          {call.lead?.city && <MetaRow icon={MapPin} value={call.lead.city} />}
          {call.campaign && (
            <MetaRow icon={Megaphone} value={`Campaign: ${call.campaign.name}`} />
          )}
        </dl>

        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3">
          <Stat label="Started" value={call.startedAt ? formatDateTime(call.startedAt) : "—"} />
          <Stat
            label="Duration"
            value={call.durationSeconds ? formatDuration(call.durationSeconds) : "—"}
          />
          <Stat label="Credits" value={String(call.creditsUsed)} />
          <Stat label="Provider" value={call.provider ?? "—"} />
        </dl>

        {call.failureReason && (
          <p className="mt-3 rounded-lg bg-alert-red/[0.07] p-3 text-[12.5px] text-[#C93B3B]">
            {call.failureReason}
          </p>
        )}

        {call.recording ? (
          <section className="mt-5">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[14px] font-bold text-brand-navy">Recording</h3>
              <span className="tabular text-[11.5px] text-slate-400">
                {formatDuration(call.recording.durationSeconds)}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2.5">
              <button
                type="button"
                aria-label="Play recording"
                disabled
                title="No object storage is connected, so the audio cannot be played yet."
                className="flex h-9 w-9 shrink-0 cursor-not-allowed items-center justify-center rounded-full bg-accent-blue text-white opacity-50"
              >
                <Play className="ml-0.5 h-3.5 w-3.5 fill-current" strokeWidth={0} />
              </button>
              <Waveform bars={30} height={26} progress={0} className="min-w-0 flex-1" />
            </div>
            {/* Same wording as the Recordings page: a play button that explains beats one
                that silently does nothing. */}
            <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
              Audio playback needs object storage, which is not connected yet.
            </p>
          </section>
        ) : (
          <p className="mt-5 text-[12.5px] text-slate-500">
            No recording for this call.
          </p>
        )}

        <section className="mt-5">
          <h3 className="text-[14px] font-bold text-brand-navy">Transcript</h3>

          {!call.transcript && (
            <p className="mt-2 text-[12.5px] text-slate-500">
              This call was not transcribed.
            </p>
          )}

          {loadingTranscript && (
            <div className="mt-2 space-y-2" aria-busy="true">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="h-8 animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          )}

          {segments && segments.length > 0 && (
            <ul className="mt-2.5 space-y-3">
              {segments.map((segment) => (
                <li key={segment.id} className="flex gap-2.5">
                  <AgentAvatar
                    initial={segment.speaker === "AI_AGENT" ? "A" : "C"}
                    tone={segment.speaker === "AI_AGENT" ? "blue" : "gray"}
                    size={24}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12px] font-bold text-brand-navy">
                        {segment.speakerLabel}
                      </span>
                      <span className="tabular shrink-0 text-[10.5px] text-slate-400">
                        {formatDuration(Math.round(segment.startMs / 1000))}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-slate-600">
                      {segment.text}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {segments && segments.length === 0 && !loadingTranscript && (
            <p className="mt-2 text-[12.5px] text-slate-500">
              The transcript is empty.
            </p>
          )}
        </section>

        {call.transcript?.summary && (
          <section className="mt-5">
            <h3 className="text-[14px] font-bold text-brand-navy">AI Summary</h3>
            <p className="mt-2 rounded-lg bg-accent-purple/[0.06] p-3 text-[12.5px] leading-relaxed text-slate-600">
              {call.transcript.summary}
            </p>
          </section>
        )}
      </div>
    </Card>
  );
}

function MetaRow({ icon: Icon, value }: { icon: typeof User; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={2} />
      <span className="min-w-0 truncate text-[12.5px] text-slate-600">{value}</span>
    </div>
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
