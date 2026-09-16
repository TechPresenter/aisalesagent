import { Inject, Injectable, Scope, UnauthorizedException } from "@nestjs/common";
import { REQUEST } from "@nestjs/core";
import type { Request } from "express";
import { PrismaService } from "./prisma.service";
import type { TenantScopedClient } from "./tenant-scoped";

/** What TenantGuard attaches to the request once the JWT has been resolved. */
export interface TenantContext {
  tenantId: string;
  userId: string;
  role: string;
}

export type RequestWithTenant = Request & { tenantContext?: TenantContext };

export const TENANT_PRISMA = Symbol("TENANT_PRISMA");

/**
 * A request-scoped Prisma client already bound to the caller's workspace.
 *
 * Feature services inject this rather than PrismaService, which means the ordinary way
 * to write a query is also the safe way — `this.db.lead.findMany()` returns this
 * tenant's leads and cannot be made to return anyone else's, even with a hand-written
 * `where`. Reaching past it to PrismaService is the thing a reviewer should look for.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantPrismaFactory {
  constructor(
    @Inject(REQUEST) private readonly request: RequestWithTenant,
    private readonly prisma: PrismaService,
  ) {}

  get client(): TenantScopedClient {
    const context = this.request.tenantContext;
    if (!context?.tenantId) {
      // Reaching here means a route used the tenant client without passing the guards —
      // an unauthenticated route asking for tenant data. Fail rather than guess.
      throw new UnauthorizedException("No tenant context on this request");
    }
    return this.prisma.forTenant(context.tenantId);
  }

  /**
   * A tagged-template escape hatch for the queries Prisma's query builder cannot express
   * — date bucketing, window functions, `FILTER (WHERE ...)`.
   *
   * Named `raw` and reached through this factory on purpose: `grep -rn "tenantPrisma.raw"`
   * lists every query in the codebase where the automatic tenant filter does **not**
   * apply, which is the set a security review needs to look at. Each one must name
   * `tenant_id` in its WHERE clause and bind it as a parameter.
   */
  raw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> {
    // Touching `context` first so an unauthenticated request fails here rather than
    // running an unscoped query.
    void this.context.tenantId;
    return this.prisma.$queryRaw(strings, ...values) as Promise<T>;
  }

  get context(): TenantContext {
    const context = this.request.tenantContext;
    if (!context) {
      throw new UnauthorizedException("No tenant context on this request");
    }
    return context;
  }
}
