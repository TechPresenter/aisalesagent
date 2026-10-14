import { supportContactLinks, supportMailto, supportTel } from "./support-contact";

describe("supportMailto", () => {
  it("addresses the configured inbox with an encoded subject", () => {
    expect(supportMailto(" sales@appsgain.in ", "Plans: Enterprise")).toBe(
      "mailto:sales@appsgain.in?subject=Plans%3A%20Enterprise",
    );
    expect(supportMailto("sales@appsgain.in")).toBe("mailto:sales@appsgain.in");
  });

  it("offers nothing for a missing or malformed address", () => {
    expect(supportMailto(null)).toBeNull();
    expect(supportMailto(undefined)).toBeNull();
    expect(supportMailto("   ")).toBeNull();
    expect(supportMailto("sales at appsgain")).toBeNull();
  });
});

describe("supportTel", () => {
  it("dials the digits of a number written for people, keeping a leading +", () => {
    expect(supportTel("+91 98765 43210")).toBe("tel:+919876543210");
    expect(supportTel("(022) 4000-1234")).toBe("tel:02240001234");
  });

  it("offers nothing for a missing, too short or too long number", () => {
    expect(supportTel(null)).toBeNull();
    expect(supportTel("")).toBeNull();
    expect(supportTel("12345")).toBeNull();
    expect(supportTel("+1234567890123456")).toBeNull();
  });
});

describe("supportContactLinks", () => {
  it("lists email before phone and shows each as configured", () => {
    expect(
      supportContactLinks({ email: "sales@appsgain.in", phone: "+91 98765 43210" }, "Hi"),
    ).toEqual([
      { kind: "email", href: "mailto:sales@appsgain.in?subject=Hi", display: "sales@appsgain.in" },
      { kind: "phone", href: "tel:+919876543210", display: "+91 98765 43210" },
    ]);
  });

  it("is empty when nothing usable is configured, so callers can hide the action", () => {
    expect(supportContactLinks({ email: null, phone: null })).toEqual([]);
    expect(supportContactLinks({ email: "nope", phone: "123" })).toEqual([]);
  });

  it("works with only one channel set", () => {
    expect(supportContactLinks({ email: null, phone: "+91 98765 43210" })).toEqual([
      { kind: "phone", href: "tel:+919876543210", display: "+91 98765 43210" },
    ]);
  });
});
