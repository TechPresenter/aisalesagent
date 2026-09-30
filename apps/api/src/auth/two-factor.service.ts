import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type TwoFactorAuth } from "@prisma/client";
import * as argon2 from "argon2";
import { hkdfSync } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { scopedCreate, type TenantScopedClient } from "../prisma/tenant-scoped";
import {
  decryptCredentials,
  encryptCredentials,
  encryptionAvailable,
} from "../providers/crypto.util";
import { securityNoticeMail } from "../mail/mail-templates";
import { MailService } from "../mail/mail.service";
import { keepAlive } from "../runtime/vercel";
import {
  TOTP_STEP_SECONDS,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  looksLikeBackupCode,
  otpauthUri,
  totpStep,
  verifyTotp,
} from "./totp";

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: string | null;
  backupCodesRemaining: number;
}

interface Caller {
  tenantId: string;
  userId: string;
}

/**
 * Feature List §19 — Settings → Security → two-factor authentication.
 *
 * Enrolment is two steps, as the schema models it: `setup` creates a secret and shows it
 * once; the row does nothing until `confirm` proves an authenticator app produces the
 * right codes. An unconfirmed row can therefore never lock anyone out — sign-in only asks
 * for a code when `confirmedAt` is set.
 *
 * Every change asks for the password again, because holding a session is not proof of
 * being the account's owner: a borrowed laptop could otherwise enrol its own phone and
 * lock the real owner out, or switch the second factor off.
 */
