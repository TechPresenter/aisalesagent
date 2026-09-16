import { analyticsEventFor, sendGa4, sendMixpanel, sendPostHog, POSTHOG_HOSTS } from "./analytics";
import { postChatMessage, type ChatProvider } from "./chat";
import { freshsalesBase } from "./crm";
import { dig, redactSecrets, text, vendorFetch, vendorMessage, type VendorResponse } from "./http";
import { sha256Hex, signV4 } from "./sigv4";
import { zohoAccessToken } from "./zoho";

/**
 * "Do these credentials work?" — asked of the vendor itself, with the cheapest read-only
 * request each one offers.
 *
 * Connecting only stores credentials that pass. A form that accepted any string and then
 * showed "Connected" would move the failure to the first real event, where nobody is
 * looking; checking at the moment someone is typing the key puts it where it can be fixed.
 */

export type Credentials = Record<string, string>;

export type VerifyResult =
  | {
      ok: true;
      /** False when the vendor offers no way to check, and the credentials were only stored. */
      verified: boolean;
      /** A non-secret label for what was connected: an account name, a region, a bucket. */
      account?: string;
      /** Replacement credentials to store, when checking produced better ones (Zoho). */
      credentials?: Credentials;
    }
  | { ok: false; reason: string };

type Verifier = (credentials: Credentials) => Promise<VerifyResult>;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const basic = (user: string, password: string) => ({
  Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
});

function interpret(
  vendor: string,
  response: VendorResponse,
  secrets: (string | undefined)[],
  account?: (body: unknown) => string | undefined,
): VerifyResult {
  if (response.status === 0) {
    return { ok: false, reason: `Could not reach ${vendor}: ${response.error ?? "no response"}.` };
  }
  if (response.ok) {
    return { ok: true, verified: true, account: account?.(response.body) };
  }

  const message = vendorMessage(response);
  const detail = message ? ` (${redactSecrets(message, secrets)})` : "";
  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: `${vendor} rejected these credentials${detail}.` };
  }
  if (response.status === 404) {
    return { ok: false, reason: `${vendor} could not find that account${detail}.` };
  }
  if (response.status === 429) {
    return { ok: false, reason: `${vendor} is rate-limiting requests. Try again in a minute.` };
  }
  if (response.status >= 500) {
    return {
      ok: false,
      reason: `${vendor} had a problem answering (HTTP ${response.status}). Try again shortly.`,
    };
  }
  return { ok: false, reason: `${vendor} did not accept the check (HTTP ${response.status})${detail}.` };
}

const countOf = (noun: string, ...path: (string | number)[]) => (body: unknown) => {
  const list = dig(body, ...path);
  return Array.isArray(list) ? `${list.length} ${noun} available` : undefined;
};

function chatVerifier(provider: ChatProvider, vendor: string): Verifier {
  return async ({ webhookUrl }) => {
    const response = await postChatMessage(provider, webhookUrl, {
      title: "Appsgain is connected",
      lines: ["The events you choose in Appsgain will be posted here."],
    });
    if (response.status === 0) {
      return { ok: false, reason: `Could not reach ${vendor}: ${response.error}.` };
    }
    if (response.ok) return { ok: true, verified: true, account: "Test message delivered" };

    const message = vendorMessage(response);
    return {
      ok: false,
      reason: `${vendor} refused the test message (HTTP ${response.status}${
        message ? `: ${redactSecrets(message, [webhookUrl])}` : ""
      }). Check the webhook URL.`,
    };
  };
}

async function headBucket(
  vendor: string,
  url: URL,
  region: string,
  bucket: string,
  accessKeyId: string,
  secretAccessKey: string,
): Promise<VerifyResult> {
  const payloadHash = sha256Hex("");
  const signed = signV4({
    method: "HEAD",
    url,
    headers: { "x-amz-content-sha256": payloadHash },
    payloadHash,
    region,
    service: "s3",
    accessKeyId,
    secretAccessKey,
    date: new Date(),
  });

  const response = await vendorFetch(url.toString(), {
    method: "HEAD",
    headers: {
      Authorization: signed.authorization,
      "x-amz-date": signed.amzDate,
      "x-amz-content-sha256": payloadHash,
    },
  });

  if (response.status === 0) return { ok: false, reason: `Could not reach ${vendor}: ${response.error}.` };
  if (response.ok) return { ok: true, verified: true, account: `Bucket ${bucket}` };

  const actualRegion = response.headers?.get("x-amz-bucket-region");
  if (actualRegion && actualRegion !== region && region !== "auto") {
    return { ok: false, reason: `Bucket ${bucket} is in ${actualRegion}, not ${region}.` };
  }
  switch (response.status) {
    case 403:
      return { ok: false, reason: `${vendor} refused these keys, or they cannot read bucket ${bucket}.` };
    case 404:
      return { ok: false, reason: `${vendor} has no bucket called ${bucket}.` };
    default:
      return { ok: false, reason: `${vendor} did not accept the check (HTTP ${response.status}).` };
  }
}

