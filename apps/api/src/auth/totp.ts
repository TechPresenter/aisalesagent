import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238) for two-factor authentication, compatible
 * with Google Authenticator, Microsoft Authenticator, 1Password and the rest: SHA-1, six
 * digits, thirty-second steps. Those parameters are not a preference — they are the only
 * ones every authenticator app supports.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const TOTP_STEP_SECONDS = 30;

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Not a base32 string");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(bytes);
}

/** RFC 4226 HOTP: the code for one counter value. */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

/** 160 random bits, the size RFC 4226 recommends, as the base32 an authenticator app takes. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * The step a code belongs to, or null when it matches none.
 *
 * One step either side is accepted, because phone clocks drift and a person needs a few
 * seconds to type. `afterStep` is replay protection: a code whose step is not later than
 * the last one accepted is refused, so a code seen over someone's shoulder is spent the
 * moment its owner uses it.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  options: { now?: number; window?: number; afterStep?: number | null } = {},
): number | null {
  const candidate = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(candidate)) return null;

  const secret = base32Decode(secretBase32);
  const current = totpStep(options.now);
  const window = options.window ?? 1;

  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset;
    if (options.afterStep !== undefined && options.afterStep !== null && step <= options.afterStep) {
      continue;
    }
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(candidate))) return step;
  }
  return null;
}

/** The URI an authenticator app reads from the QR code. */
export function otpauthUri(input: { issuer: string; account: string; secret: string }): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: "6",
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── backup codes ────────────────────────────────────────────────────────────────────

/** No 0/o, 1/l/i: a code copied from paper should not depend on telling those apart. */
const BACKUP_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export const BACKUP_CODE_COUNT = 10;

/** Ten single-use codes like "k7m2-9xqa", for when the phone is lost. */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    let code = "";
    for (let index = 0; index < 8; index += 1) {
      code += BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)];
    }
    return `${code.slice(0, 4)}-${code.slice(4)}`;
  });
}

/** What a person typed, reduced to what was issued: case, spaces and the hyphen ignored. */
export function normaliseBackupCode(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function looksLikeBackupCode(input: string): boolean {
  return /^[a-z0-9]{8}$/.test(normaliseBackupCode(input));
}

/**
 * Keyed with a server secret rather than a bare hash: eight characters is plenty against
 * online guessing behind a lockout, but not against an offline attack on a leaked table.
 */
export function hashBackupCode(key: Buffer, code: string): string {
  return createHmac("sha256", key).update(normaliseBackupCode(code)).digest("hex");
}
