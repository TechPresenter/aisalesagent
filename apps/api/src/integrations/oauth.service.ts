import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type Integration } from "@prisma/client";
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { hasPermission } from "@appsgain/shared";
import { isRole } from "../auth/role-sync";
import { PrismaService } from "../prisma/prisma.service";
import { scopedCreate } from "../prisma/tenant-scoped";
import { decryptCredentials, encryptCredentials } from "../providers/crypto.util";
import { catalogEntry } from "./catalog";
import { readSettings, writeSettings } from "./integration-settings";
import { isSalesforceInstance } from "./vendors/crm";
import { dig, text, vendorFetch, vendorMessage, type VendorResponse } from "./vendors/http";

interface OAuthSpec {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  extraParams: Record<string, string>;
}

/**
 * TRD §8 — `POST /integrations/{provider}/connect`, the OAuth flow for CRM and calendar.
 *
 * Offline access is requested everywhere, because every use of these tokens happens with
 * nobody signed in: a lead arriving at 3am still has to reach Salesforce.
 */
const OAUTH_SPECS: Record<string, OAuthSpec> = {
  google_calendar: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/calendar.events"],
    // `prompt=consent` makes Google issue a refresh token on every connect, not only the first.
    extraParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
  microsoft_outlook: {
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["offline_access", "User.Read", "Calendars.ReadWrite"],
    extraParams: { response_mode: "query" },
  },
  salesforce: {
    authorizeUrl: "https://login.salesforce.com/services/oauth2/authorize",
    tokenUrl: "https://login.salesforce.com/services/oauth2/token",
    scopes: ["api", "refresh_token"],
    extraParams: {},
  },
};

/** Long enough to find the right Google account; short enough that a leaked link is stale. */
const STATE_TTL_MS = 10 * 60_000;

interface StateClaims {
  tenantId: string;
  userId: string;
  provider: string;
  nonce: string;
  expiresAt: number;
}

export interface OAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  instanceUrl?: string;
}

type Exchange =
  | { ok: true; credentials: OAuthCredentials; expiresAt: Date }
  | { ok: false; reason: string; invalidGrant?: boolean };

