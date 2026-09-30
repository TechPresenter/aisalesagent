import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";
import { appUrl } from "../config/app-url";
import { passwordResetMail, securityNoticeMail, verificationCodeMail } from "../mail/mail-templates";
import { MailService, maskAddress } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { AttemptLimiter } from "./attempt-limiter";
import { AuthService } from "./auth.service";
import {
  EMAIL_CODE_WINDOW_MS,
  checkEmailVerificationCode,
  emailCodeWindow,
  emailVerificationCode,
  passwordFingerprint,
  signPurposeToken,
  verifyPurposeToken,
} from "./purpose-token";

const RESET_TTL_MS = 60 * 60_000;

/**
 * Feature List §1 — forgot password and email verification.
 *
 * Both run before a person can prove who they are, so both are built to give nothing away:
 * asking for a reset link answers the same way whether or not the account exists, and the
 * links and codes themselves are signed, expiring and bound to the state they were issued
 * against rather than stored where a database read could replay them.
 */
@Injectable()
export class AccountRecoveryService {
  private readonly logger = new Logger(AccountRecoveryService.name);

  /** One reset email per account per minute: enough for a typo, not enough to flood an inbox. */
  private readonly resetSends = new AttemptLimiter(1, 60_000);
  /** One verification email per 30 seconds, matching the resend countdown on screen. */
  private readonly codeSends = new AttemptLimiter(1, 30_000);
  /** Five guesses per fifteen minutes against a million possible codes. */
  private readonly codeGuesses = new AttemptLimiter(5, EMAIL_CODE_WINDOW_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly auth: AuthService,
  ) {}

  mailStatus() {
    const { deliverable, devLog } = this.mail.status();
    return { deliverable, devLog };
  }

  /**
   * Sends a reset link when the account exists. Always resolves the same way, and sends in
   * the background, so neither the response nor its timing says whether it does.
   */
  async requestPasswordReset(input: { subdomain: string; email: string }): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { subdomain: input.subdomain },
      select: { id: true, name: true, status: true },
    });
    const user = tenant
      ? await this.prisma.user.findUnique({
          where: { tenantId_email: { tenantId: tenant.id, email: input.email.trim().toLowerCase() } },
        })
      : null;

    if (!tenant || tenant.status === "CANCELLED" || !user || user.status !== "ACTIVE") {
      this.logger.log(`Password reset asked for ${maskAddress(input.email)}: no active account, nothing sent`);
      return;
    }
    if (!this.resetSends.hit(user.id)) return;

    const token = signPurposeToken(
      this.secret(),
      "password-reset",
      { u: user.id, t: user.tenantId, f: passwordFingerprint(user.passwordHash) },
      RESET_TTL_MS,
    );
    const link = appUrl(`/reset-password?token=${encodeURIComponent(token)}`);

    void this.mail.send({
      to: user.email,
      ...passwordResetMail({ name: user.name, workspace: tenant.name, link, minutes: RESET_TTL_MS / 60_000 }),
    });
  }

  /** Lets the reset page say "this link has expired" before someone types a new password. */
  async checkResetToken(token: string): Promise<{ valid: boolean; email?: string }> {
    const user = await this.userForResetToken(token);
    return user ? { valid: true, email: user.email } : { valid: false };
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const user = await this.userForResetToken(token);
    if (!user) {
      throw new BadRequestException("This reset link has expired or has already been used. Ask for a new one.");
    }
    if (await argon2.verify(user.passwordHash, password)) {
      throw new BadRequestException("Choose a password different from your current one.");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await AuthService.hashPassword(password),
        // Whoever reset it holds the inbox, which is the account; a pause from earlier
        // guessing should not keep them out of it.
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.auth.revokeAllSessions(user.id);
    this.logger.log(`Password reset completed for user ${user.id}`);

    void this.mail.send({
      to: user.email,
      ...securityNoticeMail({
        name: user.name,
        event: "Your password was reset",
        detail: "The password for your Appsgain account was reset from an emailed link, and every device was signed out.",
      }),
    });
  }

  // ── email verification ────────────────────────────────────────────────────────────

  async sendVerificationCode(userId: string): Promise<{ sent: boolean; alreadyVerified: boolean }> {
    const user = await this.activeUser(userId);
    if (user.emailVerifiedAt) return { sent: false, alreadyVerified: true };

    if (!this.codeSends.hit(user.id)) {
      throw new HttpException(
        `Wait ${this.codeSends.retryAfterSeconds(user.id)} seconds before asking for another code.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = emailVerificationCode(this.secret(), user.id, user.email, emailCodeWindow());
    const result = await this.mail.send({
      to: user.email,
      ...verificationCodeMail({ name: user.name, code, minutes: EMAIL_CODE_WINDOW_MS / 60_000 }),
    });
    if (!result.ok) {
      this.codeSends.clear(user.id);
      throw new ServiceUnavailableException(result.reason);
    }
    return { sent: true, alreadyVerified: false };
  }

  async verifyEmail(userId: string, code: string): Promise<{ verified: true }> {
    const user = await this.activeUser(userId);
    if (user.emailVerifiedAt) return { verified: true };

    if (!this.codeGuesses.hit(user.id)) {
      throw new HttpException(
        "Too many wrong codes. Wait a few minutes, then ask for a new one.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!checkEmailVerificationCode(this.secret(), user.id, user.email, code)) {
      throw new BadRequestException("That code is not right, or it has expired.");
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    this.codeGuesses.clear(user.id);
    return { verified: true };
  }

  async isEmailVerified(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } });
    return Boolean(user?.emailVerifiedAt);
  }

  private async userForResetToken(token: string) {
    const claims = verifyPurposeToken(this.secret(), "password-reset", token);
    if (!claims) return null;

    const user = await this.prisma.user.findUnique({
      where: { id: claims.u },
      include: { tenant: { select: { status: true } } },
    });
    if (
      !user ||
      user.tenantId !== claims.t ||
      user.status !== "ACTIVE" ||
      user.tenant.status === "CANCELLED" ||
      passwordFingerprint(user.passwordHash) !== claims.f
    ) {
      return null;
    }
    return user;
  }

  private async activeUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "ACTIVE") throw new UnauthorizedException("This account is not active.");
    return user;
  }

  private secret(): string {
    return this.config.getOrThrow<string>("JWT_ACCESS_SECRET");
  }
}
