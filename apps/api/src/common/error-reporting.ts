import type * as SentrySdk from "@sentry/nestjs";
import { keepAlive } from "../runtime/vercel";

/**
 * Where errors go besides the log: Sentry, when SENTRY_DSN is set, and nowhere otherwise.
 *
 * The log alone is not enough on Vercel Hobby, which keeps an hour of it — a 500 at night
 * has scrolled away before anyone looks. Sentry keeps the error, groups repeats of it and
 * can alert on the first one.
 *
 * Without SENTRY_DSN the SDK is never even loaded, and every function here returns at
 * once, so development and the test suites run exactly as they would without this file.
 */

/** The SDK, once initErrorReporting has loaded and started it; null until then. */
let sentry: typeof SentrySdk | null = null;

/** What is known about the request or job an error came from. Identifiers only. */
export interface ErrorContext {
  method?: string;
  /** The route pattern (`/api/leads/:id`) where there is one; a path never with its query. */
  route?: string;
  tenantId?: string;
  userId?: string;
  apiKeyId?: string;
  /** Vercel's x-vercel-id, which finds the same request in the Vercel log. */
  requestId?: string;
  /** Further short, searchable labels, such as the mail driver. */
  tags?: Record<string, string>;
  /** Anything else worth reading on the event. Never a body, a token or an address. */
  extra?: Record<string, unknown>;
}

/**
 * Starts the Sentry client when SENTRY_DSN is set. Called first thing in main.ts, so an
 * API that fails to boot — a database that never answers — is reported too.
 *
 * Deliberately narrow. The SDK's default integrations record far more than errors:
 * incoming request bodies, headers and query strings, outgoing request URLs (a Slack
 * webhook URL is itself the secret), console output (where MAIL_DRIVER=log writes reset
 * links) and local variable values. Any of those would put a password, an API key or a
 * lead's phone number into a third party's storage. So only the integrations that
 * describe the error itself are switched on, the request context is attached by hand
 * from identifiers (see AllExceptionsFilter), and no breadcrumbs are kept.
 *
 * Tracing stays off, and with it the OpenTelemetry setup that would otherwise run on
 * every cold start for spans nobody is sampling.
 */
export function initErrorReporting(env: NodeJS.ProcessEnv = process.env): boolean {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return false;
  if (sentry) return true;

  // Required here rather than imported at the top: loading the SDK takes about as long as
  // loading Nest, and a Vercel cold start without a DSN would pay that for nothing.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sentry = require("@sentry/nestjs") as typeof SentrySdk;
  Sentry.init({
    dsn,
    // DEV, QA and UAT are all "preview" to Vercel, so SENTRY_ENVIRONMENT is what tells them
    // apart. Without it, Vercel's own name for the environment is the next best thing.
    environment: env.SENTRY_ENVIRONMENT?.trim() || env.VERCEL_ENV || env.NODE_ENV || "development",
    release: env.SENTRY_RELEASE?.trim() || env.VERCEL_GIT_COMMIT_SHA || undefined,
    sendDefaultPii: false,
    defaultIntegrations: false,
    integrations: [
      Sentry.eventFiltersIntegration(),
      Sentry.functionToStringIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
      Sentry.nodeContextIntegration(),
      Sentry.contextLinesIntegration(),
      Sentry.onUncaughtExceptionIntegration(),
      // "strict" reports the rejection and then exits, as Node does by default. The
      // default "warn" would quietly keep a process running that Node would have stopped.
      Sentry.onUnhandledRejectionIntegration({ mode: "strict" }),
    ],
    maxBreadcrumbs: 0,
    // Every exception's message is cut to its first line before it leaves the process,
    // as the log line is (see firstLine). The length cap is a second limit on anything
    // else the SDK copies as a string.
    beforeSend: keepFirstLines,
    maxValueLength: 250,
    skipOpenTelemetrySetup: true,
  });
  sentry = Sentry;
  return true;
}

/**
 * Cuts each exception's message on an event to its first line, the same trim the log
 * gets, so Sentry never stores more of a message than the log does. Applies to every
 * event: those this module reports, and the uncaught errors the SDK catches itself.
 */
export function keepFirstLines<T extends { exception?: { values?: { value?: string }[] } }>(event: T): T {
  for (const exception of event.exception?.values ?? []) {
    if (typeof exception.value === "string") exception.value = firstLine(exception.value);
  }
  return event;
}

/**
 * The first non-empty line of an error's message, at most 200 characters — the only part
 * of a message that is ever logged or reported.
 *
 * Prisma's errors say which query failed on their first line, then print a code frame
 * and the arguments of the query, which for a lead are its name and phone number. A
 * character limit alone does not keep those out: with a short path and code frame, the
 * arguments start within the first 250 characters.
 */
export function firstLine(message: string): string {
  const line = message.split(/\r?\n/).find((part) => part.trim()) ?? "";
  return line.trim().slice(0, 200);
}

/** Sends an exception to Sentry with the request's identifiers. A no-op without SENTRY_DSN. */
export function reportException(error: unknown, context: ErrorContext = {}): void {
  if (!sentry) return;
  sentry.captureException(error, toCaptureContext(context, "error"));
  flushSoon(sentry);
}

/**
 * Sends a failure that is not an exception — an email the provider refused — to Sentry.
 * A no-op without SENTRY_DSN.
 */
export function reportMessage(
  message: string,
  level: "warning" | "error",
  context: ErrorContext = {},
): void {
  if (!sentry) return;
  sentry.captureMessage(message, toCaptureContext(context, level));
  flushSoon(sentry);
}

function toCaptureContext(context: ErrorContext, level: "warning" | "error") {
  const tags: Record<string, string> = { ...context.tags };
  if (context.method) tags.method = context.method;
  if (context.route) tags.route = context.route;
  if (context.tenantId) tags.tenantId = context.tenantId;
  if (context.apiKeyId) tags.apiKeyId = context.apiKeyId;
  if (context.requestId) tags.requestId = context.requestId;

  return {
    level,
    tags,
    // The user's id and nothing else: enough to find them in the database, nothing that
    // identifies them to whoever reads the Sentry project.
    user: context.userId ? { id: context.userId } : undefined,
    extra: context.extra,
  };
}

/**
 * Events are sent in the background. On Vercel the function may be suspended once its
 * response is out, taking an unsent event with it, so the flush is registered with
 * keepAlive, which holds the invocation open until it settles (two seconds at most).
 */
function flushSoon(sdk: typeof SentrySdk): void {
  void keepAlive(sdk.flush(2_000).catch(() => false));
}
