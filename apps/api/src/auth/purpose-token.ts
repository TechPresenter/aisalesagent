import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * Short-lived, single-purpose tokens that need no table.
 *
 * A password-reset link and a "now enter your 2FA code" challenge each have to carry who
 * they are for, expire on their own, and be useless for anything else. An HMAC over a small
 * JSON payload does all three: the key is derived per purpose, so a reset token cannot be
 * replayed as a sign-in challenge even though both are signed from the same secret.
 *
 * Single use comes from what the claims bind to rather than from a row to delete. A reset
 * token carries a fingerprint of the password hash it was issued against; resetting the
 * password changes the hash, and every outstanding link for that account dies with it.
 */

export type TokenPurpose = "password-reset" | "login-2fa";

const MAX_TOKEN_LENGTH = 2048;

function derivedKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "appsgain.purpose-token.v1", purpose, 32));
}

export function signPurposeToken(
  secret: string,
  purpose: TokenPurpose,
  claims: Record<string, string>,
  ttlMs: number,
  now = Date.now(),
): string {
  const payload = Buffer.from(JSON.stringify({ ...claims, p: purpose, e: now + ttlMs })).toString(
    "base64url",
  );
  const signature = createHmac("sha256", derivedKey(secret, purpose)).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/** The claims of a valid, unexpired token for this purpose; null for anything else. */
export function verifyPurposeToken(
  secret: string,
  purpose: TokenPurpose,
  token: unknown,
  now = Date.now(),
): Record<string, string> | null {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, signature] = parts;

  const expected = Buffer.from(
    createHmac("sha256", derivedKey(secret, purpose)).update(payload).digest("base64url"),
  );
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (claims.p !== purpose || typeof claims.e !== "number" || claims.e <= now) return null;

    const strings: Record<string, string> = {};
    for (const [key, value] of Object.entries(claims)) {
      if (typeof value === "string") strings[key] = value;
    }
    return strings;
  } catch {
    return null;
  }
}

/** Changes whenever the password does — which is what makes a reset link single-use. */
export function passwordFingerprint(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("base64url").slice(0, 22);
}

// ── email verification codes ────────────────────────────────────────────────────────

/** A code belongs to one fifteen-minute window, and the previous window's still works. */
export const EMAIL_CODE_WINDOW_MS = 15 * 60_000;

export function emailCodeWindow(now = Date.now()): number {
  return Math.floor(now / EMAIL_CODE_WINDOW_MS);
}

/**
 * The six-digit code for a person, an address and a window. Derived rather than stored:
 * the same inputs give the same code, so "resend" repeats it instead of invalidating the
 * one already on its way, and there is no table of live codes to leak.
 */
export function emailVerificationCode(
  secret: string,
  userId: string,
  email: string,
  window: number,
): string {
  const digest = createHmac("sha256", derivedKey(secret, "email-verification"))
    .update(`${userId}:${email.toLowerCase()}:${window}`)
    .digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

/** True when `code` is this person's code for the current or the previous window. */
export function checkEmailVerificationCode(
  secret: string,
  userId: string,
  email: string,
  code: string,
  now = Date.now(),
): boolean {
  const candidate = Buffer.from(code.trim());
  return [emailCodeWindow(now), emailCodeWindow(now) - 1].some((window) => {
    const expected = Buffer.from(emailVerificationCode(secret, userId, email, window));
    return expected.length === candidate.length && timingSafeEqual(expected, candidate);
  });
}
