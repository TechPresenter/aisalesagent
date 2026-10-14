import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  PayloadTooLargeException,
} from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import type { Request } from "express";
import { firstLine, reportException, type ErrorContext } from "./error-reporting";

/**
 * The last stop for every error a request raises, registered with APP_FILTER.
 *
 * Nest's own handler answers correctly but tells an operator almost nothing: an unhandled
 * error becomes a stack trace in the log with no hint of which workspace, which user or
 * which route it came from, and a 500 that Nest throws on purpose is not logged at all.
 * This filter adds one structured line for every server-side failure, sends each of
 * them to Sentry (when SENTRY_DSN is set) unless it was thrown as logOnly, and leaves
 * the answer itself to BaseExceptionFilter, so clients see exactly the bodies they did
 * before.
 *
 * What it writes is identifiers only. A request body can hold a password, a CSV of
 * phone numbers or a 2FA code, and headers hold tokens, so neither is ever read here.
 */
@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  private readonly logger = new Logger("Exceptions");

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== "http") {
      super.catch(exception, host);
      return;
    }

    const answer = toHttpException(exception);
    const status = answer.getStatus();

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const request = host.switchToHttp().getRequest<AuthenticatedRequest>();
      const context = describeRequest(request);
      const unexpected = answer !== exception;

      this.logger.error(JSON.stringify({ status, ...context, ...describeError(exception, unexpected) }));

      if (!isLogOnly(exception)) reportException(exception, context);
    }

    super.catch(answer, host);
  }
}

/**
 * Deliberate 5xx answers that are logged but not sent to Sentry, by identity: the
 * exception objects that logOnly marked.
 */
const LOG_ONLY = new WeakSet<object>();

/**
 * Marks a deliberate 5xx as one the filter logs but does not report, and returns it, so
 * the throw reads `throw logOnly(new ServiceUnavailableException(...))`.
 *
 * Only for an answer that is about a known state rather than a fault, where an alert
 * would tell nobody anything new: readiness finding the database down (the uptime
 * monitor's to report, and every real request is then failing and reported with its
 * own error) and recording audio, which is not built.
 *
 * The rule is the exception rather than its status, because most 503s are faults only
 * an operator can fix and that nobody would otherwise hear about: Clerk refusing our
 * secret key, a 2FA secret that no longer decrypts, a CRON_SECRET missing so background
 * jobs stop, the web offering Google sign-in to an API that has no Clerk key. The Vercel
 * log keeps an hour of those; Sentry keeps them, and groups the repeats into one issue.
 */
export function logOnly<T extends HttpException>(exception: T): T {
  LOG_ONLY.add(exception);
  return exception;
}

/** Whether logOnly marked this exception. */
export function isLogOnly(exception: unknown): boolean {
  return typeof exception === "object" && exception !== null && LOG_ONLY.has(exception);
}

/** The principal JwtAuthGuard and TenantGuard attach, as far as this filter reads it. */
type AuthenticatedRequest = Request & {
  user?: { sub?: string; tenantId?: string; apiKeyId?: string };
  tenantContext?: { tenantId?: string };
};

/**
 * The answer to send, as an HttpException.
 *
 * Express's body parsers fail with plain `http-errors` objects rather than HttpExceptions:
 * a 413 for a body over the limit, a 415 for an unsupported charset. Those are the
 * client's errors, and are answered with their own status and a message that says what
 * to do. Everything else that is not already an HttpException is a fault in the server,
 * answered with the same body Nest has always sent for one — no message, no detail.
 */
export function toHttpException(exception: unknown): HttpException {
  if (exception instanceof HttpException) return exception;

  const clientError = asClientError(exception);
  if (clientError) {
    if (clientError.type === "entity.too.large") {
      return new PayloadTooLargeException(
        "The request is too large for the server to accept. Send less data in one request.",
      );
    }
    return new HttpException(clientError.message, clientError.status);
  }

  return new HttpException(
    { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: "Internal server error" },
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

/** An `http-errors` 4xx that is safe to show (`expose`), as body-parser raises them. */
function asClientError(
  exception: unknown,
): { status: number; message: string; type?: string } | null {
  if (!exception || typeof exception !== "object") return null;
  const candidate = exception as { status?: unknown; statusCode?: unknown; expose?: unknown; message?: unknown; type?: unknown };
  const status = typeof candidate.status === "number" ? candidate.status : candidate.statusCode;
  if (typeof status !== "number" || status < 400 || status > 499) return null;
  if (candidate.expose !== true || typeof candidate.message !== "string") return null;
  return {
    status,
    message: candidate.message,
    type: typeof candidate.type === "string" ? candidate.type : undefined,
  };
}

/** Who and what the request was, from identifiers the guards already resolved. */
export function describeRequest(request: AuthenticatedRequest): ErrorContext {
  const path = (request.originalUrl ?? request.url ?? "").split("?")[0];
  const route = (request.route as { path?: string } | undefined)?.path;
  const vercelId = request.headers?.["x-vercel-id"];

  return {
    method: request.method,
    // The pattern groups every lead's errors as one route; the path is the fallback for
    // errors raised before routing, such as a body parser's. Never the query string,
    // which can carry a recording link's signature.
    route: route ?? path,
    tenantId: request.tenantContext?.tenantId ?? request.user?.tenantId,
    userId: request.user?.sub,
    apiKeyId: request.user?.apiKeyId,
    requestId: typeof vercelId === "string" ? vercelId : undefined,
  };
}

/**
 * The error's name, the first line of its message and where it was thrown — not the
 * rest of the message. Prisma's validation errors go on to print the arguments of the
 * failed query, which for a lead are its name and phone number.
 */
export function describeError(exception: unknown, unexpected: boolean): Record<string, unknown> {
  // Shape rather than instanceof: an error raised inside a native module — argon2 failing
  // to allocate memory, say — can come from another realm and fail an instanceof check.
  if (!isErrorLike(exception)) {
    return { error: typeof exception, message: firstLine(String(exception)) };
  }

  const described: Record<string, unknown> = {
    error: typeof exception.name === "string" && exception.name ? exception.name : "Error",
    message: firstLine(exception.message),
  };
  const code = exception.code;
  if (typeof code === "string") described.code = code;

  // A deliberate 5xx says what went wrong in its message; the stack of an unexpected one
  // is the only clue to where. Frames only — the stack's first line repeats the message.
  if (unexpected && typeof exception.stack === "string") {
    described.at = exception.stack
      .split("\n")
      .filter((line) => line.trimStart().startsWith("at "))
      .slice(0, 5)
      .map((line) => line.trim().slice(3));
  }
  return described;
}

function isErrorLike(
  value: unknown,
): value is { name?: unknown; message: string; stack?: unknown; code?: unknown } {
  return typeof value === "object" && value !== null && typeof (value as { message?: unknown }).message === "string";
}
