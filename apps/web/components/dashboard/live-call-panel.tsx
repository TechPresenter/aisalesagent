"use client";

import Image from "next/image";
import Link from "next/link";
import { Headphones, Loader2, PhoneOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ActionNotice } from "@/lib/lead-actions";
import { cn, formatDuration, initialsOf } from "@/lib/utils";
import type { LiveCall } from "@/lib/types";

/** Fixed bar heights, so the waveform renders identically on server and client. */
const BARS = [
  0.35, 0.55, 0.8, 0.45, 0.95, 0.6, 0.3, 0.75, 1, 0.5, 0.85, 0.4, 0.7, 0.9, 0.35, 0.65, 1,
  0.45, 0.8, 0.55, 0.3, 0.7, 0.95, 0.5, 0.75, 0.4, 0.85, 0.6, 0.35, 0.9, 0.55, 0.8, 0.45,
  0.7, 1, 0.5, 0.65, 0.3, 0.85, 0.6,
];

/**
 * Feature List §5 — the Live Call detail panel: waveform, agent identity, Listen Live
 * and Force End Call. Brand Guidelines §7: the human-oversight controls are always
 * visible alongside the AI action, never behind a menu.
 *
 * The waveform is decorative until Phase 6 streams real audio, so it is aria-hidden and
 * pauses whenever the caller is not actually talking. Listen Live needs that same audio
 * stream, so until it exists the button says so instead of doing nothing.
 *
 * The elapsed time is read straight off the call the parent passes down. A second timer
 * here would race the table's and the two clocks would drift apart on screen.
 */
export function LiveCallPanel({
  call,
  onEnd,
  ending,
  notice,
}: {
  call?: LiveCall;
  /** Absent for seed calls, which have no API to hang up through. */
  onEnd?: (call: LiveCall) => void;
  ending?: boolean;
  notice?: ActionNotice | null;
}) {
  if (!call) {
    return (
      <Card className="flex min-w-0 flex-col items-center justify-center gap-2 p-5 text-center">
        <PhoneOff className="h-6 w-6 text-slate-300" strokeWidth={1.9} />
        <p className="text-[14px] font-bold text-brand-navy">No live calls</p>
        <p className="max-w-[240px] text-[12.5px] leading-relaxed text-slate-500">
          Calls placed from AI Calling or a lead&apos;s page show here while they are in progress.
        </p>
        {notice && <NoticeLine notice={notice} />}
        <Link
          href="/ai-calling"
          className="mt-1 text-[12.5px] font-semibold text-accent-blue hover:underline"
        >
          Open AI Calling
        </Link>
      </Card>
    );
  }

  const talking = call.status === "CONNECTED";

  return (
    <Card className="flex min-w-0 flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-alert-red/[0.12] px-2.5 py-1 text-[11.5px] font-semibold text-alert-red">
          <span className="h-1.5 w-1.5 rounded-full bg-alert-red" />
          Live Call
        </span>
        <span className="tabular text-[13px] font-semibold text-brand-navy">
          {formatDuration(call.duration)}
        </span>
      </div>

      <div className="mt-5 flex flex-col items-center text-center">
        <div className="relative">
          {talking && (
            <span className="absolute inset-0 animate-pulse-ring rounded-full bg-brand-green/30" />
          )}
          {call.persona.avatarUrl ? (
            <Image
              src={call.persona.avatarUrl}
              alt=""
              width={76}
              height={76}
              className="relative h-[76px] w-[76px] rounded-full object-cover ring-2 ring-white"
            />
          ) : (
            <span className="relative flex h-[76px] w-[76px] items-center justify-center rounded-full bg-accent-purple/[0.13] text-[22px] font-bold text-accent-purple ring-2 ring-white">
              {initialsOf(call.persona.name)}
            </span>
          )}
        </div>

        {/* Decorative: it visualises that audio is flowing, not what is being said. */}
        <div className="mt-4 flex h-11 w-full items-center justify-center gap-[3px]" aria-hidden="true">
          {BARS.map((scale, i) => (
            <span
              key={i}
              className="w-[3px] shrink-0 origin-center rounded-full bg-accent-blue/70"
              style={{
                height: `${scale * 100}%`,
                animation: talking ? `wave 1s ease-in-out ${(i % 7) * 0.09}s infinite` : undefined,
                transform: talking ? undefined : "scaleY(0.3)",
              }}
            />
          ))}
        </div>

        <p className="mt-3 text-[14px] font-bold text-brand-navy">
          {call.persona.name} (AI Sales Agent)
        </p>
        <p className="mt-1.5 text-[12px] text-slate-500">Talking to</p>
        <p className="text-[13px] font-semibold text-brand-navy">{call.clinicName}</p>
        <p className="tabular text-[12.5px] text-slate-500">{call.phone}</p>
      </div>

      {notice && <NoticeLine notice={notice} />}

      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <Button
          variant="danger"
          onClick={() => onEnd?.(call)}
          disabled={!onEnd || ending}
          title={onEnd ? undefined : "Start the API to control calls."}
        >
          {ending ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          ) : (
            <PhoneOff className="h-4 w-4" strokeWidth={2} />
          )}
          End Call
        </Button>
        <Button variant="secondary" disabled title="Live audio streaming is not available yet.">
          <Headphones className="h-4 w-4" strokeWidth={2} />
          Listen Live
        </Button>
      </div>
    </Card>
  );
}

function NoticeLine({ notice }: { notice: ActionNotice }) {
  return (
    <p
      role="status"
      className={cn(
        "mt-4 w-full rounded-btn px-3 py-2 text-center text-[12px] font-medium",
        notice.tone === "ok"
          ? "bg-brand-green/[0.1] text-deep-green"
          : "bg-alert-red/[0.09] text-[#C93B3B]",
      )}
    >
      {notice.text}
    </p>
  );
}