@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  /** Sign-in's question. Unscoped by id, like the rest of sign-in: no tenant is known yet. */
  async isEnabled(userId: string): Promise<boolean> {
    const row = await this.prisma.twoFactorAuth.findUnique({
      where: { userId },
      select: { confirmedAt: true },
    });
    return Boolean(row?.confirmedAt);
  }

  async status(caller: Caller): Promise<TwoFactorStatus> {
    const row = await this.db(caller).twoFactorAuth.findFirst({
      where: { userId: caller.userId },
      include: { backupCodes: { where: { usedAt: null }, select: { id: true } } },
    });
    const enabled = Boolean(row?.confirmedAt);
    return {
      enabled,
      enabledAt: row?.confirmedAt?.toISOString() ?? null,
      backupCodesRemaining: enabled && row ? row.backupCodes.length : 0,
    };
  }

  /** Step one: a new secret, shown once. Replaces any enrolment that was never confirmed. */
  async beginSetup(caller: Caller, password: string): Promise<{ secret: string; otpauthUri: string }> {
    this.requireEncryption();
    const user = await this.requirePassword(caller, password);
    const db = this.db(caller);

    const existing = await db.twoFactorAuth.findFirst({ where: { userId: caller.userId } });
    if (existing?.confirmedAt) {
      throw new BadRequestException(
        "Two-factor authentication is already on. Turn it off first to move it to a new device.",
      );
    }

    const secret = generateTotpSecret();
    if (existing) {
      await db.backupCode.deleteMany({ where: { twoFactorId: existing.id } });
      await db.twoFactorAuth.update({
        where: { id: existing.id },
        data: { secretEncrypted: encryptCredentials(secret), confirmedAt: null, lastUsedAt: null },
      });
    } else {
      await db.twoFactorAuth.create({
        data: scopedCreate<Prisma.TwoFactorAuthUncheckedCreateInput>({
          userId: caller.userId,
          secretEncrypted: encryptCredentials(secret),
        }),
      });
    }

    return {
      secret,
      otpauthUri: otpauthUri({
        issuer: "Appsgain",
        account: `${user.email} (${user.tenant.subdomain})`,
        secret,
      }),
    };
  }

  /** Step two: the first code from the app switches it on and issues backup codes. */
  async confirmSetup(caller: Caller, code: string): Promise<{ backupCodes: string[] }> {
    const db = this.db(caller);
    const row = await db.twoFactorAuth.findFirst({ where: { userId: caller.userId } });
    if (!row) throw new BadRequestException("Start two-factor setup first.");
    if (row.confirmedAt) throw new BadRequestException("Two-factor authentication is already on.");

    const step = verifyTotp(this.secretOf(row), code);
    if (step === null) {
      throw new BadRequestException(
        "That code is not right. Check the time on your phone is set automatically, then try the newest code.",
      );
    }

    await db.twoFactorAuth.update({
      where: { id: row.id },
      data: { confirmedAt: new Date(), lastUsedAt: new Date(step * TOTP_STEP_SECONDS * 1000) },
    });
    const backupCodes = await this.replaceBackupCodes(db, row.id);

    this.logger.log(`Two-factor authentication enabled: user=${caller.userId} tenant=${caller.tenantId}`);
    void this.notify(caller, "Two-factor authentication turned on", "Two-factor authentication was turned on for your Appsgain account. Signing in now needs a code from your authenticator app.");
    return { backupCodes };
  }

  async disable(caller: Caller, password: string, code: string): Promise<void> {
    await this.requirePassword(caller, password);
    const db = this.db(caller);
    const row = await this.requireEnabled(db, caller);
    if (!(await this.consumeCode(db, row, code))) {
      throw new UnauthorizedException("That code is not valid.");
    }

    await db.twoFactorAuth.delete({ where: { id: row.id } });
    this.logger.log(`Two-factor authentication disabled: user=${caller.userId} tenant=${caller.tenantId}`);
    void this.notify(caller, "Two-factor authentication turned off", "Two-factor authentication was turned off for your Appsgain account. Signing in now needs only your password.");
  }

  /** New backup codes; every earlier one stops working. */
  async regenerateBackupCodes(caller: Caller, password: string, code: string): Promise<{ backupCodes: string[] }> {
    await this.requirePassword(caller, password);
    const db = this.db(caller);
    const row = await this.requireEnabled(db, caller);
    if (!(await this.consumeCode(db, row, code))) {
      throw new UnauthorizedException("That code is not valid.");
    }
    return { backupCodes: await this.replaceBackupCodes(db, row.id) };
  }

  /** Sign-in's second step: a fresh authenticator code, or an unused backup code. */
  async verifyLoginCode(userId: string, tenantId: string, code: string): Promise<boolean> {
    const db = this.prisma.forTenant(tenantId);
    const row = await db.twoFactorAuth.findFirst({ where: { userId, confirmedAt: { not: null } } });
    return row ? this.consumeCode(db, row, code) : false;
  }

  /**
   * Accepts a code at most once.
   *
   * Authenticator codes claim their step with a conditional update, so two requests racing
   * with the same code cannot both win. Backup codes are marked used the same way.
   */
  private async consumeCode(db: TenantScopedClient, row: TwoFactorAuth, code: string): Promise<boolean> {
    const candidate = code.trim();

    if (/^\d{6}$/.test(candidate.replace(/\s/g, ""))) {
      const lastStep = row.lastUsedAt ? totpStep(row.lastUsedAt.getTime()) : null;
      const step = verifyTotp(this.secretOf(row), candidate, { afterStep: lastStep });
      if (step === null) return false;

      const stepStart = new Date(step * TOTP_STEP_SECONDS * 1000);
      const claimed = await db.twoFactorAuth.updateMany({
        where: { id: row.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: stepStart } }] },
        data: { lastUsedAt: stepStart },
      });
      return claimed.count === 1;
    }

    if (!looksLikeBackupCode(candidate)) return false;
    const backup = await db.backupCode.findFirst({
      where: { twoFactorId: row.id, codeHash: hashBackupCode(this.backupKey(), candidate), usedAt: null },
    });
    if (!backup) return false;

    const used = await db.backupCode.updateMany({
      where: { id: backup.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (used.count === 1) {
      this.logger.log(`Backup code used: user=${row.userId}`);
    }
    return used.count === 1;
  }

  private async replaceBackupCodes(db: TenantScopedClient, twoFactorId: string): Promise<string[]> {
    const codes = generateBackupCodes();
    const key = this.backupKey();
    await db.backupCode.deleteMany({ where: { twoFactorId } });
    await db.backupCode.createMany({
      data: codes.map((code) =>
        scopedCreate<Prisma.BackupCodeCreateManyInput>({ twoFactorId, codeHash: hashBackupCode(key, code) }),
      ),
    });
    return codes;
  }

  private async requireEnabled(db: TenantScopedClient, caller: Caller): Promise<TwoFactorAuth> {
    const row = await db.twoFactorAuth.findFirst({ where: { userId: caller.userId } });
    if (!row?.confirmedAt) throw new BadRequestException("Two-factor authentication is not on.");
    return row;
  }

  private async requirePassword(caller: Caller, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: caller.userId },
      include: { tenant: { select: { subdomain: true } } },
    });
    if (!user || user.tenantId !== caller.tenantId || user.status !== "ACTIVE") {
      throw new UnauthorizedException("This account is not active.");
    }
    if (!(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException("Your password is not correct.");
    }
    return user;
  }

  private secretOf(row: TwoFactorAuth): string {
    try {
      return decryptCredentials(row.secretEncrypted);
    } catch {
      throw new ServiceUnavailableException(
        "The two-factor secret could not be decrypted — CREDENTIALS_ENCRYPTION_KEY may have changed.",
      );
    }
  }

  /** Derived from the credentials key, which is meant to be stable for the life of the data. */
  private backupKey(): Buffer {
    return Buffer.from(
      hkdfSync("sha256", this.config.getOrThrow<string>("CREDENTIALS_ENCRYPTION_KEY"), "appsgain.backup-codes", "v1", 32),
    );
  }

  private requireEncryption(): void {
    if (!encryptionAvailable()) {
      throw new ServiceUnavailableException(
        "CREDENTIALS_ENCRYPTION_KEY is not set on the server, so two-factor secrets cannot be stored.",
      );
    }
  }

  private db(caller: Caller): TenantScopedClient {
    return this.prisma.forTenant(caller.tenantId);
  }

  /**
   * Emails a security notice after the response has gone. keepAlive stops Vercel suspending
   * the function between the lookup and the send, and a failure is logged rather than left
   * as an unhandled rejection.
   */
  private notify(caller: Caller, event: string, detail: string): Promise<void> {
    return keepAlive(
      this.sendNotice(caller, event, detail).catch((error: unknown) =>
        this.logger.warn(
          `Could not send the "${event}" notice: ${error instanceof Error ? error.message : "unknown error"}`,
        ),
      ),
    );
  }

  private async sendNotice(caller: Caller, event: string, detail: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: caller.userId },
      select: { email: true, name: true },
    });
    if (user) await this.mail.send({ to: user.email, ...securityNoticeMail({ name: user.name, event, detail }) });
  }
}