const TEST_DISTINCT_ID = "appsgain-connection-test";

function testAnalyticsEvent() {
  return analyticsEventFor({
    id: `evt_test_${Date.now()}`,
    event: "test.ping",
    createdAt: new Date().toISOString(),
    workspaceId: TEST_DISTINCT_ID,
    data: {},
  });
}

/**
 * One verifier per provider. `null` means the provider is checked somewhere else: OAuth
 * providers by the OAuth service once sign-in completes, automation providers by sending
 * a signed test event through the webhook pipeline.
 */
export const VERIFIERS: Record<string, Verifier | null> = {
  // ── CRM ──
  hubspot: async ({ accessToken }) => {
    const response = await vendorFetch("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", {
      headers: bearer(accessToken),
    });
    const result = interpret("HubSpot", response, [accessToken]);
    if (!result.ok) return result;

    const details = await vendorFetch("https://api.hubapi.com/account-info/v3/details", {
      headers: bearer(accessToken),
    });
    const portalId = dig(details.body, "portalId");
    return { ...result, account: typeof portalId === "number" ? `Portal ${portalId}` : undefined };
  },

  salesforce: null,

  zoho_crm: async (credentials) => {
    const token = await zohoAccessToken(credentials);
    if (!token.ok) return { ok: false, reason: token.reason };

    const response = await vendorFetch(`${token.apiDomain}/crm/v6/org`, {
      headers: { Authorization: `Zoho-oauthtoken ${token.accessToken}` },
    });
    const result = interpret("Zoho CRM", response, [credentials.clientSecret, token.accessToken], (body) =>
      text(dig(body, "org", 0, "company_name")),
    );
    if (!result.ok) return result;

    return {
      ...result,
      // The grant code is spent; what is worth keeping is the refresh token it bought.
      credentials: {
        dataCenter: credentials.dataCenter,
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        refreshToken: token.refreshToken,
      },
    };
  },

  pipedrive: async ({ apiToken }) =>
    interpret(
      "Pipedrive",
      await vendorFetch(
        `https://api.pipedrive.com/v1/users/me?api_token=${encodeURIComponent(apiToken)}`,
      ),
      [apiToken],
      (body) => text(dig(body, "data", "company_name")) ?? text(dig(body, "data", "email")),
    ),

  freshsales: async ({ domain, apiKey }) => {
    const base = freshsalesBase(domain);
    if (!base) return { ok: false, reason: "Use your full Freshsales domain, e.g. yourcompany.myfreshworks.com." };
    return interpret(
      "Freshsales",
      await vendorFetch(`${base}/selector/owners`, {
        headers: { Authorization: `Token token=${apiKey}` },
      }),
      [apiKey],
      () => domain,
    );
  },

  // ── communication ──
  slack: chatVerifier("slack", "Slack"),
  microsoft_teams: chatVerifier("microsoft_teams", "Microsoft Teams"),
  google_chat: chatVerifier("google_chat", "Google Chat"),

  whatsapp_business: async ({ phoneNumberId, accessToken }) =>
    interpret(
      "WhatsApp (Meta)",
      await vendorFetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}` +
          "?fields=display_phone_number,verified_name",
        { headers: bearer(accessToken) },
      ),
      [accessToken],
      (body) =>
        [text(dig(body, "verified_name")), text(dig(body, "display_phone_number"))]
          .filter(Boolean)
          .join(" · ") || undefined,
    ),

  sendgrid: async ({ apiKey, fromEmail }) => {
    const response = await vendorFetch("https://api.sendgrid.com/v3/scopes", {
      headers: bearer(apiKey),
    });
    const result = interpret("SendGrid", response, [apiKey]);
    if (!result.ok) return result;

    const scopes = dig(response.body, "scopes");
    if (Array.isArray(scopes) && !scopes.includes("mail.send")) {
      return { ok: false, reason: "This SendGrid key cannot send mail. Give it Mail Send access." };
    }
    return { ...result, account: `Sending as ${fromEmail}` };
  },

  resend: async ({ apiKey, fromEmail }) => {
    const response = await vendorFetch("https://api.resend.com/domains", {
      headers: bearer(apiKey),
    });
    // A sending-only key cannot list domains, and says so by name. That is a valid key.
    if (response.status === 401 && dig(response.body, "name") === "restricted_api_key") {
      return { ok: true, verified: true, account: `Sending as ${fromEmail}` };
    }
    const result = interpret("Resend", response, [apiKey]);
    return result.ok ? { ...result, account: `Sending as ${fromEmail}` } : result;
  },

  // ── calendar ──
  google_calendar: null,
  microsoft_outlook: null,

  calendly: async ({ accessToken }) =>
    interpret(
      "Calendly",
      await vendorFetch("https://api.calendly.com/users/me", { headers: bearer(accessToken) }),
      [accessToken],
      (body) => text(dig(body, "resource", "email")) ?? text(dig(body, "resource", "name")),
    ),

  // ── telephony ──
  twilio: async ({ accountSid, authToken }) => {
    const response = await vendorFetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`,
      { headers: basic(accountSid, authToken) },
    );
    const result = interpret("Twilio", response, [authToken], (body) => text(dig(body, "friendly_name")));
    const status = text(dig(response.body, "status"));
    if (result.ok && status && status !== "active") {
      return { ok: false, reason: `The Twilio account is ${status}.` };
    }
    return result;
  },

  exotel: async ({ region, accountSid, apiKey, apiToken }) => {
    if (region !== "api.exotel.com" && region !== "api.in.exotel.com") {
      return { ok: false, reason: "Pick the Exotel cluster your account is on." };
    }
    return interpret(
      "Exotel",
      await vendorFetch(
        `https://${region}/v1/Accounts/${encodeURIComponent(accountSid)}/Calls.json?PageSize=1`,
        { headers: basic(apiKey, apiToken) },
      ),
      [apiKey, apiToken],
      () => accountSid,
    );
  },

  // No read-only endpoint to check against; stored, and labelled as unverified.
  ozonetel: async ({ username }) => ({ ok: true, verified: false, account: username }),

  plivo: async ({ authId, authToken }) =>
    interpret(
      "Plivo",
      await vendorFetch(`https://api.plivo.com/v1/Account/${encodeURIComponent(authId)}/`, {
        headers: basic(authId, authToken),
      }),
      [authToken],
      (body) => text(dig(body, "name")),
    ),

  vonage: async ({ apiKey, apiSecret }) => {
    const params = new URLSearchParams({ api_key: apiKey, api_secret: apiSecret });
    return interpret(
      "Vonage",
      await vendorFetch(`https://rest.nexmo.com/account/get-balance?${params.toString()}`),
      [apiSecret],
      (body) => {
        const value = dig(body, "value");
        return typeof value === "number" ? `Balance ${value.toFixed(2)}` : undefined;
      },
    );
  },

  // ── AI ──
  anthropic: async ({ apiKey }) =>
    interpret(
      "Anthropic",
      await vendorFetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      }),
      [apiKey],
      countOf("models", "data"),
    ),

  openai: async ({ apiKey }) =>
    interpret(
      "OpenAI",
      await vendorFetch("https://api.openai.com/v1/models", { headers: bearer(apiKey) }),
      [apiKey],
      countOf("models", "data"),
    ),

  google_gemini: async ({ apiKey }) =>
    interpret(
      "Google Gemini",
      await vendorFetch("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: { "x-goog-api-key": apiKey },
      }),
      [apiKey],
      countOf("models", "models"),
    ),

  azure_openai: async ({ endpoint, apiKey }) => {
    const match = endpoint
      .trim()
      .match(/^https:\/\/([a-z0-9-]+)\.(openai\.azure\.com|cognitiveservices\.azure\.com)\/?$/i);
    if (!match) {
      return { ok: false, reason: "Use the resource endpoint, e.g. https://your-resource.openai.azure.com." };
    }
    const base = `https://${match[1].toLowerCase()}.${match[2].toLowerCase()}`;
    return interpret(
      "Azure OpenAI",
      await vendorFetch(`${base}/openai/models?api-version=2024-10-21`, {
        headers: { "api-key": apiKey },
      }),
      [apiKey],
      countOf("models", "data"),
    );
  },

  // ── voice ──
  elevenlabs: async ({ apiKey }) =>
    interpret(
      "ElevenLabs",
      await vendorFetch("https://api.elevenlabs.io/v1/user", { headers: { "xi-api-key": apiKey } }),
      [apiKey],
      (body) => {
        const tier = text(dig(body, "subscription", "tier"));
        return tier ? `${tier} plan` : undefined;
      },
    ),

  deepgram: async ({ apiKey }) =>
    interpret(
      "Deepgram",
      await vendorFetch("https://api.deepgram.com/v1/projects", {
        headers: { Authorization: `Token ${apiKey}` },
      }),
      [apiKey],
      (body) => text(dig(body, "projects", 0, "name")),
    ),

  azure_speech: async ({ region, apiKey }) => {
    if (!/^[a-z0-9]+$/.test(region)) {
      return { ok: false, reason: "Use the region name, e.g. centralindia." };
    }
    return interpret(
      "Azure AI Speech",
      await vendorFetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
        method: "POST",
        headers: { "Ocp-Apim-Subscription-Key": apiKey },
        body: "",
      }),
      [apiKey],
      () => `Region ${region}`,
    );
  },

  google_cloud_tts: async ({ apiKey }) =>
    interpret(
      "Google Cloud Text-to-Speech",
      await vendorFetch("https://texttospeech.googleapis.com/v1/voices?languageCode=hi-IN", {
        headers: { "x-goog-api-key": apiKey },
      }),
      [apiKey],
      countOf("Hindi voices", "voices"),
    ),

  // ── storage ──
  aws_s3: async ({ region, bucket, accessKeyId, secretAccessKey }) => {
    // Virtual-hosted style, except for dotted bucket names, which break its TLS certificate.
    const url = bucket.includes(".")
      ? new URL(`https://s3.${region}.amazonaws.com/${bucket}`)
      : new URL(`https://${bucket}.s3.${region}.amazonaws.com/`);
    return headBucket("Amazon S3", url, region, bucket, accessKeyId, secretAccessKey);
  },

  cloudflare_r2: async ({ accountId, bucket, accessKeyId, secretAccessKey }) =>
    headBucket(
      "Cloudflare R2",
      new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucket}`),
      "auto",
      bucket,
      accessKeyId,
      secretAccessKey,
    ),

  google_cloud_storage: async ({ bucket, accessKeyId, secretAccessKey }) =>
    headBucket(
      "Google Cloud Storage",
      new URL(`https://storage.googleapis.com/${bucket}`),
      "auto",
      bucket,
      accessKeyId,
      secretAccessKey,
    ),

  // ── automation: checked by a signed test event through the webhook pipeline ──
  zapier: null,
  make: null,
  n8n: null,
  pabbly_connect: null,

  // ── analytics ──
  google_analytics: async (credentials) => {
    const response = await sendGa4(credentials, testAnalyticsEvent(), { validateOnly: true });
    const result = interpret("Google Analytics", response, [credentials.apiSecret]);
    if (!result.ok) return result;

    const messages = dig(response.body, "validationMessages");
    if (Array.isArray(messages) && messages.length > 0) {
      return {
        ok: false,
        reason: `Google Analytics flagged the request: ${
          text(dig(messages[0], "description")) ?? "the measurement is not valid"
        }.`,
      };
    }
    return { ...result, account: credentials.measurementId };
  },

  mixpanel: async (credentials) => {
    const response = await sendMixpanel(credentials, testAnalyticsEvent());
    if (response.status === 0) return { ok: false, reason: `Could not reach Mixpanel: ${response.error}.` };
    if (response.ok && dig(response.body, "status") === 1) {
      return { ok: true, verified: true, account: "Test event delivered" };
    }
    const reason = text(dig(response.body, "error")) ?? vendorMessage(response);
    return {
      ok: false,
      reason: `Mixpanel refused the test event${
        reason ? `: ${redactSecrets(reason, [credentials.projectToken])}` : ""
      }.`,
    };
  },

  posthog: async (credentials) => {
    if (!POSTHOG_HOSTS[credentials.host]) {
      return { ok: false, reason: "Pick the PostHog cloud region your project is in." };
    }
    return interpret(
      "PostHog",
      await sendPostHog(credentials, testAnalyticsEvent()),
      [credentials.projectApiKey],
      () => "Test event delivered",
    );
  },
};
