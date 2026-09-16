import type { IntegrationCategory } from "@prisma/client";

/**
 * TRD §11 / Feature List §14 — every third party a workspace can connect.
 *
 * One static list, served to the Settings screen and read by the service that connects
 * things, so "what fields does Twilio need" and "what does connecting Twilio actually do"
 * are each written once.
 *
 * The `does` and `notYet` lines are shown to the person connecting, word for word. They
 * are the honest part of this file: a card that says "Connected" next to a vendor whose
 * adapter is not built is a promise the app cannot keep, so each entry states what
 * connecting it changes today and, where the obvious next question has the answer "not
 * yet", says so.
 */

export type IntegrationAuth = "api_key" | "oauth" | "webhook_url";

/** What a connected integration takes part in, beyond having its credentials checked. */
export type IntegrationFeature =
  /** Receives the platform events a workspace picks (chat, automation, analytics). */
  | "events"
  /** Pushes each new lead into the CRM. */
  | "lead_sync"
  /** Copies calendar events booked in Appsgain onto the external calendar. */
  | "calendar_sync"
  /** Sends notification email. */
  | "email";

export interface CredentialField {
  key: string;
  label: string;
  /** Secret values are encrypted at rest, never returned, and previewed by last four only. */
  secret: boolean;
  placeholder?: string;
  help?: string;
  optional?: boolean;
  /** A fixed set of choices, rendered as a select. */
  options?: { value: string; label: string }[];
  /** A regular expression the value must match, and the message when it does not. */
  pattern?: string;
  patternMessage?: string;
}

export interface CatalogEntry {
  provider: string;
  name: string;
  category: IntegrationCategory;
  /** Brand colour for the monogram tile in the UI. */
  color: string;
  description: string;
  auth: IntegrationAuth;
  fields: CredentialField[];
  features: IntegrationFeature[];
  /** What connecting it does in the app today. Shown verbatim. */
  does: string[];
  /** What it does not do yet, when that is the obvious next question. Shown verbatim. */
  notYet?: string;
  /** OAuth providers: the environment variables the platform operator has to set. */
  oauthEnv?: { clientId: string; clientSecret: string };
  /** Webhook-URL providers: hosts the URL must be on. Absent means any public host. */
  allowedHosts?: string[];
  docsUrl: string;
}

export const CATEGORY_ORDER: IntegrationCategory[] = [
  "CRM",
  "COMMUNICATION",
  "CALENDAR",
  "TELEPHONY",
  "AI",
  "VOICE",
  "STORAGE",
  "AUTOMATION",
  "ANALYTICS",
];

const EMAIL_PATTERN = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";

const PIPELINE_NOT_YET =
  "Calls still run on the sandbox: the live adapter that would use this account is not built yet.";

const STORAGE_NOT_YET =
  "Recordings are not written to this bucket yet — that needs the storage adapter, which is not built.";

const AUTOMATION_DOES = (name: string) => [
  `Sends a signed test event to your ${name} URL when you connect, so you have a sample to map fields from.`,
  "Sends the events you pick as they happen — signed, logged and retried like any webhook.",
];

