import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Permission, Role } from "@appsgain/shared";
import type { RequestWithTenant, TenantContext } from "../prisma/tenant-prisma.provider";

export const IS_PUBLIC_KEY = "auth:isPublic";
export const REQUIRED_ROLE_KEY = "auth:requiredRole";
export const ALLOW_CROSS_TENANT_KEY = "auth:allowCrossTenant";
export const REQUIRED_PERMISSIONS_KEY = "auth:requiredPermissions";

/**
 * Opens a route to unauthenticated callers. Authentication is on by default — the guards
 * are registered globally — so the small number of open routes are the ones that have to
 * say so, rather than every protected route repeating a decorator it can forget.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Requires at least this role, by the rank order in @appsgain/shared. */
export const MinRole = (role: Role) => SetMetadata(REQUIRED_ROLE_KEY, role);

/**
 * Requires every listed permission.
 *
 * Preferred over @MinRole for anything a custom role should be able to grant: rank
 * answers "is this person senior enough", which is the wrong question for "may this
 * person export leads" — a workspace may well want an analyst who can export but not
 * delete. @MinRole remains right for the handful of checks that really are about
 * seniority, such as reaching the admin group at all.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/**
 * Marks a route as legitimately cross-tenant (the /admin group, TRD §8). TenantGuard
 * still requires SUPER_ADMIN to reach it — this only stops the guard from rejecting a
 * tenantId in the request that differs from the token's.
 */
export const AllowCrossTenant = () => SetMetadata(ALLOW_CROSS_TENANT_KEY, true);

/** The authenticated caller, as resolved from the access token. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const request = ctx.switchToHttp().getRequest<RequestWithTenant>();
    return request.tenantContext as TenantContext;
  },
);

/** Shorthand for the caller's tenant id, which most handlers are all they need. */
export const CurrentTenant = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<RequestWithTenant>();
  return (request.tenantContext as TenantContext).tenantId;
});
