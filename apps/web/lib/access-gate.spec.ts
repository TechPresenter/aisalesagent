import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import { basicAuthMatches, gateCredentials } from "./access-gate";

/**
 * The gate is the only thing between a pre-release build and the open internet, and it
 * must stay out of the way on LIVE. Both halves are tested: the credential check itself,
 * and the middleware's decision for each environment's settings.
 */

const CREDENTIALS = { username: "qa-team", password: "correct horse battery" };

function basic(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  return `Basic ${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))}`;
}

describe("gateCredentials", () => {
  it("is off unless both settings are present", () => {
    expect(gateCredentials(undefined, undefined)).toBeNull();
    expect(gateCredentials("qa-team", undefined)).toBeNull();
    expect(gateCredentials("", "secret")).toBeNull();
    expect(gateCredentials("qa-team", "secret")).toEqual({ username: "qa-team", password: "secret" });
  });
});

describe("basicAuthMatches", () => {
  it("accepts the right username and password", () => {
    expect(basicAuthMatches(basic("qa-team", "correct horse battery"), CREDENTIALS)).toBe(true);
  });

  it("accepts a password containing colons and non-ASCII characters", () => {
    const expected = { username: "uat", password: "pässwörd:with:colons" };
    expect(basicAuthMatches(basic("uat", "pässwörd:with:colons"), expected)).toBe(true);
  });

  it.each([
    ["no header", null],
    ["a bearer token", "Bearer abc.def.ghi"],
    ["malformed base64", "Basic %%%"],
    ["no colon", `Basic ${btoa("qa-team")}`],
    ["the wrong password", basic("qa-team", "wrong")],
    ["the wrong username", basic("someone", "correct horse battery")],
    ["a password prefix", basic("qa-team", "correct horse")],
  ])("rejects %s", (_label, header) => {
    expect(basicAuthMatches(header, CREDENTIALS)).toBe(false);
  });
});

describe("middleware", () => {
  const request = (authorization?: string) =>
    new NextRequest("https://qa.appsgain.app/leads", {
      headers: authorization ? { authorization } : {},
    });

  afterEach(() => {
    delete process.env.ACCESS_GATE_USERNAME;
    delete process.env.ACCESS_GATE_PASSWORD;
  });

  it("lets every request through when the gate is not configured (LIVE, local)", () => {
    const response = middleware(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-robots-tag")).toBeNull();
  });

  describe("with the gate configured (DEV, QA, UAT)", () => {
    beforeEach(() => {
      process.env.ACCESS_GATE_USERNAME = CREDENTIALS.username;
      process.env.ACCESS_GATE_PASSWORD = CREDENTIALS.password;
    });

    it("asks the browser for the access password", () => {
      const response = middleware(request());
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toMatch(/^Basic realm=/);
    });

    it("refuses wrong credentials", () => {
      expect(middleware(request(basic("qa-team", "guess"))).status).toBe(401);
    });

    it("lets the right credentials through and keeps the page out of search engines", () => {
      const response = middleware(request(basic(CREDENTIALS.username, CREDENTIALS.password)));
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    });
  });
});
