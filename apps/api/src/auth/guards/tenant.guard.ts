import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { canCrossTenantBoundary, hasAtLeastRole, type Role } from "@appsgain/shared";
import type { JwtAccessPayload } from "@appsgain/shared";
import {
  ALLOW_CROSS_TENANT_KEY,
  ALLOW_WHEN_SUSPENDED_KEY,
  IS_PUBLIC_KEY,
  REQUIRED_ROLE_KEY,
} from "../decorators";
import { PrismaService } from "../../prisma/prisma.service";
import type { RequestWithTenant } from "../../prisma/tenant-prisma.provider";
import { TenantAccessService, refusalFor } from "../tenant-access.service";

/**
 * The guard the TRD §5 requirement rests on: "Every request is authenticated and scoped
 * to exactly one tenant_id; the Super Admin role is the only one that can query across
 * tenants, and every cross-tenant action is audit-logged."
 *
 * It runs after JwtAuthGuard on every route and does four things:
 *
 *   1. Publishes the token's tenantId onto the request as `tenantContext`, which is what
 *      TenantPrismaFactory binds its client to. This is the only place a tenantId enters
 *      the system, and it comes from a signed token — never from a URL, header or body.
 *   2. Holds the workspace to its status: a SUSPENDED workspace (or one whose trial has
 *      ended) is read-only, a CANCELLED one is refused. Read through a 30-second cache
 *      (TenantAccessService), because a token outlives the moment it was issued and the
 *      status can change under it.
 *   3. Rejects any request that *names* a different tenant than its token carries. A
 *      caller cannot escalate by passing `?tenantId=` or a body field, and the attempt
 *      is logged rather than silently ignored. The one exception, a SUPER_ADMIN on an
 *      @AllowCrossTenant route, writes an audit row in the workspace it reached into.
 *   4. Enforces @MinRole where present.
 *
 * Worth being clear about the division of labour: this guard stops a caller *asking* for
 * another tenant's data. It is the scoped Prisma client (src/prisma/tenant-scoped.ts)
 * that stops the API *returning* it when nobody asked — a forgotten `where` in a service
 * three releases from now. Neither layer is sufficient alone, which is why there are two.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tenantAccess: TenantAccessService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    const user = (request as unknown as { user?: JwtAccessPayload }).user;

    if (!user?.tenantId) {
      throw new UnauthorizedException("Request is not scoped to a tenant");
    }

    // The caller's own workspace first: a closed workspace is refused whatever it asks
    // for, and a suspended one may only read.
    const refusal = refusalFor(await this.tenantAccess.lookup(user.tenantId), {
      method: request.method,
      allowWhenSuspended:
        this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_SUSPENDED_KEY, [
          context.getHandler(),
          context.getClass(),
        ]) ?? false,
    });
    if (refusal) throw refusal;

    const role = user.role as Role;
    const isSuperAdmin = canCrossTenantBoundary(role);

    const requestedTenantId = this.readRequestedTenantId(request);
    if (requestedTenantId && requestedTenantId !== user.tenantId) {
      const allowCrossTenant = this.reflector.getAllAndOverride<boolean>(ALLOW_CROSS_TENANT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

      if (!isSuperAdmin || !allowCrossTenant) {
        // Logged at warn: a request naming someone else's tenant is either a bug in a
        // client or someone probing, and both are worth seeing in the logs.
        this.logger.warn(
          `Cross-tenant request denied: user=${user.sub} token_tenant=${user.tenantId} ` +
            `requested_tenant=${requestedTenantId} path=${request.method} ${request.url}`,
        );
        throw new ForbiddenException("Cross-tenant access is not permitted");
      }

      // TRD §5 — "every cross-tenant action is audit-logged".
      await this.auditCrossTenantAccess(user, requestedTenantId, request);
    }

    request.tenantContext = {
      // Always the token's tenant, even for a super admin: a cross-tenant route reads
      // its target from the validated parameter, it does not get it silently swapped in
      // underneath the data layer.
      tenantId: user.tenantId,
      userId: user.sub,
      role,
    };

    const requiredRole = this.reflector.getAllAndOverride<Role>(REQUIRED_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredRole && !hasAtLeastRole(role, requiredRole)) {
      throw new ForbiddenException(`Requires ${requiredRole} or higher`);
    }

    return true;
  }

  /**
   * The record TRD §5 asks for, written before the handler runs so an attempt is on file
   * even if the handler then fails. It goes in the workspace that was reached into, so
   * that workspace's own audit log shows who from the platform looked, and when.
   *
   * Written synchronously, and a failure to write it fails the request: an operator
   * action the trail does not show is the thing this exists to prevent. A workspace that
   * does not exist is a 404 — only a SUPER_ADMIN gets this far, so saying so leaks
   * nothing to anyone who could not already list the workspaces.
   */
  private async auditCrossTenantAccess(
    user: JwtAccessPayload,
    targetTenantId: string,
    request: RequestWithTenant,
  ): Promise<void> {
    const target = await this.prisma.tenant.findUnique({
      where: { id: targetTenantId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException("Workspace not found");

    const path = (request.originalUrl ?? request.url ?? "").split("?")[0];
    await this.prisma.auditLog.create({
      data: {
        tenantId: targetTenantId,
        actorId: user.sub,
        actorEmail: user.email,
        action: "platform.cross_tenant_access",
        resourceType: "tenant",
        resourceId: targetTenantId,
        metadata: { method: request.method, path, operatorTenantId: user.tenantId },
        ipAddress: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
      },
    });

    this.logger.log(
      `SUPER_ADMIN cross-tenant access: user=${user.sub} target_tenant=${targetTenantId} ` +
        `path=${request.method} ${path}`,
    );
  }

  /**
   * A tenantId mentioned anywhere the client controls. Checking all three matters: a
   * route that reads it from the body is just as exploitable as one that reads it from
   * the path, and which one a future endpoint uses is not knowable here.
   */
  private readRequestedTenantId(request: RequestWithTenant): string | undefined {
    const fromParams = (request.params as Record<string, string> | undefined)?.tenantId;
    const fromQuery = (request.query as Record<string, unknown> | undefined)?.tenantId;
    const fromBody = (request.body as Record<string, unknown> | undefined)?.tenantId;

    const candidate = fromParams ?? fromQuery ?? fromBody;
    return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
  }
}
