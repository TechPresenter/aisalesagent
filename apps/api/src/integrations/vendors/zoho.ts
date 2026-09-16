import { createHash } from "node:crypto";
import { dig, text, vendorFetch } from "./http";

/**
 * Zoho's token dance, shared by the verifier and the lead push.
 *
 * Zoho has no long-lived API keys. A Self Client hands out a grant code that lives for
 * minutes; exchanging it once yields a refresh token that lives until revoked, and each
 * refresh token buys an access token good for an hour. So the grant code is exchanged at
 * connect time and never stored, the refresh token is stored encrypted, and access tokens
 * are cached here in memory — asking Zoho for a fresh one on every lead would run into
 * its limit on token requests quickly.
 */

const DATA_CENTRES = new Set(["in", "com", "eu", "com.au", "jp"]);

interface CachedToken {
  accessToken: string;
  apiDomain: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();

export type ZohoToken =
  | { ok: true; accessToken: string; apiDomain: string; refreshToken: string }
  | { ok: false; reason: string };

export async function zohoAccessToken(credentials: Record<string, string>): Promise<ZohoToken> {
  const dataCentre = credentials.dataCenter;
  if (!DATA_CENTRES.has(dataCentre)) {
    return { ok: false, reason: "Pick the Zoho data centre your account is on." };
  }

  const usingGrant = !credentials.refreshToken && Boolean(credentials.grantCode);
  const cacheKey = createHash("sha256")
    .update(`${credentials.clientId}:${credentials.refreshToken ?? ""}`)
    .digest("hex");

  if (!usingGrant) {
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        ok: true,
        accessToken: cached.accessToken,
        apiDomain: cached.apiDomain,
        refreshToken: credentials.refreshToken,
      };
    }
  }

  const form = new URLSearchParams(
    usingGrant
      ? {
          grant_type: "authorization_code",
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          code: credentials.grantCode,
        }
      : {
          grant_type: "refresh_token",
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          refresh_token: credentials.refreshToken ?? "",
        },
  );

  const response = await vendorFetch(`https://accounts.zoho.${dataCentre}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  if (response.status === 0) {
    return { ok: false, reason: `Could not reach Zoho: ${response.error}.` };
  }

  // Zoho reports most token errors with HTTP 200 and an `error` field.
  const error = text(dig(response.body, "error"));
  const accessToken = text(dig(response.body, "access_token"));
  if (error || !accessToken) {
    return { ok: false, reason: describeTokenError(error, usingGrant) };
  }

  const refreshToken = usingGrant
    ? text(dig(response.body, "refresh_token"))
    : credentials.refreshToken;
  if (!refreshToken) {
    return {
      ok: false,
      reason: "Zoho did not return a refresh token. Generate a new grant code and connect again.",
    };
  }

  // The API domain comes back from Zoho, but it is still only trusted if it is Zoho's.
  const reported = text(dig(response.body, "api_domain"));
  const apiDomain =
    reported && /^https:\/\/www\.zohoapis\.(in|com|eu|com\.au|jp)$/.test(reported)
      ? reported
      : `https://www.zohoapis.${dataCentre}`;

  const expiresIn = Number(dig(response.body, "expires_in")) || 3600;
  const refreshedKey = createHash("sha256")
    .update(`${credentials.clientId}:${refreshToken}`)
    .digest("hex");
  cache.set(refreshedKey, {
    accessToken,
    apiDomain,
    // Two minutes early, so a token is never used in its last moments.
    expiresAt: Date.now() + Math.max(60, expiresIn - 120) * 1000,
  });

  return { ok: true, accessToken, apiDomain, refreshToken };
}

function describeTokenError(error: string | undefined, usingGrant: boolean): string {
  switch (error) {
    case "invalid_code":
      return usingGrant
        ? "The grant code is wrong or has expired. Generate a new one and connect straight away."
        : "Zoho no longer accepts the stored refresh token. Connect again with a new grant code.";
    case "invalid_client":
    case "invalid_client_secret":
      return "Zoho did not recognise the client ID and secret for that data centre.";
    case undefined:
      return "Zoho did not return an access token.";
    default:
      return `Zoho refused the token request (${error}).`;
  }
}
