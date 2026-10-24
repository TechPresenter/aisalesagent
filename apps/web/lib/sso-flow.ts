import type {
  SsoKnownAddress,
  SsoSignInResult,
  SsoSignupOffer,
  SsoWorkspaceChoice,
  TwoFactorChallenge,
} from "@appsgain/shared";
import { ApiError } from "./api-client";

/**
 * "Continue with Google / Microsoft", the browser half.
 *
 * Clerk is the identity broker and nothing more: it runs the redirect to Google or
 * Microsoft and hands back a short-lived token saying which verified email address came
 * back. The API turns that into an Appsgain session (or a 2FA challenge, a workspace to
 * pick, or a sign-up), and the Clerk session is ended straight away. Appsgain's own
 * tokens in sessionStorage stay the only session there is.
 *
 * The flow crosses two other sites, so the little it needs to remember across them lives
 * here in sessionStorage: which button was pressed, on which page and for which workspace,
 * a message to show on the way back, and the sign-up token when the address has no
 * account yet. The same storage as the session tokens for the same reasons: it ends with
 * the tab, and it never lands in a server log or a browser history the way a query string
 * does. The sign-up token in particular stands in for a password for fifteen minutes and
 * must never be in a URL.
 */

/**
 * Built into the pages at build time. Unset, the buttons stay disabled and Clerk is never
 * loaded, so deploying this before the keys exist changes nothing.
 */
export const CLERK_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() || undefined;
export const SSO_ENABLED = Boolean(CLERK_PUBLISHABLE_KEY);

export type SsoProvider = "google" | "microsoft";

export const SSO_PROVIDERS: Record<
  SsoProvider,
  { label: string; strategy: "oauth_google" | "oauth_microsoft" }
> = {
  google: { label: "Google", strategy: "oauth_google" },
  microsoft: { label: "Microsoft", strategy: "oauth_microsoft" },
};

/** Where Clerk sends the browser back to. Both sit under /sign-in, inside its Clerk provider. */
export const SSO_CALLBACK_PATH = "/sign-in/sso-callback";
export const SSO_COMPLETE_PATH = "/sign-in/sso-complete";

/** The two pages a sign-in through Google or Microsoft can start from, and fail back to. */
export type SsoOrigin = "/sign-in" | "/sign-up";

const START_KEY = "appsgain.sso.start";
/**
 * How long a press of the button counts as a flow under way. A round trip through Google or
 * Microsoft takes seconds, or a few minutes with a password reset on the way; one older than
 * this was abandoned, and must not leave a return page willing to go on.
 */
const START_TTL_MS = 30 * 60_000;
const ERROR_KEY = "appsgain.sso.error";
const SIGNUP_KEY = "appsgain.sso.signup";

/** Same rule as the API's SUBDOMAIN_PATTERN. */
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;

/**
 * The parameter through which a Clerk development instance hands a browser its client —
 * the thing every Clerk session in that browser belongs to. See dropForeignClerkClient.
 */
const DEV_BROWSER_PARAM = "__clerk_db_jwt";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    // Private browsing and locked-down profiles throw on access rather than returning null.
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    /* full or blocked; the flow still works, it just forgets the nicety */
  }
}

