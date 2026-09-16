import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, type Integration, type IntegrationCategory, type IntegrationStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import { scopedCreate } from "../prisma/tenant-scoped";
import { decryptCredentials, encryptCredentials, encryptionAvailable } from "../providers/crypto.util";
import {
  CATEGORY_ORDER,
  INTEGRATION_CATALOG,
  catalogEntry,
  type CatalogEntry,
} from "./catalog";
import type { ConnectIntegrationDto, IntegrationSettingsDto } from "./dto/integrations.dto";
import {
  PLATFORM_EVENTS,
  PLATFORM_EVENT_KEYS,
  TEST_EVENT,
  isPlatformEvent,
  type EventEnvelope,
} from "./events/event-types";
import { appUrl } from "./events/payloads";
import {
  previewCredentials,
  readSettings,
  writeSettings,
  type IntegrationSettings,
} from "./integration-settings";
import { OAuthService } from "./oauth.service";
import { checkOutboundUrl } from "./vendors/http";
import { VERIFIERS, type VerifyResult } from "./vendors/verifiers";
import { generateWebhookSecret } from "./webhooks/signing";
import { WebhookDeliveryService } from "./webhooks/webhook-delivery.service";

export interface IntegrationConnectionView {
  status: IntegrationStatus;
  /** A non-secret label for the connected account. */
  account: string | null;
  /** False when the vendor offers no check and the credentials were only stored. */
  verified: boolean;
  connectedAt: string;
  lastVerifiedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  events: string[];
  syncLeads: boolean | null;
  syncCalendar: boolean | null;
  /** Field key → display value. Secrets are reduced to their last four characters. */
  preview: Record<string, string>;
}

export type IntegrationView = Omit<CatalogEntry, "allowedHosts" | "oauthEnv"> & {
  oauthEnv: { clientId: string; clientSecret: string } | null;
  /** For OAuth providers: whether the operator has configured the OAuth app. */
  oauthReady: boolean | null;
  connection: IntegrationConnectionView | null;
};

export interface IntegrationsOverview {
  encryptionReady: boolean;
  oauthRedirectUri: string;
  categories: IntegrationCategory[];
  events: { key: string; label: string; description: string }[];
  items: IntegrationView[];
}

type Check = { ok: true; account?: string; verified: boolean } | { ok: false; reason: string };

/** What a newly connected event receiver gets when nobody picked: the events worth interrupting for. */
const DEFAULT_EVENTS: Record<string, string[]> = {
  COMMUNICATION: ["lead.created", "call.completed", "credits.low_balance"],
  AUTOMATION: ["lead.created", "lead.status_changed", "call.completed"],
  ANALYTICS: PLATFORM_EVENT_KEYS,
};

