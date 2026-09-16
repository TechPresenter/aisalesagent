import { ApiError, callsApi } from "./api-client";

/** A one-line result a page shows above its content, green or red. */
export interface ActionNotice {
  tone: "ok" | "bad";
  text: string;
}

/**
 * Places a call to one lead and says what happened, in words a page can show.
 *
 * The calling gates — credits, call window, do-not-call, calling switched off — refuse
 * with reasons rather than throwing, so "not placed" is an ordinary answer here.
 */
export async function placeCall(lead: { id: string; name: string }): Promise<ActionNotice> {
  try {
    const outcome = await callsApi.place(lead.id);
    if (outcome.placed) {
      return { tone: "ok", text: `Calling ${lead.name}. Follow the call live on AI Calling.` };
    }
    const reasons = (outcome.blockedBy ?? [])
      .map((reason) => reason.toLowerCase().replace(/_/g, " "))
      .join(", ");
    return {
      tone: "bad",
      text: outcome.message ?? `Call not placed: ${reasons || "blocked by the calling rules"}.`,
    };
  } catch (cause) {
    return {
      tone: "bad",
      text: cause instanceof ApiError ? cause.message : "Could not place the call.",
    };
  }
}

/** wa.me takes bare digits with the country code: "+91 98765 43210" -> "919876543210". */
export function whatsAppHref(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}
