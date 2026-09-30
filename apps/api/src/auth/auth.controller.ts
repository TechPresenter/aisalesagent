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
import type { AuthTokens, LoginResponse, LoginResult } from "@appsgain/shared";
import { AccountRecoveryService } from "./account-recovery.service";
import { AuthService, type SessionSummary } from "./auth.service";
import { CurrentUser, Public } from "./decorators";
import {
  AcceptInvitationDto,
  ChangePasswordDto,
  CurrentPasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  PasswordAndCodeDto,
  RefreshDto,
  ResetPasswordDto,
  TokenDto,
  TwoFactorCodeDto,
  TwoFactorSignInDto,
  VerifyEmailDto,
} from "./dto/auth.dto";
import { InvitationAcceptService } from "./invitation-accept.service";
import { TwoFactorService } from "./two-factor.service";
import type { TenantContext } from "../prisma/tenant-prisma.provider";

/** TRD §8 — /auth. SSO (`POST /auth/sso`) is Enterprise-tier and not part of this phase. */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly recovery: AccountRecoveryService,
    private readonly twoFactor: TwoFactorService,
    private readonly invitations: InvitationAcceptService,
  ) {}

  /** A session, or — when the account has 2FA — a challenge for `login/2fa`. */
  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() request: Request): Promise<LoginResult> {
    return this.auth.login(dto, sessionContext(request));
  }

  @Public()
  @Post("login/2fa")
  @HttpCode(HttpStatus.OK)
  loginTwoFactor(@Body() dto: TwoFactorSignInDto, @Req() request: Request): Promise<LoginResponse> {
    return this.auth.completeTwoFactorSignIn(dto, sessionContext(request));
  }

  // ── account recovery (signed out) ─────────────────────────────────────────────────

  /** Whether this server can send email — so screens that depend on it can say so. */
  @Public()
  @Get("mail-status")
  mailStatus() {
    return this.recovery.mailStatus();
  }

  /** Always 204, account or not: the response must not reveal who has an account. */
  @Public()
  @Post("forgot-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.recovery.requestPasswordReset(dto);
  }

  @Public()
  @Post("reset-password/check")
  @HttpCode(HttpStatus.OK)
  checkResetToken(@Body() dto: TokenDto) {
    return this.recovery.checkResetToken(dto.token);
  }

  @Public()
  @Post("reset-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.recovery.resetPassword(dto.token, dto.password);
  }

  // ── invitations (signed out) ──────────────────────────────────────────────────────

  @Public()
  @Post("invitations/preview")
  @HttpCode(HttpStatus.OK)
  previewInvitation(@Body() dto: TokenDto) {
    return this.invitations.preview(dto.token);
  }

  /** Creates the invitee's account and signs it in. */
  @Public()
  @Post("invitations/accept")
  @HttpCode(HttpStatus.OK)
  acceptInvitation(@Body() dto: AcceptInvitationDto, @Req() request: Request): Promise<LoginResponse> {
    return this.invitations.accept(dto, sessionContext(request));
  }

  // ── the signed-in account's own security ──────────────────────────────────────────

  /** Settings → Security: email verification, 2FA, and whether email can be sent. */
  @Get("security")
  async security(@CurrentUser() user: TenantContext) {
    const [emailVerified, twoFactor] = await Promise.all([
      this.recovery.isEmailVerified(user.userId),
      this.twoFactor.status(user),
    ]);
    return { emailVerified, twoFactor, mail: this.recovery.mailStatus() };
  }

  @Post("verify-email/send")
  @HttpCode(HttpStatus.OK)
  sendVerificationCode(@CurrentUser() user: TenantContext) {
    return this.recovery.sendVerificationCode(user.userId);
  }

  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() dto: VerifyEmailDto, @CurrentUser() user: TenantContext) {
    return this.recovery.verifyEmail(user.userId, dto.code);
  }

  /** 2FA step one: a secret and the otpauth URI for the QR code. Needs the password. */
  @Post("2fa/setup")
  @HttpCode(HttpStatus.OK)
  beginTwoFactor(@Body() dto: CurrentPasswordDto, @CurrentUser() user: TenantContext) {
    return this.twoFactor.beginSetup(user, dto.password);
  }

  /** 2FA step two: the first code turns it on and returns the backup codes, once. */
  @Post("2fa/confirm")
  @HttpCode(HttpStatus.OK)
  confirmTwoFactor(@Body() dto: TwoFactorCodeDto, @CurrentUser() user: TenantContext) {
    return this.twoFactor.confirmSetup(user, dto.code);
  }

  @Post("2fa/disable")
  @HttpCode(HttpStatus.NO_CONTENT)
  async disableTwoFactor(@Body() dto: PasswordAndCodeDto, @CurrentUser() user: TenantContext): Promise<void> {
    await this.twoFactor.disable(user, dto.password, dto.code);
  }

  @Post("2fa/backup-codes")
  @HttpCode(HttpStatus.OK)
  regenerateBackupCodes(@Body() dto: PasswordAndCodeDto, @CurrentUser() user: TenantContext) {
    return this.twoFactor.regenerateBackupCodes(user, dto.password, dto.code);
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
