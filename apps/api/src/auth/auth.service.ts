import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import type {
  AuthTokens,
  JwtAccessPayload,
  JwtRefreshPayload,
  LoginResponse,
  Role,
  SessionUser,
} from "@appsgain/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { LoginDto } from "./dto/auth.dto";

/**
 * Where a session was created. Recorded so Settings → Security can list "this browser,
 * from this address, since Tuesday" rather than five identical rows nobody can act on.
 */
export interface SessionContext {
  userAgent?: string | null;
  ipAddress?: string | null;
}

/** One live session, as Settings lists it. */
export interface SessionSummary {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
}

/**
 * TRD §8 — /auth. Access tokens are short-lived and carry the tenant claim every scoped
 * query is filtered by; refresh tokens are long-lived, stored hashed, and rotate on use.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  static hashPassword(plaintext: string): Promise<string> {
    // argon2id: memory-hard, so a leaked table is expensive to attack with GPUs.
    return argon2.hash(plaintext, { type: argon2.argon2id });
  }

  /**
   * Login is one of the few places allowed the unscoped client — there is no tenant to
   * scope to until the workspace has been resolved from the subdomain.
   */
  async login(dto: LoginDto, context: SessionContext = {}): Promise<LoginResponse> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { subdomain: dto.subdomain },
      select: { id: true, name: true, status: true },
    });

    const user = tenant
      ? await this.prisma.user.findUnique({
          where: { tenantId_email: { tenantId: tenant.id, email: dto.email.toLowerCase() } },
        })
      : null;

    // One message and one code for "no such workspace", "no such user" and "wrong
    // password". Distinguishing them turns the endpoint into an oracle for which
    // workspaces exist and who belongs to them.
    if (!tenant || !user || user.status !== "ACTIVE") {
      // Still spend the time an Argon2 verify would take, so response timing does not
      // separate a real account from a missing one.
      await this.burnVerifyTime(dto.password);
      throw new UnauthorizedException("Invalid credentials");
    }

    const passwordMatches = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordMatches) {
      throw new UnauthorizedException("Invalid credentials");
    }

    if (tenant.status === "CANCELLED") {
      throw new UnauthorizedException("This workspace is no longer active");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.issueTokens({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role as Role,
      email: user.email,
      context,
    });

    const sessionUser: SessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      tenantId: user.tenantId,
      tenantName: tenant.name,
    };

    return { ...tokens, user: sessionUser };
  }

  /**
   * Rotation: the presented refresh token is revoked as part of issuing the new pair, so
   * a stolen token is usable at most once and the theft shows up as the real user being
   * logged out.
   *
   * Role and tenant are re-read from the database rather than copied from the old token,
   * which is what makes a demotion or a disabled account take effect within one refresh
   * cycle instead of whenever the last long-lived token happens to expire.
   */
  async refresh(refreshToken: string, context: SessionContext = {}): Promise<AuthTokens> {
    const payload = await this.verifyRefreshToken(refreshToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { id: payload.jti },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException("Refresh token is no longer valid");
    }

    const matches = await argon2.verify(stored.tokenHash, refreshToken);
    if (!matches || stored.userId !== payload.sub) {
      throw new UnauthorizedException("Refresh token is no longer valid");
    }

    if (stored.user.status !== "ACTIVE") {
      throw new UnauthorizedException("Account is not active");
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens({
      userId: stored.user.id,
      tenantId: stored.user.tenantId,
      role: stored.user.role as Role,
      email: stored.user.email,
      context,
    });
  }

  /**
   * Revokes exactly the presented session. Idempotent and quiet: logging out with an
   * already-revoked or unparseable token still succeeds, because there is nothing useful
   * a caller can do with the failure and reporting it tells an attacker whether a token
   * they hold is live.
   */
  async logout(refreshToken: string): Promise<void> {
    try {
      const payload = await this.verifyRefreshToken(refreshToken);
      await this.prisma.refreshToken.updateMany({
        where: { id: payload.jti, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      this.logger.debug("Logout presented a token that was already invalid");
    }
  }

  /**
   * The caller's live sessions: signed in, not revoked, not expired.
   *
   * Only ever their own — the user id comes from the token, so this cannot be pointed at
   * a colleague's devices.
   */
  async listSessions(userId: string): Promise<SessionSummary[]> {
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return rows.map((row) => ({
      id: row.id,
      userAgent: row.userAgent,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    }));
  }

  /** Ends one session. Scoped to the caller's own, so an id alone is not enough. */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (result.count === 0) {
      throw new NotFoundException("That session is not active");
    }
  }

  /** Revokes every live session for a user — for a password change or a disabled account. */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Changes the caller's own password.
   *
   * The current password is required even though the caller already holds a valid access
   * token: a token is a bearer credential that may have been picked up from an unlocked
   * machine, and a password change hands over the account permanently. So the change is
   * re-authenticated at the moment it is made.
   *
   * Every session is then revoked, which is what makes changing a password after a leak
   * actually eject whoever prompted it — this one included, so the browser signs in again.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("This account is not active");
    }

    if (!(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new UnauthorizedException("Your current password is not correct");
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException("The new password must be different from the current one");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await AuthService.hashPassword(newPassword) },
    });

    await this.revokeAllSessions(user.id);
    this.logger.log(`Password changed for user ${user.id}`);
  }

  private async issueTokens(input: {
    userId: string;
    tenantId: string;
    role: Role;
    email: string;
    context?: SessionContext;
  }): Promise<AuthTokens> {
    const accessPayload: JwtAccessPayload = {
      sub: input.userId,
      tenantId: input.tenantId,
      role: input.role,
      email: input.email,
    };

    const accessTtl = this.config.get<string>("JWT_ACCESS_TTL", "15m");
    const refreshTtl = this.config.get<string>("JWT_REFRESH_TTL", "7d");

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
      expiresIn: accessTtl,
    });

    // The row is created first so its id can go into the token as `jti`; the token is
    // then hashed into the row it points at.
    const jti = randomUUID();
    const refreshPayload: JwtRefreshPayload = { sub: input.userId, jti };

    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"),
      expiresIn: refreshTtl,
    });

    await this.prisma.refreshToken.create({
      data: {
        id: jti,
        tenantId: input.tenantId,
        userId: input.userId,
        tokenHash: await argon2.hash(refreshToken, { type: argon2.argon2id }),
        // Truncated rather than rejected: a bizarre user agent is not a reason to refuse
        // a valid sign-in, and the column is for recognition, not forensics.
        userAgent: input.context?.userAgent?.slice(0, 255) ?? null,
        ipAddress: input.context?.ipAddress?.slice(0, 64) ?? null,
        expiresAt: new Date(Date.now() + parseDuration(refreshTtl)),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(parseDuration(accessTtl) / 1000),
    };
  }

  private async verifyRefreshToken(token: string): Promise<JwtRefreshPayload> {
    try {
      return await this.jwt.verifyAsync<JwtRefreshPayload>(token, {
        secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"),
      });
    } catch {
      throw new UnauthorizedException("Refresh token is no longer valid");
    }
  }

  /**
   * Argon2 against a throwaway digest, so a login for an address with no account costs
   * the same wall-clock time as one with an account and a wrong password. Without this,
   * the endpoint answers "does this workspace have a user with this email?" in the
   * response time, whatever the body says.
   *
   * The decoy is a real digest of a random secret, computed once on first use — a
   * hard-coded literal would have to be a valid Argon2 encoding or `verify` throws
   * immediately and burns no time at all, defeating the purpose.
   */
  private async burnVerifyTime(candidate: string): Promise<void> {
    try {
      await argon2.verify(await this.timingDecoyHash(), candidate);
    } catch {
      // Expected — the decoy never matches. Swallowed so the caller still gets a 401.
    }
  }

  private decoyHash?: Promise<string>;

  private timingDecoyHash(): Promise<string> {
    this.decoyHash ??= argon2.hash(randomUUID(), { type: argon2.argon2id });
    return this.decoyHash;
  }
}

/** "15m" | "7d" | "3600s" -> milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new Error(`Unparseable duration: "${value}". Use e.g. 15m, 24h, 7d.`);
  }

  const amount = Number(match[1]);
  const unit = match[2] as "ms" | "s" | "m" | "h" | "d";
  const multipliers = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return amount * multipliers[unit];
}
