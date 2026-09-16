import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * The one way the integrations module talks to a third party.
 *
 * Three rules every vendor call needs, which no call site should have to remember:
 *
 *   - It never throws for an HTTP or network failure. A vendor that is down, slow or
 *     unhappy with a key is an ordinary answer, and callers need to tell those apart
 *     rather than catch them all as one exception.
 *   - It gives up after a bounded time. A check that hangs holds an API request open; ten
 *     seconds is longer than any endpoint used here should take.
 *   - It does not follow redirects. Several URLs here are typed in by a workspace admin,
 *     and a redirect is the classic way past a check on where a request may go.
 */
export interface VendorResponse<T = unknown> {
  ok: boolean;
  /** 0 when no response arrived at all. */
  status: number;
  /** The parsed body when it was JSON, otherwise null. */
  body: T | null;
  /** The raw body, truncated — for vendors that answer in plain text. */
  text: string;
  headers: Headers | null;
  /** Present when the request failed before any response arrived. */
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TEXT_LENGTH = 2_000;

export async function vendorFetch<T = unknown>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<VendorResponse<T>> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;

  try {
    const response = await fetch(url, {
      ...rest,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await response.text().catch(() => "");

    let body: T | null = null;
    if (raw) {
      try {
        body = JSON.parse(raw) as T;
      } catch {
        body = null;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      body,
      text: raw.slice(0, MAX_TEXT_LENGTH),
      headers: response.headers,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      text: "",
      headers: null,
      error: describeNetworkError(error, timeoutMs),
    };
  }
}

function describeNetworkError(error: unknown, timeoutMs: number): string {
  if (!(error instanceof Error)) return "the request failed";
  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return `no response within ${Math.round(timeoutMs / 1000)} seconds`;
  }

  // undici puts the useful part — ENOTFOUND, ECONNREFUSED — in `cause`.
  const cause = (error as Error & { cause?: { code?: string } }).cause;
  switch (cause?.code) {
    case "ENOTFOUND":
      return "the host name does not resolve";
    case "ECONNREFUSED":
      return "the connection was refused";
    case "ECONNRESET":
      return "the connection was reset";
    case undefined:
      return error.message;
    default:
      return cause?.code ?? error.message;
  }
}

/** Reads a nested value out of a JSON body without trusting its shape. */
export function dig(value: unknown, ...path: (string | number)[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

/** A non-empty trimmed string, or undefined. */
export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * The human-readable part of a vendor's error body, whichever shape it came in. Vendors
 * disagree about where the message goes; these are the shapes the catalogue's providers
 * actually use.
 */
export function vendorMessage(response: VendorResponse): string | undefined {
  const body = response.body;
  const candidates: unknown[] = [];

  if (body && typeof body === "object") {
    const error = dig(body, "error");
    candidates.push(
      dig(error, "message"),
      dig(body, "error_description"),
      dig(body, "message"),
      typeof error === "string" ? error : undefined,
      dig(body, "err_msg"),
      dig(body, "detail", "message"),
      typeof dig(body, "detail") === "string" ? dig(body, "detail") : undefined,
      dig(body, "errors", 0, "message"),
    );
  } else if (
    response.text &&
    response.text.length < 300 &&
    !response.text.trimStart().startsWith("<")
  ) {
    candidates.push(response.text);
  }

  const found = candidates.map(text).find((value) => value !== undefined);
  return found ? found.replace(/[.\s]+$/, "").slice(0, 240) : undefined;
}

/** Strips any submitted secret out of a message before it is stored or shown to anyone. */
export function redactSecrets(message: string, secrets: (string | undefined)[]): string {
  let result = message;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) result = result.split(secret).join("••••");
  }
  return result;
}

// ── where a request may go ──────────────────────────────────────────────────────────

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * Private addresses are allowed outside production, so a developer can point a webhook
 * at a receiver on their own machine. In production they are refused unless an operator
 * opts in, because a multi-tenant server that POSTs wherever a tenant says is a tool for
 * reaching the network it sits on — the database, the metadata service, an admin port.
 */
export function privateNetworkAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORK === "true"
  );
}

