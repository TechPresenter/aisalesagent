import {
  base32Decode,
  base32Encode,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  hotp,
  looksLikeBackupCode,
  normaliseBackupCode,
  otpauthUri,
  totpStep,
  verifyTotp,
} from "./totp";

/**
 * Two-factor codes have to agree with every authenticator app in the world, so they are
 * tested against the standards' own published vectors rather than against themselves.
 */
describe("base32 (RFC 4648 §10)", () => {
  it.each([
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ])("encodes %j as %s and back", (plain, encoded) => {
    expect(base32Encode(Buffer.from(plain))).toBe(encoded);
    expect(base32Decode(encoded).toString()).toBe(plain);
  });

  it("decodes what people type: lower case, spaces, padding", () => {
    expect(base32Decode("mzxw 6ytb oi==").toString()).toBe("foobar");
    expect(() => base32Decode("MZXW1")).toThrow();
  });
});

describe("HOTP (RFC 4226 Appendix D)", () => {
  const secret = Buffer.from("12345678901234567890");
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];

  it.each(expected.map((code, counter) => [counter, code]))("counter %i gives %s", (counter, code) => {
    expect(hotp(secret, counter as number)).toBe(code);
  });
});

describe("TOTP (RFC 6238 Appendix B, SHA-1)", () => {
  const secret = Buffer.from("12345678901234567890");

  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])("at %i seconds the 8-digit code is %s", (seconds, code) => {
    expect(hotp(secret, totpStep(seconds * 1000), 8)).toBe(code);
  });

  it("accepts the current code and one step either side, and nothing further", () => {
    const base32 = base32Encode(secret);
    const now = 1111111111 * 1000;
    const step = totpStep(now);
    expect(verifyTotp(base32, hotp(secret, step), { now })).toBe(step);
    expect(verifyTotp(base32, hotp(secret, step - 1), { now })).toBe(step - 1);
    expect(verifyTotp(base32, hotp(secret, step + 1), { now })).toBe(step + 1);
    expect(verifyTotp(base32, hotp(secret, step - 2), { now })).toBeNull();
    expect(verifyTotp(base32, "12345", { now })).toBeNull();
    expect(verifyTotp(base32, "abcdef", { now })).toBeNull();
  });

  it("refuses a replay: a code at or before the last accepted step", () => {
    const base32 = base32Encode(secret);
    const now = 2000000000 * 1000;
    const step = totpStep(now);
    const code = hotp(secret, step);
    expect(verifyTotp(base32, code, { now, afterStep: step - 1 })).toBe(step);
    expect(verifyTotp(base32, code, { now, afterStep: step })).toBeNull();
  });

  it("makes 160-bit secrets and a URI authenticator apps read", () => {
    const generated = generateTotpSecret();
    expect(generated).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(generated)).toHaveLength(20);

    const uri = otpauthUri({ issuer: "Appsgain", account: "priya@example.com (northwind)", secret: generated });
    expect(uri.startsWith("otpauth://totp/Appsgain%3Apriya%40example.com%20(northwind)?")).toBe(true);
    expect(new URL(uri).searchParams.get("secret")).toBe(generated);
    expect(new URL(uri).searchParams.get("period")).toBe("30");
  });
});

describe("backup codes", () => {
  it("issues ten distinct codes without look-alike characters", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[2-9a-hjkmnp-z]{4}-[2-9a-hjkmnp-z]{4}$/);
    }
  });

  it("matches however the code is typed back", () => {
    const key = Buffer.alloc(32, 7);
    expect(normaliseBackupCode(" K7M2-9XQA ")).toBe("k7m29xqa");
    expect(hashBackupCode(key, "K7M2 9XQA")).toBe(hashBackupCode(key, "k7m2-9xqa"));
    expect(looksLikeBackupCode("k7m2-9xqa")).toBe(true);
    expect(looksLikeBackupCode("123456")).toBe(false);
  });

  it("depends on the server key, so a leaked table alone cannot be checked offline", () => {
    expect(hashBackupCode(Buffer.alloc(32, 1), "k7m2-9xqa")).not.toBe(
      hashBackupCode(Buffer.alloc(32, 2), "k7m2-9xqa"),
    );
  });
});
