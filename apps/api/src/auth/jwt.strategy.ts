import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { JwtAccessPayload } from "@appsgain/shared";

/**
 * Validates the access token's signature and expiry only. Deliberately does *not* hit
 * the database: an access token lives 15 minutes, and paying for a user lookup on every
 * request to shorten that window to zero is a bad trade. Anything that must take effect
 * immediately — a disabled account, a revoked session — is enforced at refresh time,
 * where the lookup happens anyway.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>("JWT_ACCESS_SECRET"),
    });
  }

  validate(payload: JwtAccessPayload): JwtAccessPayload {
    // A token without a tenant claim cannot be scoped, so it cannot be trusted. This
    // catches a token minted by an older version of the signer as well as a forged one.
    if (!payload?.sub || !payload?.tenantId || !payload?.role) {
      throw new UnauthorizedException("Malformed access token");
    }
    return payload;
  }
}