/**
 * Checks a URL a workspace admin supplied, before anything is sent to it.
 *
 * The DNS answer is checked here and again at every delivery, which narrows but does not
 * close the rebinding window between the lookup and the connection. Closing it fully
 * needs the connection pinned to the checked address; until then, production should keep
 * the API's egress firewalled off from internal ranges as well.
 */
export async function checkOutboundUrl(
  raw: string,
  options: { allowedHosts?: string[] } = {},
): Promise<UrlCheck> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "That is not a valid URL." };
  }

  const allowPrivate = privateNetworkAllowed();
  if (url.protocol !== "https:" && !(allowPrivate && url.protocol === "http:")) {
    return { ok: false, reason: "The URL has to start with https://." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Put credentials in the fields provided, not inside the URL." };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    options.allowedHosts &&
    !options.allowedHosts.some((allowed) => hostMatches(host, allowed))
  ) {
    const names = options.allowedHosts.map((allowed) => allowed.replace(/^\./, "*."));
    return { ok: false, reason: `The URL has to be on ${names.join(" or ")}.` };
  }

  if (allowPrivate) return { ok: true, url };

  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true }).then(
        (rows) => rows.map((row) => row.address),
        () => [] as string[],
      );

  if (addresses.length === 0) {
    return { ok: false, reason: "The host name in that URL does not resolve." };
  }
  if (addresses.some(isPrivateAddress)) {
    return { ok: false, reason: "The URL points at a private or internal network address." };
  }
  return { ok: true, url };
}

/** "hooks.slack.com" matches only itself; ".make.com" matches any subdomain of make.com. */
export function hostMatches(host: string, allowed: string): boolean {
  return allowed.startsWith(".")
    ? host.endsWith(allowed) && host.length > allowed.length
    : host === allowed;
}

/** True for loopback, private, link-local, carrier-grade NAT, multicast and reserved ranges. */
export function isPrivateAddress(address: string): boolean {
  switch (isIP(address)) {
    case 4:
      return isPrivateIPv4(address);
    case 6:
      return isPrivateIPv6(address);
    default:
      // Not an address at all: refuse rather than guess.
      return true;
  }
}

function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIPv6(address: string): boolean {
  const groups = expandIPv6(address);
  if (!groups) return true;

  const embedded = (high: number, low: number) =>
    `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;

  // ::ffff:a.b.c.d is an IPv4 address in IPv6 clothing, judged as the IPv4 it is.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return isPrivateIPv4(embedded(groups[6], groups[7]));
  }
  // ::, ::1 and the deprecated IPv4-compatible form: none belongs on a public endpoint.
  if (groups.slice(0, 6).every((group) => group === 0)) return true;
  // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) both carry an IPv4 address inside.
  if (
    groups[0] === 0x64 &&
    groups[1] === 0xff9b &&
    groups.slice(2, 6).every((group) => group === 0)
  ) {
    return isPrivateIPv4(embedded(groups[6], groups[7]));
  }
  if (groups[0] === 0x2002) return isPrivateIPv4(embedded(groups[1], groups[2]));

  return (
    (groups[0] & 0xfe00) === 0xfc00 || // unique local
    (groups[0] & 0xffc0) === 0xfe80 || // link local
    (groups[0] & 0xff00) === 0xff00 || // multicast
    (groups[0] === 0x2001 && groups[1] === 0x0db8) // documentation
  );
}

/** "fe80::1" → eight 16-bit groups, or null when it is not a valid IPv6 address. */
function expandIPv6(address: string): number[] | null {
  let value = address.toLowerCase();
  const zone = value.indexOf("%");
  if (zone >= 0) value = value.slice(0, zone);

  // A trailing dotted quad is the last two groups written in decimal.
  const dotted = value.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    const high = ((a << 8) | b).toString(16);
    const low = ((c << 8) | d).toString(16);
    value = `${value.slice(0, -dotted[0].length)}${high}:${low}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;

  const groups = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill("0"),
    ...tail,
  ];
  const numbers = groups.map((group) =>
    /^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : Number.NaN,
  );
  return numbers.length === 8 && numbers.every((group) => !Number.isNaN(group)) ? numbers : null;
}
