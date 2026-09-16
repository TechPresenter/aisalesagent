/**
 * TRD §8 "Key webhook events" — what a workspace can point a webhook, a chat channel, an
 * automation or an analytics tool at.
 *
 * The keys are a public contract: somebody's Zap filters on "lead.created", so a key is
 * never renamed. A new event is added; an old one is retired by no longer being emitted,
 * never by changing what its name means.
 */
export const PLATFORM_EVENTS = [
  {
    key: "lead.created",
    label: "Lead created",
    description: "A lead was added by hand or through the API.",
  },
  {
    key: "leads.imported",
    label: "Leads imported",
    description: "A CSV import finished adding leads.",
  },
  {
    key: "lead.status_changed",
    label: "Lead status changed",
    description: "A lead moved stage, whether a person moved it or a call did.",
  },
  {
    key: "call.completed",
    label: "Call finished",
    description: "An AI call ended, connected or not.",
  },
  {
    key: "call.outcome_changed",
    label: "Call outcome corrected",
    description: "Someone changed the outcome recorded for a call.",
  },
  {
    key: "followup.due",
    label: "Follow-up due",
    description: "A follow-up reached its reminder time, or its due time when it has none.",
  },
  {
    key: "credits.low_balance",
    label: "Credits running low",
    description: "The credit wallet crossed its low-balance line or ran out.",
  },
] as const;

export type PlatformEvent = (typeof PLATFORM_EVENTS)[number]["key"];

export const PLATFORM_EVENT_KEYS: PlatformEvent[] = PLATFORM_EVENTS.map((event) => event.key);

/** Sent by "Send test" only. Never subscribable, so it never arrives unasked. */
export const TEST_EVENT = "test.ping";

export type DeliverableEvent = PlatformEvent | typeof TEST_EVENT;

export function isPlatformEvent(value: unknown): value is PlatformEvent {
  return typeof value === "string" && (PLATFORM_EVENT_KEYS as string[]).includes(value);
}

/** What every destination receives, whatever it is. */
export interface EventEnvelope {
  id: string;
  event: DeliverableEvent;
  createdAt: string;
  workspaceId: string;
  data: Record<string, unknown>;
}
