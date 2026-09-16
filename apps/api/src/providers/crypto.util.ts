import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Envelope encryption for provider credentials at rest.
 *
 * AES-256-GCM rather than CBC because GCM authenticates: a ciphertext that has been
 * tampered with fails to decrypt instead of quietly producing different plaintext. For a
 * value that becomes an API key in an outbound request, that difference matters.
 *
 * The stored format is `v1.<iv>.<authTag>.<ciphertext>`, all base64url. Versioned from
 * the start so a future key rotation or algorithm change can be told apart from the
 * current one rather than guessed at.
 *
 * The master key comes from CREDENTIALS_ENCRYPTION_KEY. It is never written to the
 * database, never returned by an endpoint, and never logged — the API surfaces only
 * `isConfigured: true`, never the ciphertext and certainly not the plaintext.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;

function masterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const secret = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    // Refusing rather than falling back to a default key: a hardcoded fallback would
    // encrypt every deployment's secrets with a key that is in the source tree, which is
    // worse than not encrypting them, because it looks safe.
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY must be set to at least 32 characters before provider " +
        "credentials can be stored. Generate one with: openssl rand -base64 48",
    );
  }

  // A fixed salt is acceptable here because the input is already a high-entropy secret
  // rather than a user-chosen password; scrypt is being used to widen it to 32 bytes,
  // not to make a weak secret expensive to guess.
  cachedKey = scryptSync(secret, "appsgain.credentials.v1", 32);
  return cachedKey;
}

export function encryptCredentials(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptCredentials(stored: string): string {
  const [version, ivPart, tagPart, dataPart] = stored.split(".");

  if (version !== VERSION || !ivPart || !tagPart || !dataPart) {
    throw new Error("Stored credentials are not in a recognised format.");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    masterKey(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * What the UI shows instead of a key: enough to recognise which key is stored, not
 * enough to use it. `sk-live-abcd1234wxyz` becomes `sk-live-••••••••wxyz`.
 */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return "•".repeat(secret.length);
  const head = secret.slice(0, Math.min(8, secret.length - 4));
  const tail = secret.slice(-4);
  return `${head}${"•".repeat(8)}${tail}`;
}

/** True when a master key is present, so setup can report the gap before a write fails. */
export function encryptionAvailable(): boolean {
  const secret = process.env.CREDENTIALS_ENCRYPTION_KEY;
  return Boolean(secret && secret.length >= 32);
}
