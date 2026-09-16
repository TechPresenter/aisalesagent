import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hasPermission, type JwtAccessPayload, type Permission, type Role } from "@appsgain/shared";
import { IS_PUBLIC_KEY, REQUIRED_PERMISSIONS_KEY } from "../decorators";
import type { RequestWithTenant } from "../../prisma/tenant-prisma.provider";

/**
 * Server-side enforcement of @RequirePermissions.
 *
 * The web app hides controls the user cannot use; that is a courtesy and nothing more.
 * A hidden button is still a reachable endpoint, so this guard is the half that decides.
 * Both sides read the same table in @appsgain/shared, so "what does this permission
 * mean" is stated once.
 *
 * Runs after TenantGuard, which has already established that the caller is authenticated
 * and belongs to the tenant they are asking about. This guard answers only the next
 * question: given that they are who they say, may they do this?
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // A route with no @RequirePermissions is governed by TenantGuard alone. That is a
    // deliberate default rather than deny-all: the guard chain is global, and making
    // every route declare a permission would mean health checks and token refresh need
    // one too.
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    const user = (request as unknown as { user?: JwtAccessPayload }).user;

    if (!user) {
      throw new ForbiddenException("Not authorised");
    }

    const role = user.role as Role;
    const missing = required.filter((permission) => !hasPermission(role, permission, user.perms));

    if (missing.length > 0) {
      // Logged with the specific permission, because "403 on /leads" in a support ticket
      // is not actionable and "missing leads.export" is.
      this.logger.warn(
        `Permission denied: user=${user.sub} tenant=${user.tenantId} role=${role} ` +
          `missing=${missing.join(",")} path=${request.method} ${request.url}`,
      );
      // The permission is named on purpose: this is an authenticated caller who is
      // allowed to know which capability they lack, and an opaque 403 turns a
      // self-service role fix into a support conversation. It leaks nothing about the
      // data, only about the caller's own grants.
      throw new ForbiddenException(`Missing permission: ${missing.join(", ")}`);
    }

    return true;
  }
}