function read(key: string): unknown {
  try {
    const raw = storage()?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function remove(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    /* already gone, or never there */
  }
}

function isProvider(value: unknown): value is SsoProvider {
  return value === "google" || value === "microsoft";
}

/** Unguessable, from the browser's CSPRNG — `randomUUID` only exists on https and localhost. */
function randomNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The workspace field as the API would take it, or null for blank or not a workspace name. */
export function workspaceName(value: string | null | undefined): string | null {
  const name = value?.trim().toLowerCase() ?? "";
  // A browser may autofill the field with a company name ("Acme Corp"); sending that would
  // fail the whole sign-in on validation, where leaving it out only means a list to pick from.
  return SUBDOMAIN.test(name) ? name : null;
}

/** A flow this tab started and has not finished: the return pages go on only with one. */
export interface SsoStart {
  provider: SsoProvider | null;
  origin: SsoOrigin;
  /** The workspace typed on the sign-in form, to go to straight away when it is the address's. */
  workspace: string | null;
}

interface StoredStart extends SsoStart {
  /** Present from the button press until the Clerk token has been traded. */
  nonce?: string;
  /** Epoch milliseconds of the press, for START_TTL_MS. */
  startedAt?: number;
}

function readStored(): StoredStart | null {
  const value = read(START_KEY) as Partial<StoredStart> | null;
  if (!value || typeof value !== "object") return null;
  return {
    provider: isProvider(value.provider) ? value.provider : null,
    origin: value.origin === "/sign-up" ? "/sign-up" : "/sign-in",
    workspace: workspaceName(value.workspace),
    nonce: typeof value.nonce === "string" && value.nonce ? value.nonce : undefined,
    startedAt: typeof value.startedAt === "number" ? value.startedAt : undefined,
  };
}

/**
 * Noted as the button is pressed. Besides naming the provider for the pages after the
 * redirect, it marks the flow as this tab's own — the OAuth `state` idea, kept where only
 * this tab can see it. A return page reached without it was not reached by pressing a
 * button here: a link someone sent, or a Clerk session left behind by another visit.
 */
export function rememberSsoStart(
  start: { provider: SsoProvider; origin: SsoOrigin; workspace?: string | null },
  now = Date.now(),
): void {
  write(START_KEY, {
    provider: start.provider,
    origin: start.origin,
    workspace: workspaceName(start.workspace),
    nonce: randomNonce(),
    startedAt: now,
  } satisfies StoredStart);
}

/**
 * The flow this tab started and has not yet traded a token for, or null when there is
 * none — including one started so long ago that it was plainly abandoned.
 */
export function readSsoStart(now = Date.now()): SsoStart | null {
  const stored = readStored();
  if (!stored?.nonce || !stored.startedAt || now - stored.startedAt > START_TTL_MS) return null;
  const { nonce: _nonce, startedAt: _startedAt, ...start } = stored;
  return start;
}

/**
 * The flow can no longer be resumed: its Clerk token has been traded, or the person is
 * back on the page that starts one, or pressing the button failed. A reload or a Back to a
 * return page then finds nothing to go on with. Where it began is kept, for the steps
 * still to come (a code, a workspace to pick) to start over from.
 */
export function spendSsoStart(): void {
  const stored = readStored();
  if (!stored) return;
  const { nonce: _nonce, startedAt: _startedAt, ...spent } = stored;
  write(START_KEY, spent);
}

/** The page the latest flow began on — sign-in when nothing was noted. */
export function ssoOrigin(): SsoOrigin {
  return readStored()?.origin ?? "/sign-in";
}

/** "Google", "Microsoft", or both when the page cannot tell which button was pressed. */
export function providerLabel(provider: SsoProvider | null): string {
  return provider ? SSO_PROVIDERS[provider].label : "Google or Microsoft";
}

/**
 * Ends the flow with a message for the page it started from, and returns that page. The
 * message travels in storage rather than the address bar so nobody can craft a link
 * that puts their own words in a red box on the sign-in page.
 */
export function failSso(message: string): SsoOrigin {
  const origin = ssoOrigin();
  write(ERROR_KEY, message);
  remove(START_KEY);
  return origin;
}

/** The message `failSso` left, read once: a reload does not show it again. */
export function takeSsoError(): string | null {
  const message = read(ERROR_KEY);
  remove(ERROR_KEY);
  return typeof message === "string" && message ? message : null;
}

/**
 * On a Clerk development instance — which LIVE uses until there is a domain — the browser's
 * Clerk client travels as `__clerk_db_jwt`, and Clerk's script adopts one from the address
 * bar in preference to its own. Whoever crafts the link then shares a Clerk client with the
 * person who opens it: they could sign that person in as themselves, or watch their next
 * Google sign-in arrive and trade its token first. So it is taken out of the address before
 * Clerk loads, on every page that loads Clerk, and the browser keeps the client it made
 * itself.
 *
 * The one exception is a return page while this tab has a flow under way: that is Clerk
 * itself coming back from Google or Microsoft, with the client this tab started out with.
 *
 * Returns whether anything was removed. A production instance never uses the parameter,
 * so there this does nothing.
 */
export function dropForeignClerkClient(): boolean {
  if (typeof window === "undefined") return false;
  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return false;
  }
  if (!url.searchParams.has(DEV_BROWSER_PARAM)) return false;

  const returning = url.pathname === SSO_CALLBACK_PATH || url.pathname === SSO_COMPLETE_PATH;
  if (returning && readSsoStart()) return false;

  url.searchParams.delete(DEV_BROWSER_PARAM);
  try {
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    return false;
  }
  return true;
}

