import { AttemptLimiter } from "./attempt-limiter";
import {
  EMAIL_CODE_WINDOW_MS,
  checkEmailVerificationCode,
  emailCodeWindow,
  emailVerificationCode,
  passwordFingerprint,
  signPurposeToken,
  verifyPurposeToken,
} from "./purpose-token";
import { generateInvitationToken, hashInvitationToken } from "../users/invitation-token";

/**
 * Reset links and sign-in challenges are credentials in their own right. What matters is
 * everything they must refuse: a changed byte, the wrong purpose, a stale clock, the
 * wrong secret.
 */
describe("purpose tokens", () => {
  const secret = "test-secret-with-enough-length-0123456789";
  const now = Date.UTC(2026, 8, 16, 12, 0, 0);
  const claims = { u: "user-1", t: "tenant-1", f: "fingerprint" };

  it("round-trips claims for the purpose it was signed for", () => {
    const token = signPurposeToken(secret, "password-reset", claims, 60_000, now);
    expect(verifyPurposeToken(secret, "password-reset", token, now + 1_000)).toMatchObject(claims);
  });

  it("refuses the wrong purpose, a tampered payload, the wrong secret and expiry", () => {
    const token = signPurposeToken(secret, "password-reset", claims, 60_000, now);
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), u: "user-2" }),
    ).toString("base64url");

    expect(verifyPurposeToken(secret, "login-2fa", token, now)).toBeNull();
    expect(verifyPurposeToken(secret, "password-reset", `${forged}.${signature}`, now)).toBeNull();
    expect(verifyPurposeToken(`${secret}x`, "password-reset", token, now)).toBeNull();
    expect(verifyPurposeToken(secret, "password-reset", token, now + 60_000)).toBeNull();
    expect(verifyPurposeToken(secret, "password-reset", "not-a-token", now)).toBeNull();
    expect(verifyPurposeToken(secret, "password-reset", undefined, now)).toBeNull();
  });

  it("fingerprints change with the password hash, which is what makes resets single-use", () => {
    expect(passwordFingerprint("$argon2id$hash-one")).not.toBe(passwordFingerprint("$argon2id$hash-two"));
    expect(passwordFingerprint("$argon2id$hash-one")).toBe(passwordFingerprint("$argon2id$hash-one"));
  });
});

describe("email verification codes", () => {
  const secret = "test-secret-with-enough-length-0123456789";
  const now = Date.UTC(2026, 8, 16, 12, 7, 0);

  it("is six digits, stable within a window, and personal", () => {
    const window = emailCodeWindow(now);
    const code = emailVerificationCode(secret, "user-1", "Priya@Example.com", window);
    expect(code).toMatch(/^\d{6}$/);
    expect(emailVerificationCode(secret, "user-1", "priya@example.com", window)).toBe(code);
    expect(emailVerificationCode(secret, "user-2", "priya@example.com", window)).not.toBe(code);
  });

  it("accepts the current and the previous window only", () => {
    const window = emailCodeWindow(now);
    const current = emailVerificationCode(secret, "user-1", "priya@example.com", window);
    expect(checkEmailVerificationCode(secret, "user-1", "priya@example.com", current, now)).toBe(true);
    expect(
      checkEmailVerificationCode(secret, "user-1", "priya@example.com", current, now + EMAIL_CODE_WINDOW_MS),
    ).toBe(true);
    expect(
      checkEmailVerificationCode(secret, "user-1", "priya@example.com", current, now + 2 * EMAIL_CODE_WINDOW_MS),
    ).toBe(false);
    expect(checkEmailVerificationCode(secret, "user-1", "other@example.com", current, now)).toBe(false);
  });
});

describe("AttemptLimiter", () => {
  it("allows the limit per window, then refuses until the window passes", () => {
    const limiter = new AttemptLimiter(2, 1_000);
    expect(limiter.hit("a", 0)).toBe(true);
    expect(limiter.hit("a", 10)).toBe(true);
    expect(limiter.hit("a", 20)).toBe(false);
    expect(limiter.retryAfterSeconds("a", 20)).toBe(1);
    expect(limiter.hit("b", 20)).toBe(true);
    expect(limiter.hit("a", 1_000)).toBe(true);
    limiter.clear("a");
    expect(limiter.retryAfterSeconds("a", 1_000)).toBe(0);
  });
});

describe("invitation tokens", () => {
  it("stores only a hash that matches the token in the link", () => {
    const { token, hash } = generateInvitationToken();
    expect(token).toMatch(/^inv_[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(hashInvitationToken(token));
    expect(hash).not.toContain(token.slice(4, 20));
    expect(generateInvitationToken().token).not.toBe(token);
  });
});