export const INTEGRATION_CATALOG: CatalogEntry[] = [
  // ── CRM ───────────────────────────────────────────────────────────────────────────
  {
    provider: "hubspot",
    name: "HubSpot",
    category: "CRM",
    color: "#FF7A59",
    description: "Keep HubSpot contacts in step with the leads your AI agents work.",
    auth: "api_key",
    fields: [
      {
        key: "accessToken",
        label: "Private app access token",
        secret: true,
        placeholder: "pat-na1-…",
        help: "HubSpot → Settings → Integrations → Private Apps. Grant crm.objects.contacts.read and crm.objects.contacts.write.",
        pattern: "^pat-[a-z0-9]+-[0-9a-f-]{20,}$",
        patternMessage: "HubSpot private app tokens start with pat-",
      },
    ],
    features: ["lead_sync"],
    does: [
      "Checks the token can read your HubSpot contacts.",
      "With lead sync on, creates a HubSpot contact for every new lead — or leaves it alone if a contact already has that phone number.",
    ],
    docsUrl: "https://developers.hubspot.com/docs/api/private-apps",
  },
  {
    provider: "salesforce",
    name: "Salesforce",
    category: "CRM",
    color: "#00A1E0",
    description: "Send new leads from Appsgain straight into Salesforce.",
    auth: "oauth",
    fields: [],
    oauthEnv: {
      clientId: "SALESFORCE_OAUTH_CLIENT_ID",
      clientSecret: "SALESFORCE_OAUTH_CLIENT_SECRET",
    },
    features: ["lead_sync"],
    does: [
      "Signs in to Salesforce with OAuth — no password is stored here.",
      "With lead sync on, creates a Salesforce Lead for every new lead.",
    ],
    docsUrl: "https://help.salesforce.com/s/articleView?id=sf.connected_app_create.htm",
  },
  {
    provider: "zoho_crm",
    name: "Zoho CRM",
    category: "CRM",
    color: "#E42527",
    description: "Create Zoho CRM leads the moment they land in Appsgain.",
    auth: "api_key",
    fields: [
      {
        key: "dataCenter",
        label: "Data centre",
        secret: false,
        options: [
          { value: "in", label: "India (zoho.in)" },
          { value: "com", label: "United States (zoho.com)" },
          { value: "eu", label: "Europe (zoho.eu)" },
          { value: "com.au", label: "Australia (zoho.com.au)" },
          { value: "jp", label: "Japan (zoho.jp)" },
        ],
      },
      {
        key: "clientId",
        label: "Self Client ID",
        secret: false,
        placeholder: "1000.XXXXXXXXXXXX",
        help: "api-console.zoho.com → Add Client → Self Client.",
        pattern: "^1000\\.[A-Z0-9]+$",
        patternMessage: "Zoho client IDs look like 1000.XXXXXXXX",
      },
      { key: "clientSecret", label: "Self Client secret", secret: true },
      {
        key: "grantCode",
        label: "Grant code",
        secret: true,
        placeholder: "1000.xxxxxxxx.xxxxxxxx",
        help: "Self Client → Generate Code with scope ZohoCRM.modules.leads.ALL,ZohoCRM.org.READ. It expires within minutes, so connect straight away.",
      },
    ],
    features: ["lead_sync"],
    does: [
      "Exchanges the grant code for a long-lived refresh token and checks it can read your organisation.",
      "With lead sync on, creates a Zoho lead for every new lead, or updates the one with the same phone number.",
    ],
    docsUrl: "https://www.zoho.com/crm/developer/docs/api/v6/self-client-overview.html",
  },
  {
    provider: "pipedrive",
    name: "Pipedrive",
    category: "CRM",
    color: "#1A1F26",
    description: "Add every new lead to Pipedrive as a person.",
    auth: "api_key",
    fields: [
      {
        key: "apiToken",
        label: "API token",
        secret: true,
        help: "Pipedrive → Personal preferences → API.",
        pattern: "^[0-9a-f]{40}$",
        patternMessage: "Pipedrive API tokens are 40 hexadecimal characters",
      },
    ],
    features: ["lead_sync"],
    does: [
      "Checks the token against your Pipedrive account.",
      "With lead sync on, adds a person for every new lead, skipping numbers Pipedrive already has.",
    ],
    docsUrl: "https://pipedrive.readme.io/docs/how-to-find-the-api-token",
  },
  {
    provider: "freshsales",
    name: "Freshsales",
    category: "CRM",
    color: "#F26722",
    description: "Create Freshsales contacts from new leads.",
    auth: "api_key",
    fields: [
      {
        key: "domain",
        label: "Freshsales domain",
        secret: false,
        placeholder: "yourcompany.myfreshworks.com",
        help: "The address you open Freshsales at.",
        pattern: "^[a-z0-9-]+\\.(myfreshworks\\.com|freshsales\\.io)$",
        patternMessage: "Use the full domain, e.g. yourcompany.myfreshworks.com",
      },
      {
        key: "apiKey",
        label: "API key",
        secret: true,
        help: "Freshsales → Profile settings → API settings.",
      },
    ],
    features: ["lead_sync"],
    does: [
      "Checks the key against your Freshsales account.",
      "With lead sync on, creates a Freshsales contact for every new lead.",
    ],
    docsUrl: "https://developers.freshworks.com/crm/api/",
  },

  // ── communication ─────────────────────────────────────────────────────────────────
  {
    provider: "slack",
    name: "Slack",
    category: "COMMUNICATION",
    color: "#4A154B",
    description: "Post hot leads, finished calls and credit warnings to a Slack channel.",
    auth: "webhook_url",
    fields: [
      {
        key: "webhookUrl",
        label: "Incoming webhook URL",
        secret: true,
        placeholder: "https://hooks.slack.com/services/…",
        help: "Slack → Apps → Incoming Webhooks → Add to Slack, then pick the channel.",
        pattern: "^https://hooks\\.slack\\.com/",
        patternMessage: "Slack webhook URLs start with https://hooks.slack.com/",
      },
    ],
    allowedHosts: ["hooks.slack.com"],
    features: ["events"],
    does: [
      "Posts a test message to the channel when you connect.",
      "Posts the events you pick, as they happen.",
    ],
    docsUrl: "https://api.slack.com/messaging/webhooks",
  },
  {
    provider: "microsoft_teams",
    name: "Microsoft Teams",
    category: "COMMUNICATION",
    color: "#5059C9",
    description: "Post updates into a Teams channel through a Workflows webhook.",
    auth: "webhook_url",
    fields: [
      {
        key: "webhookUrl",
        label: "Workflow webhook URL",
        secret: true,
        placeholder: "https://…logic.azure.com/workflows/…",
        help: "In the channel: ••• → Workflows → “Post to a channel when a webhook request is received”.",
      },
    ],
    allowedHosts: [".logic.azure.com", ".api.powerplatform.com", ".webhook.office.com"],
    features: ["events"],
    does: [
      "Posts a test card to the channel when you connect.",
      "Posts the events you pick as adaptive cards, with a link back to the lead.",
    ],
    docsUrl:
      "https://support.microsoft.com/en-us/office/create-incoming-webhooks-with-workflows-for-microsoft-teams-8ae491c7-0394-4861-ba59-055e33f75498",
  },
  {
    provider: "google_chat",
    name: "Google Chat",
    category: "COMMUNICATION",
    color: "#00AC47",
    description: "Send updates to a Google Chat space.",
    auth: "webhook_url",
    fields: [
      {
        key: "webhookUrl",
        label: "Space webhook URL",
        secret: true,
        placeholder: "https://chat.googleapis.com/v1/spaces/…",
        help: "In the space: Apps & integrations → Webhooks → Add webhook.",
        pattern: "^https://chat\\.googleapis\\.com/v1/spaces/",
        patternMessage: "Google Chat webhook URLs start with https://chat.googleapis.com/v1/spaces/",
      },
    ],
    allowedHosts: ["chat.googleapis.com"],
    features: ["events"],
    does: [
      "Posts a test message to the space when you connect.",
      "Posts the events you pick, as they happen.",
    ],
    docsUrl: "https://developers.google.com/workspace/chat/quickstart/webhooks",
  },
  {
    provider: "whatsapp_business",
    name: "WhatsApp Business",
    category: "COMMUNICATION",
    color: "#25D366",
    description: "Connect the WhatsApp Business number follow-ups will be sent from.",
    auth: "api_key",
    fields: [
      {
        key: "phoneNumberId",
        label: "Phone number ID",
        secret: false,
        placeholder: "109876543210987",
        help: "Meta for Developers → your app → WhatsApp → API Setup. This is an ID, not the phone number.",
        pattern: "^\\d{6,20}$",
        patternMessage: "The phone number ID is a long number from WhatsApp Manager, not the phone number itself",
      },
      {
        key: "accessToken",
        label: "Permanent access token",
        secret: true,
        help: "Business Settings → System users → Generate token with whatsapp_business_messaging.",
      },
    ],
    features: [],
    does: ["Checks the token can see this WhatsApp number and shows its verified name."],
    notYet:
      "Sending follow-up messages needs Meta-approved message templates; that flow is not built yet.",
    docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started",
  },
  {
    provider: "sendgrid",
    name: "SendGrid",
    category: "COMMUNICATION",
    color: "#1A82E2",
    description: "Email your team the notifications they asked for.",
    auth: "api_key",
    fields: [
      {
        key: "apiKey",
        label: "API key",
        secret: true,
        placeholder: "SG.…",
        help: "SendGrid → Settings → API Keys. Mail Send access is enough.",
        pattern: "^SG\\.",
        patternMessage: "SendGrid API keys start with SG.",
      },
      {
        key: "fromEmail",
        label: "From address",
        secret: false,
        placeholder: "alerts@yourcompany.com",
        help: "Must be a verified sender in SendGrid.",
        pattern: EMAIL_PATTERN,
        patternMessage: "Enter an email address",
      },
      { key: "fromName", label: "From name", secret: false, optional: true, placeholder: "Appsgain" },
    ],
    features: ["email"],
    does: [
      "Checks the key is allowed to send mail.",
      "Emails teammates the notifications they set to Email in Settings → Notifications.",
    ],
    docsUrl: "https://www.twilio.com/docs/sendgrid/ui/account-and-settings/api-keys",
  },
  {
    provider: "resend",
    name: "Resend",
    category: "COMMUNICATION",
    color: "#111111",
    description: "Send notification email through Resend.",
    auth: "api_key",
    fields: [
      {
        key: "apiKey",
        label: "API key",
        secret: true,
        placeholder: "re_…",
        help: "Resend → API Keys. Sending access is enough.",
        pattern: "^re_",
        patternMessage: "Resend API keys start with re_",
      },
      {
        key: "fromEmail",
        label: "From address",
        secret: false,
        placeholder: "alerts@yourcompany.com",
        help: "On a domain you have verified in Resend.",
        pattern: EMAIL_PATTERN,
        patternMessage: "Enter an email address",
      },
      { key: "fromName", label: "From name", secret: false, optional: true, placeholder: "Appsgain" },
    ],
    features: ["email"],
    does: [
      "Checks the key with Resend.",
      "Emails teammates the notifications they set to Email in Settings → Notifications.",
    ],
    docsUrl: "https://resend.com/docs/dashboard/api-keys/introduction",
  },

  // ── calendar ──────────────────────────────────────────────────────────────────────
  {
    provider: "google_calendar",
    name: "Google Calendar",
    category: "CALENDAR",
    color: "#4285F4",
    description: "Put demos and meetings booked in Appsgain on a Google Calendar.",
    auth: "oauth",
    fields: [],
    oauthEnv: { clientId: "GOOGLE_OAUTH_CLIENT_ID", clientSecret: "GOOGLE_OAUTH_CLIENT_SECRET" },
    features: ["calendar_sync"],
    does: [
      "Signs in with Google — no password is stored here.",
      "Copies meetings and demos created in the Appsgain calendar onto the connected calendar, and moves or removes them when they change here.",
    ],
    docsUrl: "https://developers.google.com/calendar/api/guides/auth",
  },
  {
    provider: "microsoft_outlook",
    name: "Outlook Calendar",
    category: "CALENDAR",
    color: "#0078D4",
    description: "Put demos and meetings booked in Appsgain on an Outlook calendar.",
    auth: "oauth",
    fields: [],
    oauthEnv: {
      clientId: "MICROSOFT_OAUTH_CLIENT_ID",
      clientSecret: "MICROSOFT_OAUTH_CLIENT_SECRET",
    },
    features: ["calendar_sync"],
    does: [
      "Signs in with Microsoft — no password is stored here.",
      "Copies meetings and demos created in the Appsgain calendar onto the connected calendar, and moves or removes them when they change here.",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/graph/auth-register-app-v2",
  },
  {
    provider: "calendly",
    name: "Calendly",
    category: "CALENDAR",
    color: "#006BFF",
    description: "Connect the Calendly account leads book demos through.",
    auth: "api_key",
    fields: [
      {
        key: "accessToken",
        label: "Personal access token",
        secret: true,
        help: "Calendly → Integrations & apps → API and webhooks → Generate new token.",
      },
    ],
    features: [],
    does: ["Checks the token and shows which Calendly user it belongs to."],
    notYet: "Sharing booking links from follow-ups is not built yet.",
    docsUrl: "https://developer.calendly.com/how-to-authenticate-with-personal-access-tokens",
  },

  // ── telephony ─────────────────────────────────────────────────────────────────────
  {
    provider: "twilio",
    name: "Twilio",
    category: "TELEPHONY",
    color: "#F22F46",
    description: "Global calling and phone numbers.",
    auth: "api_key",
    fields: [
      {
        key: "accountSid",
        label: "Account SID",
        secret: false,
        placeholder: "AC…",
        pattern: "^AC[0-9a-fA-F]{32}$",
        patternMessage: "Account SIDs are AC followed by 32 hexadecimal characters",
      },
      {
        key: "authToken",
        label: "Auth token",
        secret: true,
        pattern: "^[0-9a-fA-F]{32}$",
        patternMessage: "Auth tokens are 32 hexadecimal characters",
      },
      {
        key: "callerId",
        label: "Caller ID",
        secret: false,
        optional: true,
        placeholder: "+14155550100",
        help: "A Twilio number in international format.",
        pattern: "^\\+[1-9]\\d{6,14}$",
        patternMessage: "Use international format, e.g. +14155550100",
      },
    ],
    features: [],
    does: ["Checks the account SID and auth token with Twilio and that the account is active."],
    notYet: PIPELINE_NOT_YET,
    docsUrl: "https://www.twilio.com/docs/iam/api/account",
  },
  {
    provider: "exotel",
    name: "Exotel",
    category: "TELEPHONY",
    color: "#0B6FB8",
    description: "Cloud telephony for India, with DLT and DND handling.",
    auth: "api_key",
    fields: [
      {
        key: "region",
        label: "Cluster",
        secret: false,
        options: [
          { value: "api.in.exotel.com", label: "Mumbai (api.in.exotel.com)" },
          { value: "api.exotel.com", label: "Singapore (api.exotel.com)" },
        ],
      },
      { key: "accountSid", label: "Account SID", secret: false },
      { key: "apiKey", label: "API key", secret: true },
      { key: "apiToken", label: "API token", secret: true },
    ],
    features: [],
    does: ["Checks the key and token can read your Exotel call log."],
    notYet: PIPELINE_NOT_YET,
    docsUrl: "https://developer.exotel.com/api/",
  },
  {
    provider: "ozonetel",
    name: "Ozonetel",
    category: "TELEPHONY",
    color: "#F58220",
    description: "CloudAgent contact-centre telephony.",
    auth: "api_key",
    fields: [
      { key: "username", label: "CloudAgent username", secret: false },
      { key: "apiKey", label: "API key", secret: true },
    ],
    features: [],
    does: ["Stores the credentials encrypted for the telephony adapter."],
    notYet:
      "Ozonetel has no read-only endpoint to check keys against, so they are saved unverified — and " +
      PIPELINE_NOT_YET.charAt(0).toLowerCase() +
      PIPELINE_NOT_YET.slice(1),
    docsUrl: "https://docs.ozonetel.com/",
  },
  {
    provider: "plivo",
    name: "Plivo",
    category: "TELEPHONY",
    color: "#43B02A",
    description: "Voice and numbers in 190+ countries.",
    auth: "api_key",
    fields: [
      {
        key: "authId",
        label: "Auth ID",
        secret: false,
        placeholder: "MA…",
        pattern: "^(MA|SA)[A-Z0-9]{18}$",
        patternMessage: "Plivo auth IDs are 20 characters starting with MA or SA",
      },
      { key: "authToken", label: "Auth token", secret: true },
    ],
    features: [],
    does: ["Checks the auth ID and token with Plivo."],
    notYet: PIPELINE_NOT_YET,
    docsUrl: "https://www.plivo.com/docs/voice/api/account/",
  },
  {
    provider: "vonage",
    name: "Vonage",
    category: "TELEPHONY",
    color: "#131415",
    description: "Voice API from Vonage (formerly Nexmo).",
    auth: "api_key",
    fields: [
      {
        key: "apiKey",
        label: "API key",
        secret: false,
        pattern: "^[0-9a-f]{8}$",
        patternMessage: "Vonage API keys are 8 hexadecimal characters",
      },
      { key: "apiSecret", label: "API secret", secret: true },
    ],
    features: [],
    does: ["Checks the key and secret by reading your Vonage balance."],
    notYet: PIPELINE_NOT_YET,
    docsUrl: "https://developer.vonage.com/en/account/overview",
  },

  // ── AI ────────────────────────────────────────────────────────────────────────────
  {
    provider: "anthropic",
    name: "Anthropic Claude",
    category: "AI",
    color: "#D97757",
    description: "Claude models for conversations, qualification and call summaries.",
    auth: "api_key",
    fields: [
      {
        key: "apiKey",
        label: "API key",
        secret: true,
        placeholder: "sk-ant-…",
        pattern: "^sk-ant-",
        patternMessage: "Anthropic API keys start with sk-ant-",
      },
    ],
    features: [],
    does: ["Checks the key by listing the models it can use."],
    notYet: PIPELINE_NOT_YET,
    docsUrl: "https://docs.anthropic.com/en/api/getting-started",
  },
  {
    provider: "openai",
    name: "OpenAI",
    category: "AI",
    color: "#10A37F",
    description: "GPT models for conversations and summaries.",
    auth: "api_key",
    fields: [
      {
        key: "apiKey",
        label: "API key",
        secret: true,
        placeholder: "sk-…",
        pattern: "^sk-",
        patternMessage: "OpenAI API keys start with sk-",
      },
    ],
    features: [],
    does: ["Checks the key by listing the models it can use."],
    notYet: PIPELINE_NOT_YET,
    docsUrl: "https://platform.openai.com/docs/api-reference/authentication",
  },
  {
    provider: "google_gemini",
    name: "Google Gemini",
    category: "AI",
    color: "#1C69FF",
    description: "Gemini models through the Gemini API.",
    auth: "api_key",
    fields: [
      {
        key: "apiKey",
        label: "API key",
        secret: true,
        placeholder: "AIza…",
        pattern: "^AIza[0-9A-Za-z_-]{35}$",
        patternMessage: "Gemini API keys start with AIza and are 39 characters",
      },
    ],
    features: [],
    does: ["Checks the key by listing the models it can use."],
    notYet: PIPELINE_NOT_YET,
    docsUrl: "https://ai.google.dev/gemini-api/docs/api-key",
  },
  {
    provider: "azure_openai",
    name: "Azure OpenAI",
    category: "AI",
    color: "#0078D4",
    description: "OpenAI models hosted in your own Azure subscription.",
    auth: "api_key",
    fields: [
      {
        key: "endpoint",
        label: "Endpoint",
        secret: false,
        placeholder: "https://your-resource.openai.azure.com",
        pattern: "^https://[a-z0-9-]+\\.(openai\\.azure\\.com|cognitiveservices\\.azure\\.com)/?$",
        patternMessage: "Use the resource endpoint, e.g. https://your-resource.openai.azure.com",
      },
      { key: "apiKey", label: "API key", secret: true },
    ],
    features: [],
    does: ["Checks the endpoint and key by listing the models the resource offers."],
    notYet: PIPELINE_NOT_YET,
    docsUrl: "https://learn.microsoft.com/en-us/azure/ai-services/openai/reference",
  },

  // ── voice ─────────────────────────────────────────────────────────────────────────
  {
    provider: "elevenlabs",
    name: "ElevenLabs",
    category: "VOICE",
    color: "#000000",
    description: "Natural text-to-speech voices, including Hindi.",
    auth: "api_key",
    fields: [{ key: "apiKey", label: "API key", secret: true }],
    features: [],
    does: ["Checks the key and shows the plan it is on."],
    notYet: PIPELINE_NOT_YET,
    docsUrl: "https://elevenlabs.io/docs/api-reference/authentication",
  },
  {
    provider: "deepgram",
    name: "Deepgram",
    category: "VOICE",
    color: "#13EF93",
    description: "Fast speech-to-text for live calls and transcripts.",
    auth: "api_key",
    fields: [{ key: "apiKey", label: "API key", secret: true }],
    features: [],
    does: ["Checks the key by reading the projects it belongs to."],
    notYet: PIPELINE_NOT_YET,
    docsUrl: "https://developers.deepgram.com/docs/create-additional-api-keys",
  },
  {
    provider: "azure_speech",
    name: "Azure AI Speech",
    category: "VOICE",
    color: "#0078D4",
    description: "Speech-to-text and neural voices in Indian languages.",
    auth: "api_key",
    fields: [
      {
        key: "region",
        label: "Region",
        secret: false,
        placeholder: "centralindia",
        pattern: "^[a-z0-9]+$",
        patternMessage: "Use the region name, e.g. centralindia",
      },
      { key: "apiKey", label: "Resource key", secret: true },
    ],
    features: [],
    does: ["Checks the key by asking the region for an access token."],
    notYet: PIPELINE_NOT_YET,
    docsUrl: "https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech",
  },
  {
    provider: "google_cloud_tts",
    name: "Google Cloud Text-to-Speech",
    category: "VOICE",
    color: "#34A853",
    description: "WaveNet and Neural2 voices, including Hindi.",
    auth: "api_key",
    fields: [
      {
        key: "apiKey",
        label: "API key",
        secret: true,
        placeholder: "AIza…",
        pattern: "^AIza[0-9A-Za-z_-]{35}$",
        patternMessage: "Google API keys start with AIza and are 39 characters",
      },
    ],
    features: [],
    does: ["Checks the key by listing the Hindi voices it can use."],
    notYet: PIPELINE_NOT_YET,
    docsUrl: "https://cloud.google.com/text-to-speech/docs/before-you-begin",
  },

  // ── storage ───────────────────────────────────────────────────────────────────────
  {
    provider: "aws_s3",
    name: "Amazon S3",
    category: "STORAGE",
    color: "#FF9900",
    description: "Keep call recordings in your own S3 bucket.",
    auth: "api_key",
    fields: [
      {
        key: "region",
        label: "Region",
        secret: false,
        placeholder: "ap-south-1",
        pattern: "^[a-z]{2}(-gov)?-[a-z]+-\\d$",
        patternMessage: "Use the region code, e.g. ap-south-1",
      },
      {
        key: "bucket",
        label: "Bucket",
        secret: false,
        pattern: "^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$",
        patternMessage: "Bucket names are 3–63 lowercase letters, numbers, dots and hyphens",
      },
      {
        key: "accessKeyId",
        label: "Access key ID",
        secret: false,
        placeholder: "AKIA…",
        pattern: "^(AKIA|ASIA)[A-Z0-9]{16}$",
        patternMessage: "Access key IDs are 20 characters starting with AKIA",
      },
      { key: "secretAccessKey", label: "Secret access key", secret: true },
    ],
    features: [],
    does: ["Checks the keys can reach the bucket, in the region you gave."],
    notYet: STORAGE_NOT_YET,
    docsUrl: "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html",
  },
  {
    provider: "cloudflare_r2",
    name: "Cloudflare R2",
    category: "STORAGE",
    color: "#F38020",
    description: "S3-compatible storage with no egress fees.",
    auth: "api_key",
    fields: [
      {
        key: "accountId",
        label: "Account ID",
        secret: false,
        pattern: "^[0-9a-f]{32}$",
        patternMessage: "Cloudflare account IDs are 32 hexadecimal characters",
      },
      {
        key: "bucket",
        label: "Bucket",
        secret: false,
        pattern: "^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$",
        patternMessage: "Bucket names are 3–63 lowercase letters, numbers and hyphens",
      },
      { key: "accessKeyId", label: "Access key ID", secret: false },
      { key: "secretAccessKey", label: "Secret access key", secret: true },
    ],
    features: [],
    does: ["Checks the R2 API token can reach the bucket."],
    notYet: STORAGE_NOT_YET,
    docsUrl: "https://developers.cloudflare.com/r2/api/s3/tokens/",
  },
  {
    provider: "google_cloud_storage",
    name: "Google Cloud Storage",
    category: "STORAGE",
    color: "#4285F4",
    description: "Store recordings in a Cloud Storage bucket, using HMAC keys.",
    auth: "api_key",
    fields: [
      {
        key: "bucket",
        label: "Bucket",
        secret: false,
        pattern: "^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$",
        patternMessage: "Bucket names are 3–63 lowercase letters, numbers, dots, dashes and underscores",
      },
      {
        key: "accessKeyId",
        label: "HMAC access ID",
        secret: false,
        placeholder: "GOOG…",
        pattern: "^GOOG[A-Z0-9]+$",
        patternMessage: "HMAC access IDs start with GOOG",
      },
      { key: "secretAccessKey", label: "HMAC secret", secret: true },
    ],
    features: [],
    does: ["Checks the HMAC key can reach the bucket."],
    notYet: STORAGE_NOT_YET,
    docsUrl: "https://cloud.google.com/storage/docs/authentication/managing-hmackeys",
  },

  // ── automation ────────────────────────────────────────────────────────────────────
  {
    provider: "zapier",
    name: "Zapier",
    category: "AUTOMATION",
    color: "#FF4F00",
    description: "Start a Zap from any Appsgain event.",
    auth: "webhook_url",
    fields: [
      {
        key: "webhookUrl",
        label: "Catch Hook URL",
        secret: true,
        placeholder: "https://hooks.zapier.com/hooks/catch/…",
        help: "In Zapier: trigger “Webhooks by Zapier” → Catch Hook, then copy its URL.",
        pattern: "^https://hooks\\.zapier\\.com/",
        patternMessage: "Zapier hook URLs start with https://hooks.zapier.com/",
      },
    ],
    allowedHosts: ["hooks.zapier.com"],
    features: ["events"],
    does: AUTOMATION_DOES("Zapier"),
    docsUrl: "https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zaps-from-webhooks",
  },
  {
    provider: "make",
    name: "Make",
    category: "AUTOMATION",
    color: "#6D00CC",
    description: "Run a Make scenario when something happens in Appsgain.",
    auth: "webhook_url",
    fields: [
      {
        key: "webhookUrl",
        label: "Custom webhook URL",
        secret: true,
        placeholder: "https://hook.eu1.make.com/…",
        help: "In Make: Webhooks → Custom webhook → Add, then copy the address.",
      },
    ],
    allowedHosts: [".make.com", "hook.integromat.com"],
    features: ["events"],
    does: AUTOMATION_DOES("Make"),
    docsUrl: "https://www.make.com/en/help/tools/webhooks",
  },
  {
    provider: "n8n",
    name: "n8n",
    category: "AUTOMATION",
    color: "#EA4B71",
    description: "Trigger n8n workflows, cloud or self-hosted.",
    auth: "webhook_url",
    fields: [
      {
        key: "webhookUrl",
        label: "Webhook node production URL",
        secret: true,
        placeholder: "https://your-n8n.example.com/webhook/…",
        help: "Add a Webhook node set to POST, activate the workflow, and copy the Production URL.",
      },
    ],
    features: ["events"],
    does: AUTOMATION_DOES("n8n"),
    docsUrl: "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/",
  },
  {
    provider: "pabbly_connect",
    name: "Pabbly Connect",
    category: "AUTOMATION",
    color: "#20B276",
    description: "Trigger Pabbly Connect workflows from Appsgain events.",
    auth: "webhook_url",
    fields: [
      {
        key: "webhookUrl",
        label: "Webhook URL",
        secret: true,
        placeholder: "https://connect.pabbly.com/workflow/sendwebhookdata/…",
        help: "Create a workflow with the Webhook trigger and copy its URL.",
      },
    ],
    allowedHosts: ["connect.pabbly.com"],
    features: ["events"],
    does: AUTOMATION_DOES("Pabbly Connect"),
    docsUrl: "https://www.pabbly.com/connect/integrations/webhook/",
  },

  // ── analytics ─────────────────────────────────────────────────────────────────────
  {
    provider: "google_analytics",
    name: "Google Analytics 4",
    category: "ANALYTICS",
    color: "#E37400",
    description: "Count leads and calls as GA4 events next to your website traffic.",
    auth: "api_key",
    fields: [
      {
        key: "measurementId",
        label: "Measurement ID",
        secret: false,
        placeholder: "G-XXXXXXXXXX",
        pattern: "^G-[A-Z0-9]{4,}$",
        patternMessage: "Measurement IDs start with G-",
      },
      {
        key: "apiSecret",
        label: "Measurement Protocol API secret",
        secret: true,
        help: "Admin → Data streams → your stream → Measurement Protocol API secrets.",
      },
    ],
    features: ["events"],
    does: [
      "Validates the measurement with Google. Google does not confirm API secrets, so check Realtime after the first event.",
      "Sends the events you pick through the Measurement Protocol, without names or phone numbers.",
    ],
    docsUrl: "https://developers.google.com/analytics/devguides/collection/protocol/ga4",
  },
  {
    provider: "mixpanel",
    name: "Mixpanel",
    category: "ANALYTICS",
    color: "#7856FF",
    description: "Track leads and calls in Mixpanel.",
    auth: "api_key",
    fields: [
      { key: "projectToken", label: "Project token", secret: true },
      {
        key: "residency",
        label: "Data residency",
        secret: false,
        options: [
          { value: "us", label: "United States" },
          { value: "eu", label: "European Union" },
          { value: "in", label: "India" },
        ],
      },
    ],
    features: ["events"],
    does: [
      "Sends a test event when you connect.",
      "Sends the events you pick, without names or phone numbers.",
    ],
    docsUrl: "https://docs.mixpanel.com/docs/tracking-methods/sdks/javascript",
  },
  {
    provider: "posthog",
    name: "PostHog",
    category: "ANALYTICS",
    color: "#F54E00",
    description: "Product analytics for your sales funnel.",
    auth: "api_key",
    fields: [
      {
        key: "projectApiKey",
        label: "Project API key",
        secret: true,
        placeholder: "phc_…",
        pattern: "^phc_",
        patternMessage: "PostHog project API keys start with phc_",
      },
      {
        key: "host",
        label: "Cloud region",
        secret: false,
        options: [
          { value: "us", label: "US Cloud" },
          { value: "eu", label: "EU Cloud" },
        ],
      },
    ],
    features: ["events"],
    does: [
      "Sends a test event when you connect, which PostHog checks the key on.",
      "Sends the events you pick, without names or phone numbers.",
    ],
    docsUrl: "https://posthog.com/docs/api/capture",
  },
];

const BY_PROVIDER = new Map(INTEGRATION_CATALOG.map((entry) => [entry.provider, entry]));

export function catalogEntry(provider: string): CatalogEntry | undefined {
  return BY_PROVIDER.get(provider);
}

/** Providers that receive events without a webhook row behind them. */
export const EVENT_RECEIVER_PROVIDERS = INTEGRATION_CATALOG.filter(
  (entry) =>
    entry.category !== "AUTOMATION" &&
    entry.features.some((feature) => feature === "events" || feature === "lead_sync"),
).map((entry) => entry.provider);

export const CALENDAR_SYNC_PROVIDERS = INTEGRATION_CATALOG.filter((entry) =>
  entry.features.includes("calendar_sync"),
).map((entry) => entry.provider);

export const EMAIL_PROVIDERS = INTEGRATION_CATALOG.filter((entry) =>
  entry.features.includes("email"),
).map((entry) => entry.provider);
