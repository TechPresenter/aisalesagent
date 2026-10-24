import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { canCrossTenantBoundary, type JwtAccessPayload, type Role } from "@appsgain/shared";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";

/**
 * The door to the operator console: a signed-in SUPER_ADMIN, and nobody else.
 *
 * The global guards already let a SUPER_ADMIN name another workspace on these routes
 * (they are @AllowCrossTenant), but a route that names no other workspace — the tenant
 * list, or an owner addressing their own workspace by id — would pass them for anyone.
 * So this asks the question explicitly, through `canCrossTenantBoundary`, the one
 * predicate every cross-tenant exemption goes through.
 *
 * It asks twice. The token says SUPER_ADMIN, and then the database is asked whether that
 * is still true: an access token lives fifteen minutes after a demotion, and on these
 * routes fifteen minutes is enough to empty the platform. Operator calls are rare, so the
 * extra read costs nothing that matters. API keys are refused outright — a key is a
 * workspace's credential, never the operator's.
 */
@Injectable()
export class OperatorGuard implements CanActivate {
  private readonly logger = new Logger(OperatorGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: JwtAccessPayload }>();
    const user = request.user;

    const claimed = Boolean(user && !user.apiKeyId && canCrossTenantBoundary(user.role));
    const current =
      claimed && user
        ? await this.prisma.user.findUnique({
            where: { id: user.sub },
            select: { role: true, status: true, tenantId: true },
          })
        : null;

    const allowed =
      current !== null &&
      current.status === "ACTIVE" &&
      current.tenantId === user?.tenantId &&
      canCrossTenantBoundary(current.role as Role);

    if (!allowed) {
      // Somebody who is not the operator found the console. Worth seeing in the logs.
      this.logger.warn(
        `Operator console refused: user=${user?.sub ?? "anonymous"} tenant=${user?.tenantId ?? "-"} ` +
          `role=${user?.role ?? "-"} path=${request.method} ${(request.originalUrl ?? request.url).split("?")[0]}`,
      );
      throw new ForbiddenException("The operator console is only for the platform operator.");
    }

    return true;
  }
}
