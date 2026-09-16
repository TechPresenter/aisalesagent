import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * How a receiver knows a webhook really came from Appsgain.
 *
 * The signature is an HMAC-SHA256 of `<timestamp>.<raw body>` with the endpoint's secret,
 * sent as `X-Appsgain-Signature: sha256=<hex>` beside `X-Appsgain-Timestamp`. The
 * timestamp is inside what is signed so a captured request cannot be replayed later with
 * a fresh one attached: a receiver that rejects timestamps older than five minutes has
 * closed that door.
 */

export const SIGNATURE_HEADER = "X-Appsgain-Signature";
export const TIMESTAMP_HEADER = "X-Appsgain-Timestamp";
export const EVENT_HEADER = "X-Appsgain-Event";
export const DELIVERY_HEADER = "X-Appsgain-Delivery";

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

export function signWebhookPayload(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex")}`;
}

/**
 * What a receiver should run — written here so the sender and the documented check can
 * never disagree, and so the tests exercise the same function a customer would copy.
 */
export function verifyWebhookSignature(
  secret: string,
  timestamp: number,
  body: string,
  signature: string,
  options: { toleranceSeconds?: number; now?: number } = {},
): boolean {
  const toleranceSeconds = options.toleranceSeconds ?? 300;
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return false;
  }

  const expected = Buffer.from(signWebhookPayload(secret, timestamp, body));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