/** A sign-up waiting for its company details, after an address with no account came back. */
export interface PendingSsoSignup {
  signupToken: string;
  email: string;
  name: string | null;
  provider: SsoProvider | null;
  /** True when the person was signing in, not up: they expected an account to exist. */
  fromSignIn: boolean;
  /** Where else the address is known, for the form to say before a second workspace is made. */
  known: SsoKnownAddress | null;
  /** Epoch milliseconds, from the token's `expiresIn`. */
  expiresAt: number;
}

function isKnownAddress(value: unknown): value is SsoKnownAddress {
  const known = value as Partial<SsoKnownAddress> | null;
  return (
    !!known &&
    (known.reason === "disabled" || known.reason === "invited") &&
    typeof known.workspace === "string"
  );
}

export function saveSsoSignup(offer: SsoSignupOffer, now = Date.now()): void {
  const start = readStored();
  write(SIGNUP_KEY, {
    signupToken: offer.signupToken,
    email: offer.email,
    name: offer.name,
    provider: start?.provider ?? null,
    fromSignIn: start?.origin === "/sign-in",
    known: isKnownAddress(offer.known) ? offer.known : null,
    expiresAt: now + offer.expiresIn * 1000,
  } satisfies PendingSsoSignup);
}

/**
 * The pending sign-up, if there is one. One whose token has run out is cleared rather
 * than shown, and reported as `expired` so the form can say why it is back to asking for
 * a password: a form that can only fail on submit is worse than asking the person to
 * press the button again.
 */
export function readSsoSignup(now = Date.now()): {
  signup: PendingSsoSignup | null;
  expired: boolean;
} {
  const value = read(SIGNUP_KEY) as Partial<PendingSsoSignup> | null;
  if (
    !value ||
    typeof value.signupToken !== "string" ||
    typeof value.email !== "string" ||
    typeof value.expiresAt !== "number"
  ) {
    if (value) remove(SIGNUP_KEY);
    return { signup: null, expired: false };
  }
  if (value.expiresAt <= now) {
    remove(SIGNUP_KEY);
    return { signup: null, expired: true };
  }
  return {
    signup: {
      signupToken: value.signupToken,
      email: value.email,
      name: typeof value.name === "string" ? value.name : null,
      provider: isProvider(value.provider) ? value.provider : null,
      fromSignIn: value.fromSignIn === true,
      known: isKnownAddress(value.known) ? value.known : null,
      expiresAt: value.expiresAt,
    },
    expired: false,
  };
}

/**
 * The flow is over: signed in, signed up, or abandoned for a password. A sign-up token
 * left behind would otherwise put the next visit to /sign-up back in SSO mode.
 */
export function endSsoFlow(): void {
  remove(SIGNUP_KEY);
  remove(START_KEY);
}

/**
 * The four answers `POST /auth/sso/clerk` can give, told apart once here so the page
 * that acts on them reads as a plain switch. `passwordCleared` is carried on both
 * signed-in shapes because the 2FA step's own answer does not repeat it.
 */
export type SsoOutcome =
  | { kind: "signed-in"; passwordCleared: boolean }
  | { kind: "two-factor"; challenge: TwoFactorChallenge; passwordCleared: boolean }
  | { kind: "choose-workspace"; choice: SsoWorkspaceChoice }
  | { kind: "signup-required"; signup: SsoSignupOffer };

export function ssoOutcome(result: SsoSignInResult): SsoOutcome {
  if ("status" in result) {
    if (result.status === "choose-workspace") return { kind: "choose-workspace", choice: result };
    const { status: _status, ...signup } = result;
    return { kind: "signup-required", signup };
  }
  const passwordCleared = result.passwordCleared === true;
  if ("twoFactorRequired" in result) {
    return {
      kind: "two-factor",
      challenge: {
        twoFactorRequired: true,
        challengeToken: result.challengeToken,
        expiresIn: result.expiresIn,
      },
      passwordCleared,
    };
  }
  return { kind: "signed-in", passwordCleared };
}

/**
 * What to tell the person when a step fails. The API writes its 401, 409, 429 and 503
 * answers for people ("Too many attempts…", "not set up on this server…"), so those are
 * shown as they come. A 400 here means the browser sent something malformed, which the
 * person cannot fix, and anything else is the server or the network.
 */
export function ssoErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if ([401, 403, 409, 429, 503].includes(cause.status) && cause.message) return cause.message;
    if (cause.status === 400) {
      return "That sign-in could not be completed. Continue with Google or Microsoft again.";
    }
    return "Something went wrong on our side. Try again in a minute, or sign in with your email and password.";
  }
  return "Could not reach the server. Check your connection and try again.";
}
