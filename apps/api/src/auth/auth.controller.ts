import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import type { AuthTokens, LoginResponse } from "@appsgain/shared";
import { AuthService, type SessionSummary } from "./auth.service";
import { CurrentUser, Public } from "./decorators";
import { ChangePasswordDto, LoginDto, LogoutDto, RefreshDto } from "./dto/auth.dto";
import type { TenantContext } from "../prisma/tenant-prisma.provider";

/** TRD §8 — /auth. SSO (`POST /auth/sso`) is Enterprise-tier and not part of this phase. */
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() request: Request): Promise<LoginResponse> {
    return this.auth.login(dto, sessionContext(request));
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto, @Req() request: Request): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken, sessionContext(request));
  }

  /**
   * Public because a caller whose access token has already expired must still be able to
   * end the session — requiring a live access token to log out is how sessions get left
   * open. The refresh token in the body is the credential being spent.
   */
  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  /**
   * Changes the caller's own password — and only their own: the user comes from the
   * token, never from the body, so this cannot be pointed at someone else's account.
   */
  @Post("change-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: TenantContext,
  ): Promise<void> {
    await this.auth.changePassword(user.userId, dto.currentPassword, dto.newPassword);
  }

  /** Echoes back what the token resolved to — useful for debugging a tenant mix-up. */
  @Get("me")
  me(@CurrentUser() user: TenantContext): TenantContext {
    return user;
  }

  /** Settings → Security: where this account is currently signed in. */
  @Get("sessions")
  sessions(@CurrentUser() user: TenantContext): Promise<SessionSummary[]> {
    return this.auth.listSessions(user.userId);
  }

  /** Ends one of the caller's own sessions. */
  @Delete("sessions/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: TenantContext,
  ): Promise<void> {
    await this.auth.revokeSession(user.userId, id);
  }

  /** Signs the caller out everywhere, this browser included. */
  @Post("sessions/revoke-all")
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeAllSessions(@CurrentUser() user: TenantContext): Promise<void> {
    await this.auth.revokeAllSessions(user.userId);
  }
}

/**
 * What a session row records about where it was created. `request.ip` is the socket
 * address unless Express is told to trust a proxy — recorded as it comes rather than
 * guessed from headers a client can forge.
 */
function sessionContext(request: Request) {
  return {
    userAgent: request.headers["user-agent"] ?? null,
    ipAddress: request.ip ?? null,
  };
}