export type OAuthOutcome = { ok: true; provider: string } | { ok: false; message: string };

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  supports(provider: string): boolean {
    return provider in OAUTH_SPECS;
  }

  /** True when the platform operator has registered an OAuth app for this provider. */
  isConfigured(provider: string): boolean {
    const env = catalogEntry(provider)?.oauthEnv;
    return Boolean(
      env && this.supports(provider) && this.config.get(env.clientId) && this.config.get(env.clientSecret),
    );
  }

  /** The callback URL to register with each vendor. Shown in Settings for that reason. */
  redirectUri(): string {
    const base =
      this.config.get<string>("API_PUBLIC_URL")?.trim() ||
      `http://localhost:${this.config.get<string>("API_PORT") ?? "4000"}`;
    return `${base.replace(/\/+$/, "")}/api/integrations/oauth/callback`;
  }

  authorizationUrl(provider: string, context: { tenantId: string; userId: string }): string {
    const spec = OAUTH_SPECS[provider];
    const env = catalogEntry(provider)?.oauthEnv;
    if (!spec || !env) throw new Error(`${provider} does not connect with OAuth`);

    const state = this.signState({
      tenantId: context.tenantId,
      userId: context.userId,
      provider,
      nonce: randomBytes(12).toString("base64url"),
      expiresAt: Date.now() + STATE_TTL_MS,
    });

    const params = new URLSearchParams({
      client_id: this.config.getOrThrow<string>(env.clientId),
      redirect_uri: this.redirectUri(),
      response_type: "code",
      scope: spec.scopes.join(" "),
      state,
      ...spec.extraParams,
    });
    return `${spec.authorizeUrl}?${params.toString()}`;
  }

  /**
   * Finishes a sign-in the vendor redirected back from.
   *
   * Runs on a public route — the browser arrives from Google, not from our app, and brings
   * no bearer token — so everything it trusts comes from the signed state: which
   * workspace, which person, which provider. The person is then re-checked, because ten
   * minutes is long enough to be removed from a workspace.
   */
  async complete(query: Record<string, unknown>): Promise<OAuthOutcome> {
    const claims = this.verifyState(typeof query.state === "string" ? query.state : "");
    if (!claims) {
      return { ok: false, message: "That sign-in link expired or was altered. Start again from Settings." };
    }

    const entry = catalogEntry(claims.provider);
    const name = entry?.name ?? claims.provider;

    if (typeof query.error === "string") {
      return {
        ok: false,
        message:
          query.error === "access_denied"
            ? `${name} sign-in was cancelled.`
            : `${name} refused the sign-in: ${text(query.error_description) ?? query.error}`,
      };
    }
    if (typeof query.code !== "string" || !query.code) {
      return { ok: false, message: `${name} did not return an authorisation code.` };
    }
    if (!entry || !this.isConfigured(claims.provider)) {
      return { ok: false, message: `${name} sign-in is not configured on this server.` };
    }

    const db = this.prisma.forTenant(claims.tenantId);
    const user = await db.user.findFirst({
      where: { id: claims.userId, status: "ACTIVE" },
      select: { id: true, role: true },
    });
    if (!user || !isRole(user.role) || !hasPermission(user.role, "integrations.manage")) {
      return { ok: false, message: "You no longer have permission to manage integrations." };
    }

    const exchanged = await this.exchange(claims.provider, {
      grant_type: "authorization_code",
      code: query.code,
      redirect_uri: this.redirectUri(),
    });
    if (!exchanged.ok) return { ok: false, message: exchanged.reason };

    const identity = await this.identify(claims.provider, exchanged.credentials);
    if (!identity.ok) return { ok: false, message: identity.reason };

    const existing = await db.integration.findFirst({ where: { provider: claims.provider } });
    const previous = readSettings(existing?.settings);
    const settings = writeSettings({
      ...previous,
      account: identity.account ?? null,
      verified: true,
      lastVerifiedAt: new Date().toISOString(),
      // Connecting a CRM or a calendar is asking for it to sync; the switch is still there.
      ...(entry.features.includes("lead_sync") ? { syncLeads: previous.syncLeads ?? true } : {}),
      ...(entry.features.includes("calendar_sync")
        ? { syncCalendar: previous.syncCalendar ?? true }
        : {}),
      preview: identity.account ? { account: identity.account } : {},
    });

    const data = {
      category: entry.category,
      status: "CONNECTED" as const,
      credentialsEncrypted: encryptCredentials(JSON.stringify(exchanged.credentials)),
      tokenExpiresAt: exchanged.expiresAt,
      settings,
      lastError: null,
      connectedById: user.id,
    };

    if (existing) {
      await db.integration.update({ where: { id: existing.id }, data });
    } else {
      await db.integration.create({
        data: scopedCreate<Prisma.IntegrationUncheckedCreateInput>({ provider: claims.provider, ...data }),
      });
    }

    this.logger.log(
      `Integration connected with OAuth: ${claims.provider} tenant=${claims.tenantId} by=${user.id}`,
    );
    return { ok: true, provider: claims.provider };
  }

  /**
   * A usable access token for a connected OAuth integration, refreshed when it is within
   * two minutes of expiring. A refresh the vendor refuses marks the integration EXPIRED,
   * which is what tells Settings to ask for sign-in again.
   */
  async accessToken(
    tenantId: string,
    integration: Integration,
  ): Promise<{ ok: true; credentials: OAuthCredentials } | { ok: false; reason: string }> {
    let credentials: OAuthCredentials | null = null;
    try {
      credentials = integration.credentialsEncrypted
        ? (JSON.parse(decryptCredentials(integration.credentialsEncrypted)) as OAuthCredentials)
        : null;
    } catch {
      credentials = null;
    }
    if (!credentials?.accessToken) {
      return { ok: false, reason: "No usable token is stored. Connect again." };
    }

    const expiresAt = integration.tokenExpiresAt?.getTime() ?? 0;
    if (expiresAt - Date.now() > 120_000) return { ok: true, credentials };

    const db = this.prisma.forTenant(tenantId);
    if (!credentials.refreshToken) {
      await db.integration.update({
        where: { id: integration.id },
        data: { status: "EXPIRED", lastError: "The sign-in expired and cannot be renewed. Connect again." },
      });
      return { ok: false, reason: "The sign-in expired. Connect again." };
    }

    const refreshed = await this.exchange(integration.provider, {
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
    });

    if (!refreshed.ok) {
      if (refreshed.invalidGrant) {
        await db.integration.update({
          where: { id: integration.id },
          data: { status: "EXPIRED", lastError: `${refreshed.reason} Connect again.` },
        });
      }
      return { ok: false, reason: refreshed.reason };
    }

    const next: OAuthCredentials = {
      ...credentials,
      ...refreshed.credentials,
      // Most vendors do not send a new refresh token on refresh; keep the one that works.
      refreshToken: refreshed.credentials.refreshToken ?? credentials.refreshToken,
      instanceUrl: refreshed.credentials.instanceUrl ?? credentials.instanceUrl,
    };
    await db.integration.update({
      where: { id: integration.id },
      data: {
        credentialsEncrypted: encryptCredentials(JSON.stringify(next)),
        tokenExpiresAt: refreshed.expiresAt,
      },
    });
    return { ok: true, credentials: next };
  }

  /** Checks a token works for what it will be used for, and finds a label for the account. */
  async identify(
    provider: string,
    credentials: OAuthCredentials,
  ): Promise<{ ok: true; account?: string } | { ok: false; reason: string }> {
    const headers = { Authorization: `Bearer ${credentials.accessToken}` };

    switch (provider) {
      case "google_calendar": {
        const calendars = await vendorFetch(
          "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1",
          { headers },
        );
        if (!calendars.ok) return this.refusal("Google Calendar", calendars);
        const profile = await vendorFetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers });
        return { ok: true, account: text(dig(profile.body, "email")) };
      }
      case "microsoft_outlook": {
        const calendars = await vendorFetch("https://graph.microsoft.com/v1.0/me/calendars?$top=1", {
          headers,
        });
        if (!calendars.ok) return this.refusal("Outlook", calendars);
        const profile = await vendorFetch(
          "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName",
          { headers },
        );
        return {
          ok: true,
          account: text(dig(profile.body, "mail")) ?? text(dig(profile.body, "userPrincipalName")),
        };
      }
      case "salesforce": {
        if (!isSalesforceInstance(credentials.instanceUrl)) {
          return { ok: false, reason: "Salesforce returned an instance URL that is not Salesforce's." };
        }
        const origin = new URL(credentials.instanceUrl).origin;
        const profile = await vendorFetch(`${origin}/services/oauth2/userinfo`, { headers });
        if (!profile.ok) return this.refusal("Salesforce", profile);
        return { ok: true, account: text(dig(profile.body, "email")) };
      }
      default:
        return { ok: false, reason: `${provider} does not connect with OAuth.` };
    }
  }

  private refusal(vendor: string, response: VendorResponse) {
    if (response.status === 0) {
      return { ok: false as const, reason: `Could not reach ${vendor}: ${response.error}.` };
    }
    const message = vendorMessage(response);
    return {
      ok: false as const,
      reason: `${vendor} refused access (HTTP ${response.status}${message ? `: ${message}` : ""}).`,
    };
  }

  private async exchange(provider: string, params: Record<string, string>): Promise<Exchange> {
    const spec = OAUTH_SPECS[provider];
    const env = catalogEntry(provider)?.oauthEnv;
    if (!spec || !env || !this.isConfigured(provider)) {
      return { ok: false, reason: `${provider} sign-in is not configured on this server.` };
    }

    const body = new URLSearchParams({
      ...params,
      client_id: this.config.getOrThrow<string>(env.clientId),
      client_secret: this.config.getOrThrow<string>(env.clientSecret),
    });

    const response = await vendorFetch(spec.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });

    const vendor = catalogEntry(provider)?.name ?? provider;
    if (response.status === 0) {
      return { ok: false, reason: `Could not reach ${vendor}: ${response.error}.` };
    }

    const accessToken = text(dig(response.body, "access_token"));
    if (!response.ok || !accessToken) {
      const error = text(dig(response.body, "error"));
      const description = text(dig(response.body, "error_description"));
      return {
        ok: false,
        invalidGrant: error === "invalid_grant",
        reason: `${vendor} refused the token request${description ? `: ${description}` : error ? ` (${error})` : "."}`,
      };
    }

    const expiresIn = Number(dig(response.body, "expires_in"));
    return {
      ok: true,
      credentials: {
        accessToken,
        refreshToken: text(dig(response.body, "refresh_token")),
        instanceUrl: text(dig(response.body, "instance_url")),
      },
      // Salesforce sends no expiry; an hour is inside every org's session timeout.
      expiresAt: new Date(Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000),
    };
  }

  // ── state ─────────────────────────────────────────────────────────────────────────

  /** Derived from the access-token secret, so no extra secret has to be configured. */
  private stateKey(): Buffer {
    return Buffer.from(
      hkdfSync(
        "sha256",
        this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
        "appsgain.oauth-state",
        "v1",
        32,
      ),
    );
  }

  private signState(claims: StateClaims): string {
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createHmac("sha256", this.stateKey()).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  private verifyState(state: string): StateClaims | null {
    const [payload, signature] = state.split(".");
    if (!payload || !signature) return null;

    const expected = Buffer.from(createHmac("sha256", this.stateKey()).update(payload).digest("base64url"));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

    try {
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as StateClaims;
      if (typeof claims.expiresAt !== "number" || claims.expiresAt < Date.now()) return null;
      if (!claims.tenantId || !claims.userId || !this.supports(claims.provider)) return null;
      return claims;
    } catch {
      return null;
    }
  }
}
