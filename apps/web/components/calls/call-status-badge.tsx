import { Badge } from "@/components/ui/badge";
import type { Tone } from "@/lib/status";
import type { CallRecord } from "@/lib/mock-calls";

/**
 * The call-log status badge.
 *
 * Call History mixes two things the rest of the app keeps apart: the *technical* status
 * of the call (Connected, No Answer, Busy, Missed) and the *sales* outcome it produced
 * (Interested, Follow-up, Not Interested). The log shows whichever is more informative
 * per row — a call that connected and produced an outcome shows the outcome, because
 * "Connected" tells a salesperson nothing they want to know.
 *
 * Tones still come from the one semantic scheme: green positive, blue informational,
 * red negative, amber attention, gray inactive.
 */
const CALL_LOG_STATUS: Record<CallRecord["status"], { label: string; tone: Tone }> = {
  CONNECTED: { label: "Connected", tone: "green" },
  INTERESTED: { label: "Interested", tone: "green" },
  FOLLOW_UP: { label: "Follow-up", tone: "blue" },
  NOT_INTERESTED: { label: "Not Interested", tone: "red" },
  NO_ANSWER: { label: "No Answer", tone: "gray" },
  MISSED: { label: "Missed", tone: "red" },
  BUSY: { label: "Busy", tone: "amber" },
  QUEUED: { label: "Queued", tone: "gray" },
  DIALING: { label: "Dialing", tone: "gray" },
  RINGING: { label: "Ringing", tone: "blue" },
  ON_HOLD: { label: "On Hold", tone: "amber" },
  TRANSFERRING: { label: "Transferring", tone: "blue" },
  COMPLETED: { label: "Completed", tone: "green" },
  FAILED: { label: "Failed", tone: "red" },
  VOICEMAIL: { label: "Voicemail", tone: "amber" },
  CANCELLED: { label: "Cancelled", tone: "gray" },
};

export function CallLogStatusBadge({ status }: { status: CallRecord["status"] }) {
  const { label, tone } = CALL_LOG_STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

/** The circular agent avatar with its initial, tinted by the agent's own tone. */
export function AgentAvatar({
  initial,
  tone,
  size = 28,
}: {
  initial: string;
  tone: Tone;
  size?: number;
}) {
  const TINT: Record<Tone, string> = {
    green: "bg-brand-green/[0.16] text-deep-green",
    blue: "bg-accent-blue/[0.16] text-accent-blue",
    purple: "bg-accent-purple/[0.16] text-accent-purple",
    amber: "bg-warning-amber/[0.18] text-[#B4761A]",
    red: "bg-alert-red/[0.16] text-[#C93B3B]",
    gray: "bg-neutral-gray/[0.18] text-[#5E6873]",
  };

  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold ${TINT[tone]}`}
    >
      {initial}
    </span>
  );
}
