import { Injectable, Logger } from "@nestjs/common";
import type { JwtAccessPayload } from "@appsgain/shared";
import { effectiveScopes, hashApiKey, looksLikeApiKey } from "../api-keys/api-key.util";
import { PrismaService } from "../prisma/prisma.service";
import { isRole } from "./role-sync";

/** Last-used is a courtesy for the key list, not an audit log; once a minute is plenty. */
const LAST_USED_RESOLUTION_MS = 60_000;

/**
 * Turns an `agk_…` key into the same principal a JWT would produce, so every guard and
 * every tenant-scoped query downstream works unchanged.
 *
 * Unlike the JWT strategy, this does read the database on every request, and on purpose:
 * a JWT expires in fifteen minutes by itself, a key does not, so revoking one has to take
 * effect on its next use rather than whenever a token would have run out. The lookup is
 * one indexed read by hash.
 *
 * The principal acts as the person who created the key — actions are attributed to them,
 * and the key stops working if they are disabled — but with `perms` set to the key's
 * scopes cut down to that person's current grants. `perms` replaces role grants entirely
 * in `hasPermission`, so the key can do exactly what it was scoped to and nothing more.
 *
 * Reads through the unscoped PrismaService because, as with a login, the tenant is not
 * known until the key has been resolved.
 */
@Injectable()
export class ApiKeyAuthService {
  private readonly logger = new Logger(ApiKeyAuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async authenticate(raw: string): Promise<(JwtAccessPayload & { apiKeyId: string }) | null> {
    if (!looksLikeApiKey(raw)) return null;

    const key = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(raw) },
      include: {
        createdBy: { select: { id: true, email: true, role: true, status: true, tenantId: true } },
        tenant: { select: { status: true } },
      },
    });

    if (!key || key.revokedAt) return null;
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) return null;
    if (key.tenant.status === "SUSPENDED" || key.tenant.status === "CANCELLED") return null;

    const creator = key.createdBy;
    if (!creator || creator.status !== "ACTIVE" || creator.tenantId !== key.tenantId) return null;
    if (!isRole(creator.role)) return null;

    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
      void this.prisma.apiKey
        .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
        .catch((error: unknown) =>
          this.logger.warn(
            `Could not record API key use: ${error instanceof Error ? error.message : "unknown error"}`,
          ),
        );
    }

    return {
      sub: creator.id,
      tenantId: key.tenantId,
      role: creator.role,
      email: creator.email,
      perms: effectiveScopes(key.scopes, creator.role),
      apiKeyId: key.id,
    };
  }
}
