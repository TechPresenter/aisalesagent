import { createHash, randomBytes } from "node:crypto";

/** Invitations last a week: long enough to be found in an inbox after a weekend. */
export const INVITATION_TTL_DAYS = 7;

/**
 * The token that goes in the invitation link. Only its SHA-256 is stored (the schema's
 * `tokenHash`), so reading the invitations table does not yield links anyone can accept.
 */
export function generateInvitationToken(): { token: string; hash: string } {
  const token = `inv_${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
