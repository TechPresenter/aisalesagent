import { createHmac } from "node:crypto";
import { generateWebhookSecret, signWebhookPayload, verifyWebhookSignature } from "./signing";

/**
 * The signature is a contract with every receiver someone has written, so the tests pin
 * its exact construction — not just that sign and verify agree with each other, which two
 * matching bugs would also satisfy.
 */
describe("webhook signing", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ id: "evt_1", event: "lead.created", data: { lead: { id: "l1" } } });
  const now = Date.UTC(2026, 8, 16, 12, 0, 0);
  const timestamp = Math.floor(now / 1000);

  it("is an HMAC-SHA256 of `<timestamp>.<body>`, hex, prefixed with sha256=", () => {
    const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    expect(signWebhookPayload(secret, timestamp, body)).toBe(`sha256=${expected}`);
  });

  it("verifies its own signature inside the tolerance window", () => {
    const signature = signWebhookPayload(secret, timestamp, body);
    expect(verifyWebhookSignature(secret, timestamp, body, signature, { now })).toBe(true);
  });

  it("rejects a changed body, a different secret or a forged signature", () => {
    const signature = signWebhookPayload(secret, timestamp, body);
    expect(verifyWebhookSignature(secret, timestamp, `${body} `, signature, { now })).toBe(false);
    expect(verifyWebhookSignature("whsec_other", timestamp, body, signature, { now })).toBe(false);
    expect(verifyWebhookSignature(secret, timestamp, body, "sha256=deadbeef", { now })).toBe(false);
  });

  it("rejects a replay once the timestamp is older than the tolerance", () => {
    const signature = signWebhookPayload(secret, timestamp, body);
    const sixMinutesLater = now + 6 * 60_000;
    expect(verifyWebhookSignature(secret, timestamp, body, signature, { now: sixMinutesLater })).toBe(
      false,
    );
  });

  it("makes secrets that are long, prefixed and never repeat", () => {
    const first = generateWebhookSecret();
    const second = generateWebhookSecret();
    expect(first).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });
});
