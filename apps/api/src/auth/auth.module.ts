import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { TenantGuard } from "./guards/tenant.guard";
import { PermissionGuard } from "./guards/permission.guard";

/**
 * All three guards are registered globally, and the order matters: Nest runs APP_GUARD
 * providers in declaration order, so JwtAuthGuard populates `request.user` before
 * TenantGuard reads the tenant claim off it. Swapping them makes every request 401.
 *
 * PermissionGuard runs last, and only ever narrows: by the time it sees a request the
 * caller is authenticated and confirmed to be inside their own tenant, so the only
 * question left is whether their grants cover this particular route.
 *
 * Registering globally rather than per-controller is the whole point — a route is
 * protected because it exists, not because someone remembered a decorator.
 */
@Module({
  imports: [ConfigModule, PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
