import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type ApiKey } from "@prisma/client";
import { hasPermission } from "@appsgain/shared";
import { isRole } from "../auth/role-sync";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import { scopedCreate } from "../prisma/tenant-scoped";
import {
  API_KEY_SCOPES,
  SCOPE_LABEL,
  generateApiKey,
  grantableScopes,
  type ApiKeyScope,
} from "./api-key.util";
import type { CreateApiKeyDto } from "./dto/api-key.dto";

/** Enough for every system a workspace connects; a bound on what a sweep of leaks must cover. */
const MAX_ACTIVE_KEYS = 25;

const DAY_MS = 24 * 3_600_000;

export interface ApiKeyView {
  id: string;
  name: string;
  /** The first eight characters — enough to recognise a key, not to use it. */
  prefix: string;
  scopes: string[];
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface ScopeView {
  key: ApiKeyScope;
  label: string;
  /** False when the caller's own role does not hold it, so they cannot give it to a key. */
  grantable: boolean;
}

type ApiKeyRow = ApiKey & { createdBy: { id: string; name: string } | null };

/**
 * Settings → Integrations → API keys: creating, listing and revoking the keys the public
 * REST API authenticates with (see ApiKeyAuthService for the other half).
 */
@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(private readonly tenantPrisma: TenantPrismaFactory) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  async list(): Promise<{ keys: ApiKeyView[]; scopes: ScopeView[] }> {
    const rows = await this.db.apiKey.findMany({
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    return { keys: rows.map(toView), scopes: this.scopes() };
  }

  /** Returns the key itself exactly once. It cannot be shown again: only its hash is kept. */
  async create(dto: CreateApiKeyDto): Promise<{ key: ApiKeyView; secret: string }> {
    const { tenantId, userId, role } = this.tenantPrisma.context;
    if (!isRole(role)) throw new ForbiddenException("Your role cannot create API keys.");

    const grantable: string[] = grantableScopes(role);
    const requested = Array.from(new Set(dto.scopes));
    const refused = requested.filter((scope) => !grantable.includes(scope));
    if (refused.length > 0) {
      throw new BadRequestException(
        `A key cannot be given access your own role does not have: ${refused.join(", ")}.`,
      );
    }

    const active = await this.db.apiKey.count({
      where: {
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (active >= MAX_ACTIVE_KEYS) {
      throw new BadRequestException(
        `A workspace can have up to ${MAX_ACTIVE_KEYS} active keys. Revoke one you no longer use.`,
      );
    }

    const generated = generateApiKey();
    const row = await this.db.apiKey.create({
      data: scopedCreate<Prisma.ApiKeyUncheckedCreateInput>({
        name: dto.name.trim(),
        keyHash: generated.hash,
        keyPrefix: generated.prefix,
        scopes: requested,
        createdById: userId,
        expiresAt: dto.expiresInDays ? new Date(Date.now() + dto.expiresInDays * DAY_MS) : null,
      }),
      include: { createdBy: { select: { id: true, name: true } } },
    });

    this.logger.log(
      `API key created: id=${row.id} prefix=${row.keyPrefix} tenant=${tenantId} by=${userId} ` +
        `scopes=${requested.join(",")}`,
    );
    return { key: toView(row), secret: generated.key };
  }

  /** Takes effect on the key's very next request: authentication reads the row every time. */
  async revoke(id: string): Promise<void> {
    const row = await this.db.apiKey.findFirst({ where: { id } });
    if (!row) throw new NotFoundException("API key not found");
    if (row.revokedAt) return;

    await this.db.apiKey.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    const { tenantId, userId } = this.tenantPrisma.context;
    this.logger.log(`API key revoked: id=${row.id} tenant=${tenantId} by=${userId}`);
  }

  private scopes(): ScopeView[] {
    const { role } = this.tenantPrisma.context;
    return API_KEY_SCOPES.map((scope) => ({
      key: scope,
      label: SCOPE_LABEL[scope],
      grantable: isRole(role) && hasPermission(role, scope),
    }));
  }
}

function toView(row: ApiKeyRow): ApiKeyView {
  const expired = row.expiresAt !== null && row.expiresAt.getTime() <= Date.now();
  return {
    id: row.id,
    name: row.name,
    prefix: row.keyPrefix,
    scopes: row.scopes,
    status: row.revokedAt ? "REVOKED" : expired ? "EXPIRED" : "ACTIVE",
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
