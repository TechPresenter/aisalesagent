import { ROLE_RANK, ROLES, type Role } from "@appsgain/shared";
import { ApiError, type InvitationSent } from "./api-client";

/**
 * The decisions behind Settings → Team's invitations, kept apart from the components so
 * they can be tested without a DOM: which roles a person may hand out, what to say once
 * an invitation is created, and how to ask support to delete a workspace.
 *
 * The API enforces every rule here (invitations.service.ts, users.service.ts). These only
 * keep the screen from offering a choice the server would refuse.
 */

/**
 * The roles someone may invite to, or give a teammate, highest first: their own and
 * below. Never SUPER_ADMIN — that is the platform operator, not a workspace role, and the
 * invite endpoint refuses it outright. Empty while the role is unknown.
 */
export function assignableRoles(actor: Role | null): Role[] {
  if (!actor) return [];
  return ROLES.filter((role) => role !== "SUPER_ADMIN" && ROLE_RANK[role] <= ROLE_RANK[actor]);
}

/** AGENT when it is on offer — the role most invitations are for — else the lowest one. */
export function defaultInviteRole(roles: readonly Role[]): Role | null {
  if (roles.includes("AGENT")) return "AGENT";
  return roles[roles.length - 1] ?? null;
}

/**
 * Whether the actor may change a teammate holding `target`, or resend an invitation to
 * it: only when it is a role they could hand out themselves. That is the API's rule —
 * nobody acts on someone ranked above them — and it also keeps a platform SUPER_ADMIN, or
 * a role this build does not know, out of reach rather than guessed at.
 */
export function canAssign(actor: Role | null, target: string): boolean {
  return (assignableRoles(actor) as string[]).includes(target);
}

/** One line per role, so whoever is inviting can see what they are handing over. */
export const ROLE_SUMMARY: Record<Exclude<Role, "SUPER_ADMIN">, string> = {
  OWNER: "Everything, including billing and credits.",
  ADMIN: "Manages the team, integrations and settings.",
  MANAGER: "Runs campaigns, imports and exports leads, manages AI agents.",
  AGENT: "Works leads: calls, notes and follow-ups.",
  VIEWER: "Can look at everything, change nothing.",
};

/** Deliberately loose: the API validates properly. This only catches an obvious typo. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export interface InviteOutcome {
  tone: "ok" | "notice";
  /** What happened, in one sentence. */
  headline: string;
  /** Why the email did not go, when it did not. Shown as information, not as an error. */
  detail?: string;
}

/**
 * What to tell the person who just invited (or re-invited) someone.
 *
 * An email that could not be sent is not a failed invitation: the invitation exists and
 * the link in hand works. While the platform has no mail provider configured that is the
 * normal case, so it reads as an instruction — pass the link on — rather than as an error.
 */
export function describeInviteOutcome(sent: InvitationSent): InviteOutcome {
  const email = sent.invitation.email;
  if (sent.emailSent) {
    return {
      tone: "ok",
      headline: `Invitation emailed to ${email}. You can also share the link below.`,
    };
  }
  return {
    tone: "notice",
    headline: `The invitation is ready, but it was not emailed. Copy the link below and send it to ${email} yourself.`,
    detail: sent.emailError,
  };
}

/**
 * The inline message for a refused invitation. The API's own words for anything the
 * person can act on — already a member (409), above their role (403), a bad address
 * (400) — and a plain retry message for everything else.
 */
export function inviteErrorText(cause: unknown): string {
  if (cause instanceof ApiError && cause.status < 500) return cause.message;
  return "Could not reach the server. Try again.";
}

/** "Expires in 7 days", "Expires within a day", "Expired". */
export function expiryLabel(
  expiresAt: string,
  status: "PENDING" | "EXPIRED",
  now = Date.now(),
): string {
  const left = new Date(expiresAt).getTime() - now;
  if (status === "EXPIRED" || left <= 0) return "Expired";
  // Rounded up, so a link created a moment ago reads "7 days", as the dialog promised.
  const days = Math.ceil(left / 86_400_000);
  if (days <= 1) return "Expires within a day";
  return `Expires in ${days} days`;
}

/**
 * A mailto link asking support to delete the workspace, or null when no support address
 * is configured — then the screen says to contact support without a link that would go
 * nowhere. Stands in for self-service deletion, which needs the purge and grace period
 * the API does not have yet.
 *
 * The workspace's sign-in name is what support needs to find it; the requester's sign-in
 * email lets support check they are its owner even when they write from another address.
 */
export function workspaceDeletionMailto(
  supportEmail: string | null | undefined,
  request: {
    workspaceName?: string | null;
    subdomain?: string | null;
    requesterEmail?: string | null;
  },
): string | null {
  const to = supportEmail?.trim();
  if (!to || !looksLikeEmail(to)) return null;

  const workspace = request.subdomain?.trim();
  const subject = workspace ? `Delete workspace: ${workspace}` : "Delete my workspace";
  const lines = [
    "Please delete this workspace and the data in it.",
    "",
    `Workspace name: ${request.workspaceName?.trim() || "—"}`,
    `Workspace (sign-in name): ${workspace || "—"}`,
    `Requested by: ${request.requesterEmail?.trim() || "—"}`,
  ];
  // RFC 6068: the address is percent-encoded like the rest, and line breaks are CRLF.
  const address = encodeURIComponent(to).replace(/%40/g, "@");
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\r\n"))}`;
}
