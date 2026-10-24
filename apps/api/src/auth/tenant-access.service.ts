import { ForbiddenException, HttpException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { TenantStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/** What TenantGuard needs to know about the caller's workspace. */
export interface TenantAccess {
  status: TenantStatus;
  trialEndsAt: Date | null;
}

/**
 * How long a workspace's status is trusted before it is read again. A suspension made on
 * this instance applies at once (the operator console forgets the entry); one made on
 * another instance applies within this window. Thirty seconds is short enough that "I
 * suspended them and they are still writing" is not a support conversation, and long
 * enough that the guard reads the database a couple of times a minute per active
 * workspace rather than on every request.
 */
export const TENANT_ACCESS_TTL_MS = 30_000;

/** Bounds the cache on a long-lived server; expired entries are dropped first. */
const MAX_CACHED_TENANTS = 10_000;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Looks up a workspace's status for TenantGuard, with a short cache.
 *
 * Reads through the unscoped client because the question is about the tenant row itself,
 * which has no tenant scope, and is asked before any tenant context exists.
 */
@Injectable()
export class TenantAccessService {
  private readonly cache = new Map<string, { access: TenantAccess | null; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async lookup(tenantId: string, now = Date.now()): Promise<TenantAccess | null> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > now) return cached.access;

    const access = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true, trialEndsAt: true },
    });

    if (this.cache.size >= MAX_CACHED_TENANTS) this.evict(now);
    this.cache.set(tenantId, { access, expiresAt: now + TENANT_ACCESS_TTL_MS });
    return access;
  }

  /** Drops a workspace's cached status, so a change just made applies to the next request. */
  forget(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  private evict(now: number): void {
    for (const [tenantId, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(tenantId);
    }
    // Everything still fresh: drop the oldest insertions instead. A Map iterates in
    // insertion order, so these are the entries closest to expiring anyway.
    for (const tenantId of this.cache.keys()) {
      if (this.cache.size < MAX_CACHED_TENANTS) break;
      this.cache.delete(tenantId);
    }
  }
}

/**
 * Whether a workspace in this state may make this request. Null when it may; otherwise
 * the exception to answer with.
 *
 *   - ACTIVE, and TRIAL while the trial lasts: anything.
 *   - SUSPENDED, and TRIAL once `trialEndsAt` has passed: reads, plus the routes marked
 *     @AllowWhenSuspended (billing, and a person's own account security). Read-only
 *     rather than locked out, so the workspace can still see its data and settle up.
 *   - CANCELLED: nothing. Its sessions and API keys were revoked when it was cancelled;
 *     this catches an access token issued before that, for the minutes it has left.
 *   - No such workspace: 401, as for any credential that no longer means anything.
 *
 * The 403s carry a `code`, so the web app can show a banner instead of a toast per click.
 */
export function refusalFor(
  access: TenantAccess | null,
  request: { method: string; allowWhenSuspended: boolean },
  now = new Date(),
): HttpException | null {
  if (!access) return new UnauthorizedException("This workspace no longer exists");

  if (access.status === "CANCELLED") {
    return new ForbiddenException({
      statusCode: 403,
      error: "Forbidden",
      code: "WORKSPACE_CANCELLED",
      message: "This workspace has been closed.",
    });
  }

  const trialOver =
    access.status === "TRIAL" && access.trialEndsAt !== null && access.trialEndsAt <= now;

  if (access.status !== "SUSPENDED" && !trialOver) return null;
  if (SAFE_METHODS.has(request.method.toUpperCase()) || request.allowWhenSuspended) return null;

  return new ForbiddenException({
    statusCode: 403,
    error: "Forbidden",
    code: trialOver ? "TRIAL_ENDED" : "WORKSPACE_SUSPENDED",
    message: trialOver
      ? "Your trial has ended, so this workspace is read-only. Upgrade to make changes again."
      : "This workspace is suspended, so it is read-only until it is reactivated.",
  });
}