/**
 * Feature List §14 — Settings → Integrations: connecting, checking and disconnecting every
 * third party in the catalogue.
 *
 * The rule for storing anything: credentials are checked with the vendor first, and only
 * credentials that work are kept — encrypted, with a preview that shows the last four
 * characters and no more. The two exceptions say so on screen: OAuth providers are checked
 * by the sign-in itself, and the one vendor with no read-only endpoint is stored and
 * labelled unverified.
 */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaFactory,
    private readonly deliveries: WebhookDeliveryService,
    private readonly oauth: OAuthService,
  ) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  async overview(): Promise<IntegrationsOverview> {
    const rows = await this.db.integration.findMany();
    return {
      encryptionReady: encryptionAvailable(),
      oauthRedirectUri: this.oauth.redirectUri(),
      categories: CATEGORY_ORDER,
      events: PLATFORM_EVENTS.map((event) => ({ ...event })),
      items: INTEGRATION_CATALOG.map((entry) =>
        this.view(entry, rows.find((row) => row.provider === entry.provider) ?? null),
      ),
    };
  }

  async connect(provider: string, dto: ConnectIntegrationDto): Promise<IntegrationView> {
    const entry = this.entry(provider);
    if (entry.auth === "oauth") {
      throw new BadRequestException(`${entry.name} connects by signing in, not with pasted keys.`);
    }
    this.requireEncryption();

    const credentials = this.validateCredentials(entry, dto.credentials ?? {});
    if (entry.auth === "webhook_url") {
      const check = await checkOutboundUrl(credentials.webhookUrl, { allowedHosts: entry.allowedHosts });
      if (!check.ok) throw new BadRequestException(check.reason);
      credentials.webhookUrl = check.url.toString();
    }

    const existing = await this.db.integration.findFirst({ where: { provider } });
    const settings = this.nextSettings(entry, readSettings(existing?.settings), dto.settings);

    if (entry.category === "AUTOMATION") {
      return this.connectAutomation(entry, existing, credentials, settings);
    }

    const verifier = VERIFIERS[provider];
    const result: VerifyResult = verifier
      ? await verifier(credentials)
      : { ok: true, verified: false };
    if (!result.ok) throw new BadRequestException(result.reason);

    const stored = result.credentials ?? credentials;
    const row = await this.save(entry, existing, {
      credentialsEncrypted: encryptCredentials(JSON.stringify(stored)),
      settings: {
        ...settings,
        account: result.account ?? null,
        verified: result.verified,
        lastVerifiedAt: new Date().toISOString(),
        preview: previewCredentials(entry, stored),
      },
    });

    const { tenantId, userId } = this.tenantPrisma.context;
    this.logger.log(`Integration connected: ${provider} tenant=${tenantId} by=${userId}`);
    return this.view(entry, row);
  }

  /** Changes the switches — events, lead sync, calendar sync — without touching credentials. */
  async update(provider: string, dto: IntegrationSettingsDto): Promise<IntegrationView> {
    const entry = this.entry(provider);
    const row = await this.connected(entry);
    const previous = readSettings(row.settings);
    const settings = this.nextSettings(entry, previous, dto);

    if (entry.category === "AUTOMATION" && dto.events !== undefined) {
      if ((settings.events ?? []).length === 0) {
        throw new BadRequestException("Pick at least one event to send.");
      }
      if (previous.webhookId) {
        await this.db.webhook.updateMany({
          where: { id: previous.webhookId },
          data: { events: settings.events },
        });
      }
    }

    const updated = await this.db.integration.update({
      where: { id: row.id },
      data: { settings: writeSettings(settings) },
    });
    return this.view(entry, updated);
  }

  /**
   * Checks a connection again, now. For chat and automation that means sending a test;
   * for everything else, the same read-only check connecting ran.
   */
  async test(provider: string): Promise<IntegrationView> {
    const entry = this.entry(provider);
    const row = await this.connected(entry);
    const previous = readSettings(row.settings);
    const { tenantId } = this.tenantPrisma.context;

    let check: Check;
    if (entry.auth === "oauth") {
      const token = await this.oauth.accessToken(tenantId, row);
      if (!token.ok) {
        check = { ok: false, reason: token.reason };
      } else {
        const identity = await this.oauth.identify(provider, token.credentials);
        check = identity.ok ? { ok: true, account: identity.account, verified: true } : identity;
      }
    } else if (entry.category === "AUTOMATION") {
      if (!previous.webhookId) {
        check = { ok: false, reason: "The webhook behind this integration is missing. Connect again." };
      } else {
        const delivery = await this.deliveries.enqueue(
          tenantId,
          previous.webhookId,
          this.testEnvelope(entry),
          { retry: false },
        );
        const attempted = await this.deliveries.attempt(tenantId, delivery.id, { retry: false });
        check =
          attempted?.status === "SUCCEEDED"
            ? { ok: true, account: "Test event delivered", verified: true }
            : { ok: false, reason: attempted?.error ?? "The test event was not delivered." };
      }
    } else {
      const credentials = this.decrypt(row);
      const verifier = VERIFIERS[provider];
      if (!credentials) {
        check = { ok: false, reason: "The stored credentials could not be decrypted. Connect again." };
      } else if (!verifier) {
        check = { ok: true, verified: false, account: previous.account ?? undefined };
      } else {
        const result = await verifier(credentials);
        check = result.ok
          ? { ok: true, account: result.account, verified: result.verified }
          : { ok: false, reason: result.reason };
      }
    }

    let data: Prisma.IntegrationUpdateInput;
    if (check.ok) {
      data = {
        status: "CONNECTED",
        lastError: null,
        settings: writeSettings({
          ...previous,
          account: check.account ?? previous.account ?? null,
          verified: check.verified,
          lastVerifiedAt: new Date().toISOString(),
        }),
      };
    } else {
      // Re-read: refreshing an OAuth token may have just marked the row EXPIRED, which is
      // the more useful thing to show than a generic error.
      const latest = await this.db.integration.findFirst({
        where: { id: row.id },
        select: { status: true },
      });
      data = {
        status: latest?.status === "EXPIRED" ? "EXPIRED" : "ERROR",
        lastError: check.reason.slice(0, 500),
      };
    }

    const updated = await this.db.integration.update({ where: { id: row.id }, data });
    return this.view(entry, updated);
  }

  async disconnect(provider: string): Promise<void> {
    const entry = this.entry(provider);
    const row = await this.db.integration.findFirst({ where: { provider } });
    if (!row) return;

    const webhookId = readSettings(row.settings).webhookId;
    if (entry.category === "AUTOMATION" && webhookId) {
      await this.db.webhook.deleteMany({ where: { id: webhookId } });
    }
    await this.db.integration.delete({ where: { id: row.id } });

    const { tenantId, userId } = this.tenantPrisma.context;
    this.logger.log(`Integration disconnected: ${provider} tenant=${tenantId} by=${userId}`);
  }

  startOAuth(provider: string): { url: string } {
    const entry = this.entry(provider);
    if (entry.auth !== "oauth" || !this.oauth.supports(provider)) {
      throw new BadRequestException(`${entry.name} does not connect by signing in.`);
    }
    if (!this.oauth.isConfigured(provider)) {
      throw new BadRequestException(
        `${entry.name} sign-in needs an OAuth app registered by whoever runs this server: set ` +
          `${entry.oauthEnv?.clientId} and ${entry.oauthEnv?.clientSecret}, with ` +
          `${this.oauth.redirectUri()} as the redirect URI.`,
      );
    }
    this.requireEncryption();

    const { tenantId, userId } = this.tenantPrisma.context;
    return { url: this.oauth.authorizationUrl(provider, { tenantId, userId }) };
  }

  // ── internals ─────────────────────────────────────────────────────────────────────

  private async connectAutomation(
    entry: CatalogEntry,
    existing: Integration | null,
    credentials: Record<string, string>,
    settings: IntegrationSettings,
  ): Promise<IntegrationView> {
    const events = settings.events ?? [];
    if (events.length === 0) throw new BadRequestException("Pick at least one event to send.");

    // Tested before anything is saved, with the secret the endpoint will keep: a Zap that
    // cannot be reached should fail here, not after the first real lead.
    const secret = generateWebhookSecret();
    const sent = await this.deliveries.send(
      credentials.webhookUrl,
      secret,
      this.testEnvelope(entry),
      TEST_EVENT,
      `dlv_test_${randomUUID()}`,
    );
    if (!sent.ok) {
      throw new BadRequestException(`${entry.name} did not accept the test event: ${sent.error}`);
    }

    const previous = readSettings(existing?.settings);
    const hook = previous.webhookId
      ? await this.db.webhook.findFirst({ where: { id: previous.webhookId } })
      : null;
    const webhookData = {
      url: credentials.webhookUrl,
      secretEncrypted: encryptCredentials(secret),
      events,
      isActive: true,
      description: `Managed by ${entry.name}`,
    };
    const saved = hook
      ? await this.db.webhook.update({ where: { id: hook.id }, data: webhookData })
      : await this.db.webhook.create({
          data: scopedCreate<Prisma.WebhookUncheckedCreateInput>(webhookData),
        });

    const row = await this.save(entry, existing, {
      credentialsEncrypted: encryptCredentials(JSON.stringify(credentials)),
      settings: {
        ...settings,
        webhookId: saved.id,
        account: "Test event delivered",
        verified: true,
        lastVerifiedAt: new Date().toISOString(),
        preview: previewCredentials(entry, credentials),
      },
    });

    const { tenantId, userId } = this.tenantPrisma.context;
    this.logger.log(`Integration connected: ${entry.provider} tenant=${tenantId} by=${userId}`);
    return this.view(entry, row);
  }

  /**
   * A test event carrying a sample lead, so an automation platform has every field it
   * will later receive available to map from the moment the connection is made.
   */
  private testEnvelope(entry: CatalogEntry): EventEnvelope {
    const { tenantId } = this.tenantPrisma.context;
    return {
      id: `evt_${randomUUID()}`,
      event: TEST_EVENT,
      createdAt: new Date().toISOString(),
      workspaceId: tenantId,
      data: {
        message: `Appsgain is connected to ${entry.name}. Real events arrive in this shape.`,
        lead: {
          id: "00000000-0000-0000-0000-000000000000",
          name: "Sample Lead",
          phone: "+919800000000",
          city: "Mumbai",
          source: "UPLOAD",
          status: "NEW",
          score: 50,
          createdAt: new Date().toISOString(),
          url: appUrl("/leads"),
        },
      },
    };
  }

  private async save(
    entry: CatalogEntry,
    existing: Integration | null,
    input: { credentialsEncrypted: string; settings: IntegrationSettings },
  ): Promise<Integration> {
    const { userId } = this.tenantPrisma.context;
    const data = {
      category: entry.category,
      status: "CONNECTED" as const,
      credentialsEncrypted: input.credentialsEncrypted,
      settings: writeSettings(input.settings),
      lastError: null,
      tokenExpiresAt: null,
      connectedById: userId,
    };

    return existing
      ? this.db.integration.update({ where: { id: existing.id }, data })
      : this.db.integration.create({
          data: scopedCreate<Prisma.IntegrationUncheckedCreateInput>({
            provider: entry.provider,
            ...data,
          }),
        });
  }

  private nextSettings(
    entry: CatalogEntry,
    previous: IntegrationSettings,
    input: IntegrationSettingsDto | undefined,
  ): IntegrationSettings {
    const next: IntegrationSettings = { ...previous };

    if (entry.features.includes("events")) {
      const chosen = input?.events?.filter(isPlatformEvent);
      next.events = chosen
        ? Array.from(new Set(chosen))
        : (previous.events ?? DEFAULT_EVENTS[entry.category] ?? []);
    }
    if (entry.features.includes("lead_sync")) {
      next.syncLeads = input?.syncLeads ?? previous.syncLeads ?? true;
    }
    if (entry.features.includes("calendar_sync")) {
      next.syncCalendar = input?.syncCalendar ?? previous.syncCalendar ?? true;
    }
    return next;
  }

  /** Trims, requires, checks choices and formats. Every problem is reported at once. */
  private validateCredentials(
    entry: CatalogEntry,
    raw: Record<string, unknown>,
  ): Record<string, string> {
    const credentials: Record<string, string> = {};
    const problems: string[] = [];

    for (const field of entry.fields) {
      const value = raw[field.key];
      if (value !== undefined && value !== null && typeof value !== "string") {
        problems.push(`${field.label} must be text.`);
        continue;
      }

      const trimmed = typeof value === "string" ? value.trim() : "";
      if (!trimmed) {
        if (!field.optional) problems.push(`${field.label} is required.`);
        continue;
      }
      if (trimmed.length > 4096) {
        problems.push(`${field.label} is too long.`);
        continue;
      }
      if (field.options && !field.options.some((option) => option.value === trimmed)) {
        problems.push(`Pick a valid ${field.label.toLowerCase()}.`);
        continue;
      }
      if (field.pattern && !new RegExp(field.pattern).test(trimmed)) {
        problems.push(field.patternMessage ?? `${field.label} is not in the expected format.`);
        continue;
      }
      credentials[field.key] = trimmed;
    }

    if (problems.length > 0) throw new BadRequestException(problems);
    return credentials;
  }

  private entry(provider: string): CatalogEntry {
    const entry = catalogEntry(provider);
    if (!entry) throw new NotFoundException(`There is no integration called "${provider}".`);
    return entry;
  }

  private async connected(entry: CatalogEntry): Promise<Integration> {
    const row = await this.db.integration.findFirst({ where: { provider: entry.provider } });
    if (!row) throw new NotFoundException(`${entry.name} is not connected.`);
    return row;
  }

  private decrypt(row: Integration): Record<string, string> | null {
    if (!row.credentialsEncrypted) return null;
    try {
      return JSON.parse(decryptCredentials(row.credentialsEncrypted)) as Record<string, string>;
    } catch {
      return null;
    }
  }

  private requireEncryption(): void {
    if (!encryptionAvailable()) {
      throw new ServiceUnavailableException(
        "CREDENTIALS_ENCRYPTION_KEY is not set on the server, so credentials cannot be stored.",
      );
    }
  }

  private view(entry: CatalogEntry, row: Integration | null): IntegrationView {
    const { allowedHosts: _allowedHosts, oauthEnv, ...rest } = entry;
    const settings = readSettings(row?.settings);

    return {
      ...rest,
      oauthEnv: oauthEnv ?? null,
      oauthReady: entry.auth === "oauth" ? this.oauth.isConfigured(entry.provider) : null,
      connection: row
        ? {
            status: row.status,
            account: settings.account ?? null,
            verified: settings.verified ?? false,
            connectedAt: row.createdAt.toISOString(),
            lastVerifiedAt: settings.lastVerifiedAt ?? null,
            lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
            lastError: row.lastError,
            events: settings.events ?? [],
            syncLeads: entry.features.includes("lead_sync") ? settings.syncLeads !== false : null,
            syncCalendar: entry.features.includes("calendar_sync")
              ? settings.syncCalendar !== false
              : null,
            preview: settings.preview ?? {},
          }
        : null,
    };
  }
}
