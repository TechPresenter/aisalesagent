import { ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import type { Request } from "express";
import { ApiKeyAuthService } from "../api-key-auth.service";
import { IS_PUBLIC_KEY } from "../decorators";

/**
 * Registered globally in AuthModule, so every route requires a valid access token unless
 * it is marked `@Public()`. Fail-closed: a new controller added by someone who has never
 * read this file is protected the moment it is routed.
 *
 * Accepts an API key as well (Feature List §14, public REST API), sent as `X-API-Key` or
 * as a bearer token starting `agk_`. A key resolves to the same principal shape a JWT
 * does, so TenantGuard and PermissionGuard treat both the same way — except that
 * PermissionGuard keeps keys off routes that declare no permission.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeyAuthService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const presented = readApiKey(request);
    if (presented !== null) {
      const principal = await this.apiKeys.authenticate(presented);
      // One message for unknown, revoked and expired alike: which of those it was is not
      // something to tell whoever is holding the key.
      if (!principal) throw new UnauthorizedException("Invalid, expired or revoked API key");
      request.user = principal;
      return true;
    }

    return super.canActivate(context) as Promise<boolean>;
  }
}

/** The key from `X-API-Key`, or from `Authorization: Bearer agk_…`; null when neither carries one. */
function readApiKey(request: Request): string | null {
  const header = request.headers["x-api-key"];
  if (typeof header === "string" && header.trim()) return header.trim();

  const authorization = request.headers.authorization;
  const match = typeof authorization === "string" ? authorization.match(/^Bearer\s+(agk_\S+)$/i) : null;
  return match ? match[1] : null;
}
