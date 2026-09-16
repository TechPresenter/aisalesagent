import {
  checkOutboundUrl,
  hostMatches,
  isPrivateAddress,
  redactSecrets,
  vendorMessage,
  type VendorResponse,
} from "./http";

/**
 * The outbound-URL checks are what stop a workspace admin pointing the API's own HTTP
 * client at the network it runs on. Each case below is a known way past a naive check —
 * the IPv6 spellings of loopback, IPv4 addresses wrapped in IPv6, carrier-grade NAT —
 * so a refactor that "simplifies" the parser fails here rather than in a pen test.
 *
 * No test resolves a host name: unit tests run without a network, so every production-
 * mode case uses an IP literal, which is checked without a lookup.
 */
describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.8",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.20",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "0:0:0:0:0:0:0:1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.1.2.3",
    "::127.0.0.1",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::1",
    "2001:db8::1",
    "not-an-ip",
  ])("refuses %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows public %s",
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});

describe("hostMatches", () => {
  it("matches an exact host only when no leading dot is given", () => {
    expect(hostMatches("hooks.slack.com", "hooks.slack.com")).toBe(true);
    expect(hostMatches("evil-hooks.slack.com", "hooks.slack.com")).toBe(false);
    expect(hostMatches("hooks.slack.com.evil.com", "hooks.slack.com")).toBe(false);
  });

  it("matches subdomains, but not the bare suffix or a lookalike, with a leading dot", () => {
    expect(hostMatches("hook.eu1.make.com", ".make.com")).toBe(true);
    expect(hostMatches("make.com", ".make.com")).toBe(false);
    expect(hostMatches("evilmake.com", ".make.com")).toBe(false);
  });
});

describe("checkOutboundUrl", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects what is not a URL, credentials inside one, and the wrong host", async () => {
    await expect(checkOutboundUrl("not a url")).resolves.toMatchObject({ ok: false });
    await expect(checkOutboundUrl("https://user:pass@hooks.slack.com/x")).resolves.toMatchObject({
      ok: false,
    });
    await expect(
      checkOutboundUrl("https://hooks.slack.com.evil.com/services/x", {
        allowedHosts: ["hooks.slack.com"],
      }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("refuses private addresses and plain http in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORK;

    await expect(checkOutboundUrl("https://127.0.0.1/hook")).resolves.toMatchObject({ ok: false });
    await expect(checkOutboundUrl("https://[::ffff:7f00:1]/hook")).resolves.toMatchObject({
      ok: false,
    });
    await expect(checkOutboundUrl("https://169.254.169.254/latest")).resolves.toMatchObject({
      ok: false,
    });
    await expect(checkOutboundUrl("http://8.8.8.8/hook")).resolves.toMatchObject({ ok: false });
    await expect(checkOutboundUrl("https://8.8.8.8/hook")).resolves.toMatchObject({ ok: true });
  });

  it("allows a local receiver outside production, or when an operator opts in", async () => {
    process.env.NODE_ENV = "development";
    await expect(checkOutboundUrl("http://localhost:4555/hook")).resolves.toMatchObject({ ok: true });

    process.env.NODE_ENV = "production";
    process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORK = "true";
    await expect(checkOutboundUrl("http://10.0.0.5/hook")).resolves.toMatchObject({ ok: true });
  });
});

describe("vendorMessage", () => {
  const response = (body: unknown, text = ""): VendorResponse => ({
    ok: false,
    status: 401,
    body,
    text,
    headers: null,
  });

  it("reads the message from each shape the catalogue's vendors use", () => {
    expect(vendorMessage(response({ error: { message: "Invalid API key." } }))).toBe("Invalid API key");
    expect(vendorMessage(response({ message: "Authentication credentials not found" }))).toBe(
      "Authentication credentials not found",
    );
    expect(vendorMessage(response({ error: "invalid_grant", error_description: "Bad code" }))).toBe(
      "Bad code",
    );
    expect(vendorMessage(response({ errors: [{ message: "access forbidden" }] }))).toBe(
      "access forbidden",
    );
    expect(vendorMessage(response({ detail: { status: "invalid_api_key", message: "Nope" } }))).toBe(
      "Nope",
    );
    expect(vendorMessage(response(null, "invalid_token"))).toBe("invalid_token");
  });

  it("ignores an HTML error page rather than quoting it", () => {
    expect(vendorMessage(response(null, "<html><body>502</body></html>"))).toBeUndefined();
  });
});

describe("redactSecrets", () => {
  it("removes every occurrence of a submitted secret", () => {
    const secret = "sk-live-abcdef123456";
    expect(redactSecrets(`Key ${secret} is invalid (${secret})`, [secret])).toBe(
      "Key •••• is invalid (••••)",
    );
  });

  it("leaves short values alone, so a two-letter field cannot blank a whole message", () => {
    expect(redactSecrets("Region in is not valid", ["in"])).toBe("Region in is not valid");
  });
});
