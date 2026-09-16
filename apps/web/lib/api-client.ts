import type {
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  TenantSummary,
} from "@appsgain/shared";
import type { LeadSource, LeadStatus } from "./types";

/**
 * Thin typed wrapper over the NestJS API (TRD §8).
 *
 * Everything here is written against the endpoints as they exist in apps/api, but the
 * repository layer above it (leads-repository.ts) falls back to seed data when the API
 * is not reachable. That is not a permanent arrangement — it is what lets the web app be
 * developed and demoed before `docker-compose up` is part of everyone's routine, and the
 * fallback is loud in the console rather than silent.
 */

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface ScoreReason {
  label: string;
  impact: "positive" | "negative";
}

export interface ApiLead {
  id: string;
  tenantId: string;
  name: string;
  contactPerson: string | null;
  jobTitle: string | null;
  phone: string;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  industry: string | null;
  companySize: string | null;
  source: LeadSource;
  status: LeadStatus;
  score: number;
  scoreReasons: ScoreReason[] | null;
  temperature: "HOT" | "WARM" | "COLD";
  ownerId: string | null;
  customFields: Record<string, unknown> | null;
  lastContactedAt: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedLeads {
  data: ApiLead[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ImportSummary {
  imported: number;
  duplicatesInFile: { sourceRow: number; reason: string; value?: string }[];
  duplicatesInDatabase: { sourceRow: number; reason: string; value?: string }[];
  rejected: { sourceRow: number; reason: string; value?: string }[];
  dryRun: boolean;
}

export type LeadActivityType =
  | "CREATED" | "UPDATED" | "STATUS_CHANGED" | "SCORE_CHANGED" | "ASSIGNED"
  | "CALL_PLACED" | "CALL_COMPLETED" | "NOTE_ADDED" | "FOLLOWUP_CREATED"
  | "FOLLOWUP_COMPLETED" | "EMAIL_SENT" | "WHATSAPP_SENT" | "IMPORTED"
  | "TAG_ADDED" | "TAG_REMOVED";

/** One row of `GET /leads/:id/activity`. */
export interface ApiLeadActivity {
  id: string;
  leadId: string;
  actorId: string | null;
  type: LeadActivityType;
  summary: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  /** Null when the system acted — an AI call outcome, an automation. */
  actor: { id: string; name: string } | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Access token storage. sessionStorage rather than localStorage so a token does not
 * outlive the browser session, and rather than a cookie because the API is a separate
 * origin and this app talks to it with a bearer header.
 *
 * Populated by the sign-in screen through `authApi.login`.
 */
const TOKEN_KEY = "appsgain.accessToken";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    // Private browsing and locked-down profiles throw on access rather than returning null.
    return null;
  }
}

export function setAccessToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing useful to do — the request will just come back 401 */
  }
}

const REFRESH_KEY = "appsgain.refreshToken";

/**
 * A single in-flight refresh, shared by every request that discovers an expired token.
 *
 * Without this, a screen that fires four requests at once on load would send four
 * refreshes when the token expires. Refresh tokens rotate — the server revokes the old
 * one as it issues a new one — so the second through fourth would arrive holding a token
 * that had just been revoked, and log the user out for no reason. One promise, awaited
 * by all of them.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    let refreshToken: string | null = null;
    try {
      refreshToken = window.sessionStorage.getItem(REFRESH_KEY);
    } catch {
      return false;
    }
    if (!refreshToken) return false;

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
      });
      if (!response.ok) return false;

      const tokens = (await response.json()) as {
        accessToken: string;
        refreshToken: string;
      };
      setAccessToken(tokens.accessToken);
      try {
        window.sessionStorage.setItem(REFRESH_KEY, tokens.refreshToken);
      } catch {
        /* the next expiry will send them to sign-in, which is correct */
      }
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Clears the session and sends the browser to sign-in.
 *
 * A hard assignment rather than the Next router because this can fire from anywhere,
 * including outside React, and because a full reload is the honest response to "your
 * session is gone" — it discards any component state that was built on the old identity.
 */
function endSession(): void {
  setAccessToken(null);
  try {
    window.sessionStorage.removeItem(REFRESH_KEY);
    window.sessionStorage.removeItem(USER_KEY);
  } catch {
    /* nothing useful to do */
  }
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/sign-in")) {
    window.location.assign("/sign-in");
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}, isRetry = false): Promise<T> {
  const token = getAccessToken();

  const response = await fetch(`${API_BASE_URL}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });

  // An expired access token is the ordinary case, not an error: they last fifteen
  // minutes and a session lasts hours. Refresh once and replay the request, so the user
  // never sees "Unauthorized" for the only reason that is not their problem.
  //
  // `isRetry` stops this recursing: if the replay also 401s, the session is genuinely
  // over and the right answer is sign-in, not another refresh.
  if (response.status === 401 && !isRetry && !path.startsWith("/auth/")) {
    if (await refreshAccessToken()) {
      return apiFetch<T>(path, init, true);
    }
    endSession();
    throw new ApiError("Your session has expired. Please sign in again.", 401);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    // Validation failures arrive as one message per field; show them as a sentence.
    const message = Array.isArray(body.message) ? body.message.join("; ") : body.message;
    throw new ApiError(message ?? response.statusText, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * The signed-in user, as the API returns it alongside a login. Cached beside the token
 * so the shell can render a name and role without a round trip, and cleared with it on
 * logout — two values that must never outlive each other.
 */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  tenantName: string;
}

const USER_KEY = "appsgain.user";

export function getSessionUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

function setSessionUser(user: SessionUser | null): void {
  if (typeof window === "undefined") return;
  try {
    if (user) window.sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    else window.sessionStorage.removeItem(USER_KEY);
  } catch {
    /* nothing useful to do */
  }
}

/**
 * Fired in this tab when the cached user changes. `storage` events only reach *other*
 * tabs, so without this a renamed profile would not show in the header until a reload.
 */
export const SESSION_CHANGED_EVENT = "appsgain:session-changed";

/** Merges fields into the cached session user — after a profile edit, say. */
export function updateSessionUser(patch: Partial<SessionUser>): void {
  const current = getSessionUser();
  if (!current) return;
  setSessionUser({ ...current, ...patch });
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

export const authApi = {
  /**
   * Email is unique per workspace, not globally, so the subdomain is part of the
   * credential rather than a nicety. In a deployed environment it comes from the host;
   * on localhost there is no subdomain to read, so the form asks for it.
   */
  async login(input: { subdomain: string; email: string; password: string }) {
    const response = await apiFetch<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      user: SessionUser;
    }>("/auth/login", { method: "POST", body: JSON.stringify(input) });

    setAccessToken(response.accessToken);
    setSessionUser(response.user);
    try {
      window.sessionStorage.setItem(REFRESH_KEY, response.refreshToken);
    } catch {
      /* the session simply will not survive a token expiry */
    }
    return response;
  },

  /**
   * Revokes the refresh token server-side before clearing local state. Clearing only the
   * browser would leave a usable token in the database — a logout that logs nobody out.
   */
  async logout() {
    const refreshToken = (() => {
      try {
        return window.sessionStorage.getItem(REFRESH_KEY);
      } catch {
        return null;
      }
    })();

    if (refreshToken) {
      await apiFetch("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      }).catch(() => {
        // A failed revoke must not strand the user in a signed-in shell; the local
        // clear below still happens and the token expires on its own.
      });
    }

    setAccessToken(null);
    setSessionUser(null);
    try {
      window.sessionStorage.removeItem(REFRESH_KEY);
    } catch {
      /* already gone */
    }
  },

  me() {
    return apiFetch<SessionUser>("/auth/me");
  },

  /** Where this account is currently signed in. */
  sessions(): Promise<
    {
      id: string;
      userAgent: string | null;
      ipAddress: string | null;
      createdAt: string;
      expiresAt: string;
    }[]
  > {
    return apiFetch("/auth/sessions");
  },

  /** Ends one session. Ending the one in use here logs this browser out at the next refresh. */
  async revokeSession(id: string): Promise<void> {
    await apiFetch<void>(`/auth/sessions/${id}`, { method: "DELETE" });
  },

  /** Signs out everywhere, including this browser. */
  async revokeAllSessions(): Promise<void> {
    await apiFetch<void>("/auth/sessions/revoke-all", { method: "POST" });
  },

  /**
   * Changes the signed-in user's own password. The server revokes every session on
   * success — this one included — so the caller has to sign in again afterwards.
   */
  async changePassword(input: { currentPassword: string; newPassword: string }): Promise<void> {
    await apiFetch<void>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};

export interface LeadQuery {
  search?: string;
  status?: LeadStatus[];
  source?: LeadSource[];
  city?: string;
  scoreBand?: "high" | "medium" | "low";
  /** A user id, or "unassigned" for leads with no owner. */
  ownerId?: string;
  createdWithinDays?: number;
  page?: number;
  pageSize?: number;
}

/** One row of `GET /leads/cities` — the Analytics table. */
export interface CityBreakdown {
  city: string;
  leads: number;
  interested: number;
  converted: number;
}

export interface LeadStats {
  total: number;
  newToday: number;
  interested: number;
  demoBooked: number;
  converted: number;
  followUpsDue: number;
}

export const leadsApi = {
  stats(): Promise<LeadStats> {
    return apiFetch<LeadStats>("/leads/stats");
  },

  /** Leads per source, for the dashboard. */
  sources(): Promise<{ source: LeadSource; count: number }[]> {
    return apiFetch<{ source: LeadSource; count: number }[]>("/leads/sources");
  },

  /** Leads per status — the Analytics funnel. */
  statuses(): Promise<{ status: LeadStatus; count: number }[]> {
    return apiFetch<{ status: LeadStatus; count: number }[]>("/leads/statuses");
  },

  /** The busiest cities, with the interested and converted counts inside each. */
  cities(): Promise<CityBreakdown[]> {
    return apiFetch<CityBreakdown[]>("/leads/cities");
  },

  list(query: LeadQuery = {}): Promise<PaginatedLeads> {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.status?.length) params.set("status", query.status.join(","));
    if (query.source?.length) params.set("source", query.source.join(","));
    if (query.city) params.set("city", query.city);
    if (query.scoreBand) params.set("scoreBand", query.scoreBand);
    if (query.ownerId) params.set("ownerId", query.ownerId);
    if (query.createdWithinDays) params.set("createdWithinDays", String(query.createdWithinDays));
    if (query.page) params.set("page", String(query.page));
    if (query.pageSize) params.set("pageSize", String(query.pageSize));

    const qs = params.toString();
    return apiFetch<PaginatedLeads>(`/leads${qs ? `?${qs}` : ""}`);
  },

  get(id: string): Promise<ApiLead> {
    return apiFetch<ApiLead>(`/leads/${id}`);
  },

  create(input: { name: string; phone: string; city?: string }): Promise<ApiLead> {
    return apiFetch<ApiLead>("/leads", { method: "POST", body: JSON.stringify(input) });
  },

  update(
    id: string,
    patch: Partial<{
      name: string;
      phone: string;
      city: string;
      source: LeadSource;
      status: LeadStatus;
      score: number;
      customFields: Record<string, unknown>;
    }>,
  ) {
    return apiFetch<ApiLead>(`/leads/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },

  /** The lead's timeline, newest first. */
  activity(id: string): Promise<ApiLeadActivity[]> {
    return apiFetch<ApiLeadActivity[]>(`/leads/${id}/activity`);
  },

  remove(id: string): Promise<void> {
    return apiFetch<void>(`/leads/${id}`, { method: "DELETE" });
  },

  import(input: {
    csv: string;
    mapping: Record<string, string>;
    source?: LeadSource;
    dryRun?: boolean;
  }): Promise<ImportSummary> {
    return apiFetch<ImportSummary>("/leads/import", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};

/** Is the API up? Used to decide between live data and seed data, and cached per page load. */
let reachable: Promise<boolean> | undefined;

export function isApiReachable(): Promise<boolean> {
  reachable ??= fetch(`${API_BASE_URL}/api/health`, { cache: "no-store" })
    .then((r) => r.ok)
    .catch(() => false);
  return reachable;
}

// ── campaigns ───────────────────────────────────────────────────────────────────────

export type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";
export type CampaignType = "AI_CALLING" | "EMAIL" | "WHATSAPP" | "MANUAL" | "MULTI_CHANNEL";

export interface CampaignStats {
  leads: number;
  calls: number;
  connected: number;
  interested: number;
  demoBooked: number;
  converted: number;
  followUps: number;
  creditsUsed: number;
  connectRate: number;
  conversionRate: number;
}

export interface ApiCampaign {
  id: string;
  name: string;
  description: string | null;
  type: CampaignType;
  status: CampaignStatus;
  targetAudience: string | null;
  aiAgentId: string | null;
  callScript: string | null;
  startDate: string | null;
  endDate: string | null;
  dailyCallLimit: number | null;
  callWindowStart: number | null;
  callWindowEnd: number | null;
  callDays: number[];
  timezone: string;
  language: string;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  stats: CampaignStats;
}

export interface CampaignOverview {
  totalCampaigns: number;
  activeCampaigns: number;
  leadsReached: number;
  callsMade: number;
  conversions: number;
  statusBreakdown: { status: CampaignStatus; count: number }[];
  series: { date: string; calls: number; connected: number; conversions: number }[];
}

export interface CampaignQuery {
  search?: string;
  status?: CampaignStatus[];
  type?: CampaignType[];
  page?: number;
  pageSize?: number;
}

export interface PaginatedCampaigns {
  data: ApiCampaign[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const campaignsApi = {
  overview(): Promise<CampaignOverview> {
    return apiFetch<CampaignOverview>("/campaigns/overview");
  },

  list(query: CampaignQuery = {}): Promise<PaginatedCampaigns> {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.status?.length) params.set("status", query.status.join(","));
    if (query.type?.length) params.set("type", query.type.join(","));
    if (query.page) params.set("page", String(query.page));
    if (query.pageSize) params.set("pageSize", String(query.pageSize));
    const qs = params.toString();
    return apiFetch<PaginatedCampaigns>(`/campaigns${qs ? `?${qs}` : ""}`);
  },

  get(id: string): Promise<ApiCampaign> {
    return apiFetch<ApiCampaign>(`/campaigns/${id}`);
  },

  create(input: {
    name: string;
    description?: string;
    type?: CampaignType;
    aiAgentId?: string;
    targetAudience?: string;
  }) {
    return apiFetch<ApiCampaign>("/campaigns", { method: "POST", body: JSON.stringify(input) });
  },

  update(id: string, patch: Partial<{ name: string; description: string; callScript: string }>) {
    return apiFetch<ApiCampaign>(`/campaigns/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  /**
   * One method for every lifecycle move. The server owns which transitions are legal and
   * refuses the rest with a reason, so the UI does not carry a second copy of that table
   * and cannot disagree with it.
   */
  transition(id: string, action: "activate" | "pause" | "complete" | "archive") {
    return apiFetch<ApiCampaign>(`/campaigns/${id}/${action}`, { method: "POST" });
  },

  duplicate(id: string): Promise<ApiCampaign> {
    return apiFetch<ApiCampaign>(`/campaigns/${id}/duplicate`, { method: "POST" });
  },

  remove(id: string): Promise<void> {
    return apiFetch<void>(`/campaigns/${id}`, { method: "DELETE" });
  },

  addLeads(id: string, leadIds: string[]): Promise<{ added: number; skipped: number }> {
    return apiFetch<{ added: number; skipped: number }>(`/campaigns/${id}/leads`, {
      method: "POST",
      body: JSON.stringify({ leadIds }),
    });
  },
};

// ── calls ───────────────────────────────────────────────────────────────────────────

export type CallStatus =
  | "QUEUED" | "DIALING" | "RINGING" | "CONNECTED" | "ON_HOLD" | "TRANSFERRING"
  | "COMPLETED" | "FAILED" | "BUSY" | "NO_ANSWER" | "VOICEMAIL" | "CANCELLED";

export type CallOutcome =
  | "INTERESTED" | "FOLLOW_UP" | "NOT_INTERESTED" | "NO_ANSWER"
  | "WRONG_NUMBER" | "DEMO_BOOKED" | "CALLBACK_REQUESTED" | "DO_NOT_CALL";

/** A call with the rows it belongs to, as Call History renders it. */
export interface ApiCallDetailed extends ApiCall {
  lead: { id: string; name: string; contactPerson: string | null; city: string | null } | null;
  aiAgent: { id: string; name: string; language: string } | null;
  campaign: { id: string; name: string } | null;
  recording: { id: string; durationSeconds: number } | null;
  transcript: { id: string; summary: string | null; sentiment: string | null } | null;
}

export interface CallHistoryQuery {
  search?: string;
  campaignId?: string;
  agentId?: string;
  status?: CallStatus[];
  outcome?: CallOutcome[];
  from?: string;
  to?: string;
  duration?: "short" | "medium" | "long";
  hasRecording?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CallHistoryStats {
  total: number;
  connected: number;
  interested: number;
  missed: number;
  avgDurationSeconds: number;
  totalCredits: number;
}

export interface ApiCall {
  id: string;
  leadId: string;
  campaignId: string | null;
  aiAgentId: string | null;
  phone: string;
  status: CallStatus;
  outcome: CallOutcome | null;
  durationSeconds: number | null;
  provider: string | null;
  failureReason: string | null;
  creditsUsed: number;
  queuedAt: string;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
}

export interface CallingOverview {
  inFlight: number;
  queued: number;
  today: { placed: number; connected: number; failed: number };
  statusBreakdown: { status: CallStatus; count: number }[];
  outcomeBreakdown: { outcome: CallOutcome; count: number }[];
  creditsSpentToday: number;
  callingEnabled: boolean;
  /** True when no real calls are being placed. The console must say so. */
  usingSandbox: boolean;
}

export interface GateExplanation {
  allowed: boolean;
  reasons: string[];
  messages: string[];
}

export interface DialerRunSummary {
  campaignId: string;
  campaignName: string;
  considered: number;
  placed: number;
  blocked: number;
  blockedBy: { reason: string; count: number }[];
  haltedForCredits: boolean;
}

export const callsApi = {
  overview(): Promise<CallingOverview> {
    return apiFetch<CallingOverview>("/calls/overview");
  },

  active(): Promise<ApiCall[]> {
    return apiFetch<ApiCall[]>("/calls/active");
  },

  list(query: CallHistoryQuery & { leadId?: string } = {}) {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.campaignId) params.set("campaignId", query.campaignId);
    if (query.agentId) params.set("agentId", query.agentId);
    if (query.leadId) params.set("leadId", query.leadId);
    if (query.status?.length) params.set("status", query.status.join(","));
    if (query.outcome?.length) params.set("outcome", query.outcome.join(","));
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
    if (query.duration) params.set("duration", query.duration);
    if (query.hasRecording !== undefined) params.set("hasRecording", String(query.hasRecording));
    if (query.page) params.set("page", String(query.page));
    if (query.pageSize) params.set("pageSize", String(query.pageSize));
    const qs = params.toString();
    return apiFetch<{
      data: ApiCallDetailed[];
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    }>(`/calls${qs ? `?${qs}` : ""}`);
  },

  historyStats(range: { from?: string; to?: string } = {}): Promise<CallHistoryStats> {
    const params = new URLSearchParams();
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    const qs = params.toString();
    return apiFetch<CallHistoryStats>(`/calls/stats${qs ? `?${qs}` : ""}`);
  },

  /** Calls per outcome — all time unless a range is given. */
  outcomes(range: { from?: string; to?: string } = {}) {
    const params = new URLSearchParams();
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    const qs = params.toString();
    return apiFetch<{ outcome: CallOutcome; count: number }[]>(
      `/calls/outcomes${qs ? `?${qs}` : ""}`,
    );
  },

  /**
   * Calls per hour of the day over the last 30 days, bucketed in the workspace's own
   * timezone — which is returned alongside so a chart can say which clock it is using.
   */
  byHour(): Promise<{
    timezone: string;
    hours: { hour: number; calls: number; connected: number }[];
  }> {
    return apiFetch<{
      timezone: string;
      hours: { hour: number; calls: number; connected: number }[];
    }>("/calls/by-hour");
  },

  explainGates(leadId: string, campaignId?: string): Promise<GateExplanation> {
    const qs = campaignId ? `?campaignId=${campaignId}` : "";
    return apiFetch<GateExplanation>(`/calls/gates/${leadId}${qs}`);
  },

  place(leadId: string, campaignId?: string) {
    return apiFetch<{ placed: boolean; callId?: string; blockedBy?: string[]; message?: string }>(
      "/calls",
      { method: "POST", body: JSON.stringify({ leadId, campaignId }) },
    );
  },

  /** Advances in-flight calls. The console polls this so the board does not go stale. */
  syncActive(): Promise<{ swept: number; settled: number }> {
    return apiFetch<{ swept: number; settled: number }>("/calls/sync-active", { method: "POST" });
  },

  hangUp(id: string): Promise<ApiCall> {
    return apiFetch<ApiCall>(`/calls/${id}/hangup`, { method: "POST" });
  },

  runDialer(campaignId: string): Promise<DialerRunSummary> {
    return apiFetch<DialerRunSummary>(`/calls/dialer/run/${campaignId}`, { method: "POST" });
  },

  runDialerAll(): Promise<DialerRunSummary[]> {
    return apiFetch<DialerRunSummary[]>("/calls/dialer/run", { method: "POST" });
  },

  dialerPreview(campaignId: string) {
    return apiFetch<{
      due: number;
      pending: number;
      exhausted: number;
      skipped: number;
      completed: number;
    }>(`/calls/dialer/preview/${campaignId}`);
  },
};

// ── transcripts ─────────────────────────────────────────────────────────────────────

export interface TranscriptSegment {
  id: string;
  transcriptId: string;
  sequence: number;
  speaker: "AI_AGENT" | "HUMAN_AGENT" | "LEAD" | "SUPERVISOR";
  speakerLabel: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number | null;
}

export type Sentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

/** An utterance that matched a search, so a result can show why it matched. */
export interface TranscriptMatch {
  segmentId: string;
  speakerLabel: string;
  text: string;
  startMs: number;
}

export interface ApiTranscript {
  id: string;
  callId: string;
  language: string;
  confidence: number | null;
  provider: string | null;
  summary: string | null;
  sentiment: Sentiment | null;
  intent: string | null;
  objections: unknown;
  buyingSignals: unknown;
  topics: unknown;
  actionItems: unknown;
  suggestedOutcome: CallOutcome | null;
  analysedAt: string | null;
  createdAt: string;
  segmentCount?: number;
  matches?: TranscriptMatch[];
  call: {
    id: string;
    phone: string;
    startedAt: string | null;
    durationSeconds: number | null;
    outcome: CallOutcome | null;
    lead: { id: string; name: string; contactPerson: string | null; city: string | null } | null;
    aiAgent: { id: string; name: string; language: string } | null;
    campaign: { id: string; name: string } | null;
    recording: { id: string; durationSeconds: number } | null;
  } | null;
}

export interface TranscriptStats {
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  analysed: number;
}

export const transcriptsApi = {
  list(query: {
    search?: string;
    campaignId?: string;
    agentId?: string;
    outcome?: CallOutcome[];
    sentiment?: Sentiment[];
    page?: number;
    pageSize?: number;
  } = {}) {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.campaignId) params.set("campaignId", query.campaignId);
    if (query.agentId) params.set("agentId", query.agentId);
    if (query.outcome?.length) params.set("outcome", query.outcome.join(","));
    if (query.sentiment?.length) params.set("sentiment", query.sentiment.join(","));
    if (query.page) params.set("page", String(query.page));
    if (query.pageSize) params.set("pageSize", String(query.pageSize));
    const qs = params.toString();
    return apiFetch<{
      data: ApiTranscript[];
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    }>(`/transcripts${qs ? `?${qs}` : ""}`);
  },

  stats(): Promise<TranscriptStats> {
    return apiFetch<TranscriptStats>("/transcripts/stats");
  },

  get(id: string): Promise<ApiTranscript> {
    return apiFetch<ApiTranscript>(`/transcripts/${id}`);
  },

  /** Fetched separately from the list — a page of transcripts should not carry every
   *  utterance of every one of them. */
  segments(id: string): Promise<TranscriptSegment[]> {
    return apiFetch<TranscriptSegment[]>(`/transcripts/${id}/segments`);
  },

  /** Rendered server-side, so copy and download produce identical text. */
  async text(id: string): Promise<string> {
    const response = await fetch(`${API_BASE_URL}/api/transcripts/${id}/text`, {
      headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
      cache: "no-store",
    });
    if (!response.ok) throw new ApiError("Could not load the transcript text", response.status);
    return response.text();
  },
};

// ── recordings ──────────────────────────────────────────────────────────────────────

export interface ApiRecording {
  id: string;
  callId: string;
  storageKey: string;
  storageBucket: string;
  mimeType: string;
  /** Bytes. Narrowed from the database's BigInt — a recording is megabytes, not more. */
  sizeBytes: number;
  durationSeconds: number;
  expiresAt: string | null;
  createdAt: string;
  call: {
    id: string;
    phone: string;
    startedAt: string | null;
    outcome: CallOutcome | null;
    lead: { id: string; name: string; contactPerson: string | null } | null;
    aiAgent: { id: string; name: string } | null;
    campaign: { id: string; name: string } | null;
    transcript: { id: string } | null;
  } | null;
}

export interface RecordingStats {
  total: number;
  totalDurationSeconds: number;
  storageBytes: number;
  expiringSoon: number;
}

export const recordingsApi = {
  list(query: {
    search?: string;
    campaignId?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.campaignId) params.set("campaignId", query.campaignId);
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
    if (query.page) params.set("page", String(query.page));
    if (query.pageSize) params.set("pageSize", String(query.pageSize));
    const qs = params.toString();
    return apiFetch<{
      data: ApiRecording[];
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    }>(`/recordings${qs ? `?${qs}` : ""}`);
  },

  stats(): Promise<RecordingStats> {
    return apiFetch<RecordingStats>("/recordings/stats");
  },

  /** A short-lived link. Minted on demand rather than embedded in the list, so a URL
   *  does not sit in a browser history long after it should have expired. */
  signedUrl(id: string): Promise<{ url: string; expiresAt: string }> {
    return apiFetch<{ url: string; expiresAt: string }>(`/recordings/${id}/url`);
  },

  remove(id: string): Promise<void> {
    return apiFetch<void>(`/recordings/${id}`, { method: "DELETE" });
  },
};

// ── sales notes ─────────────────────────────────────────────────────────────────────

export type NoteType =
  | "GENERAL" | "FOLLOW_UP" | "PRICING" | "DEMO" | "OBJECTION"
  | "INQUIRY" | "POSITIVE" | "NEGATIVE";

export interface ApiNote {
  id: string;
  leadId: string;
  callId: string | null;
  campaignId: string | null;
  authorId: string | null;
  title: string | null;
  content: string;
  type: NoteType;
  sentiment: Sentiment | null;
  /** False once a human has edited it — the text is then theirs, not the model's. */
  isAiGenerated: boolean;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lead: { id: string; name: string; contactPerson: string | null; city: string | null } | null;
  author: { id: string; name: string } | null;
  campaign: { id: string; name: string } | null;
  call: {
    id: string;
    startedAt: string | null;
    durationSeconds: number | null;
    outcome: CallOutcome | null;
    aiAgent: { id: string; name: string } | null;
  } | null;
}

export interface NoteStats {
  total: number;
  positive: number;
  aiGenerated: number;
  edited: number;
  byType: { type: NoteType; count: number }[];
}

export const notesApi = {
  list(query: {
    search?: string;
    leadId?: string;
    campaignId?: string;
    type?: NoteType[];
    sentiment?: Sentiment[];
    aiOnly?: boolean;
    page?: number;
    pageSize?: number;
  } = {}) {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.leadId) params.set("leadId", query.leadId);
    if (query.campaignId) params.set("campaignId", query.campaignId);
    if (query.type?.length) params.set("type", query.type.join(","));
    if (query.sentiment?.length) params.set("sentiment", query.sentiment.join(","));
    if (query.aiOnly !== undefined) params.set("aiOnly", String(query.aiOnly));
    if (query.page) params.set("page", String(query.page));
    if (query.pageSize) params.set("pageSize", String(query.pageSize));
    const qs = params.toString();
    return apiFetch<{
      data: ApiNote[];
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    }>(`/notes${qs ? `?${qs}` : ""}`);
  },

  stats(): Promise<NoteStats> {
    return apiFetch<NoteStats>("/notes/stats");
  },

  create(input: {
    leadId: string;
    callId?: string;
    campaignId?: string;
    title?: string;
    content: string;
    type?: NoteType;
    sentiment?: Sentiment;
  }): Promise<ApiNote> {
    return apiFetch<ApiNote>("/notes", { method: "POST", body: JSON.stringify(input) });
  },

  update(
    id: string,
    patch: { title?: string; content?: string; type?: NoteType; sentiment?: Sentiment },
  ): Promise<ApiNote> {
    return apiFetch<ApiNote>(`/notes/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },

  remove(id: string): Promise<void> {
    return apiFetch<void>(`/notes/${id}`, { method: "DELETE" });
  },
};

// ── follow-ups ──────────────────────────────────────────────────────────────────────

export type FollowUpChannel = "CALL" | "WHATSAPP" | "EMAIL" | "MEETING";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type StoredFollowUpStatus = "PENDING" | "COMPLETED" | "CANCELLED";

/**
 * What the queue shows. TODAY and OVERDUE are not stored — the API derives them from
 * `dueAt` against the *workspace's* clock and returns the answer as `derivedStatus`, so
 * two people in different timezones never disagree about what is late. Never recompute
 * this in the browser.
 */
export type DerivedFollowUpStatus = StoredFollowUpStatus | "TODAY" | "OVERDUE";

export interface ApiFollowUp {
  id: string;
  leadId: string;
  campaignId: string | null;
  callId: string | null;
  assigneeId: string | null;
  dueAt: string;
  channel: FollowUpChannel;
  priority: Priority;
  status: StoredFollowUpStatus;
  derivedStatus: DerivedFollowUpStatus;
  notes: string | null;
  remindAt: string | null;
  reminderSentAt: string | null;
  completedAt: string | null;
  isAiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
  lead: {
    id: string;
    name: string;
    contactPerson: string | null;
    phone: string;
    city: string | null;
    status: LeadStatus;
    score: number;
  } | null;
  campaign: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  call: {
    id: string;
    startedAt: string | null;
    durationSeconds: number | null;
    outcome: CallOutcome | null;
    aiAgent: { id: string; name: string; language: string } | null;
  } | null;
}

export interface FollowUpStats {
  total: number;
  pending: number;
  completed: number;
  cancelled: number;
  overdue: number;
  today: number;
}

export interface FollowUpQuery {
  search?: string;
  status?: DerivedFollowUpStatus[];
  channel?: FollowUpChannel[];
  priority?: Priority[];
  assigneeId?: string;
  campaignId?: string;
  leadId?: string;
  dueWithin?: "today" | "tomorrow" | "week" | "past";
  sort?: "dueAt" | "priority" | "createdAt";
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export const followUpsApi = {
  list(query: FollowUpQuery = {}) {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.status?.length) params.set("status", query.status.join(","));
    if (query.channel?.length) params.set("channel", query.channel.join(","));
    if (query.priority?.length) params.set("priority", query.priority.join(","));
    if (query.assigneeId) params.set("assigneeId", query.assigneeId);
    if (query.campaignId) params.set("campaignId", query.campaignId);
    if (query.leadId) params.set("leadId", query.leadId);
    if (query.dueWithin) params.set("dueWithin", query.dueWithin);
    if (query.sort) params.set("sort", query.sort);
    if (query.direction) params.set("direction", query.direction);
    if (query.page) params.set("page", String(query.page));
    if (query.pageSize) params.set("pageSize", String(query.pageSize));
    const qs = params.toString();
    return apiFetch<{
      data: ApiFollowUp[];
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    }>(`/follow-ups${qs ? `?${qs}` : ""}`);
  },

  stats(): Promise<FollowUpStats> {
    return apiFetch<FollowUpStats>("/follow-ups/stats");
  },

  get(id: string): Promise<ApiFollowUp> {
    return apiFetch<ApiFollowUp>(`/follow-ups/${id}`);
  },

  create(input: {
    leadId: string;
    campaignId?: string;
    callId?: string;
    assigneeId?: string;
    dueAt: string;
    channel?: FollowUpChannel;
    priority?: Priority;
    notes?: string;
    remindAt?: string;
  }): Promise<ApiFollowUp> {
    return apiFetch<ApiFollowUp>("/follow-ups", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  update(
    id: string,
    patch: {
      dueAt?: string;
      assigneeId?: string | null;
      channel?: FollowUpChannel;
      priority?: Priority;
      notes?: string;
      remindAt?: string | null;
      status?: StoredFollowUpStatus;
    },
  ): Promise<ApiFollowUp> {
    return apiFetch<ApiFollowUp>(`/follow-ups/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  /** Bulk complete. Rows already completed are left alone rather than re-stamped. */
  completeMany(ids: string[]): Promise<{ completed: number }> {
    return apiFetch<{ completed: number }>("/follow-ups/complete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
  },

  remove(id: string): Promise<void> {
    return apiFetch<void>(`/follow-ups/${id}`, { method: "DELETE" });
  },
};

// ── workspace members ───────────────────────────────────────────────────────────────

export type UserStatus = "ACTIVE" | "INVITED" | "DISABLED";

export interface WorkspaceMember {
  id: string;
  email: string;
  name: string;
  role: string;
  phone: string | null;
  avatarUrl: string | null;
  language: string;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
}

export const usersApi = {
  list(query: { search?: string; role?: string[]; status?: UserStatus[] } = {}) {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.role?.length) params.set("role", query.role.join(","));
    if (query.status?.length) params.set("status", query.status.join(","));
    const qs = params.toString();
    return apiFetch<WorkspaceMember[]>(`/users${qs ? `?${qs}` : ""}`);
  },

  get(id: string): Promise<WorkspaceMember> {
    return apiFetch<WorkspaceMember>(`/users/${id}`);
  },

  update(
    id: string,
    patch: { role?: string; status?: UserStatus; name?: string; phone?: string },
  ): Promise<WorkspaceMember> {
    return apiFetch<WorkspaceMember>(`/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  /** Disables the account. Their calls, notes and follow-ups keep naming them. */
  deactivate(id: string): Promise<WorkspaceMember> {
    return apiFetch<WorkspaceMember>(`/users/${id}`, { method: "DELETE" });
  },
};

// ── calendar ────────────────────────────────────────────────────────────────────────

export type CalendarEventType = "FOLLOW_UP" | "DEMO" | "MEETING" | "CALL" | "REMINDER";

export interface ApiCalendarEvent {
  id: string;
  title: string;
  description: string | null;
  type: CalendarEventType;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
  ownerId: string | null;
  leadId: string | null;
  campaignId: string | null;
  followUpId: string | null;
  externalProvider: string | null;
  externalId: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string } | null;
  lead: { id: string; name: string; phone: string; city: string | null } | null;
  campaign: { id: string; name: string } | null;
  followUp: {
    id: string;
    status: StoredFollowUpStatus;
    dueAt: string;
    channel: FollowUpChannel;
  } | null;
}

export interface CalendarStats {
  today: number;
  thisWeek: number;
  demos: number;
  followUps: number;
}

export const calendarApi = {
  /**
   * Events overlapping `[from, to)`. The window is required — the API refuses an
   * unbounded read, because a calendar that quietly fetches every event a workspace has
   * ever had works fine in a demo and falls over in year two.
   */
  list(query: {
    from: string;
    to: string;
    type?: CalendarEventType[];
    ownerId?: string;
    leadId?: string;
    campaignId?: string;
    search?: string;
  }) {
    const params = new URLSearchParams({ from: query.from, to: query.to });
    if (query.type?.length) params.set("type", query.type.join(","));
    if (query.ownerId) params.set("ownerId", query.ownerId);
    if (query.leadId) params.set("leadId", query.leadId);
    if (query.campaignId) params.set("campaignId", query.campaignId);
    if (query.search) params.set("search", query.search);
    return apiFetch<ApiCalendarEvent[]>(`/calendar/events?${params.toString()}`);
  },

  stats(): Promise<CalendarStats> {
    return apiFetch<CalendarStats>("/calendar/stats");
  },

  get(id: string): Promise<ApiCalendarEvent> {
    return apiFetch<ApiCalendarEvent>(`/calendar/events/${id}`);
  },

  create(input: {
    title: string;
    description?: string;
    type?: CalendarEventType;
    startAt: string;
    endAt: string;
    allDay?: boolean;
    location?: string;
    ownerId?: string;
    leadId?: string;
    campaignId?: string;
  }): Promise<ApiCalendarEvent> {
    return apiFetch<ApiCalendarEvent>("/calendar/events", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  update(
    id: string,
    patch: {
      title?: string;
      description?: string;
      type?: CalendarEventType;
      startAt?: string;
      endAt?: string;
      allDay?: boolean;
      location?: string;
      ownerId?: string | null;
    },
  ): Promise<ApiCalendarEvent> {
    return apiFetch<ApiCalendarEvent>(`/calendar/events/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  remove(id: string): Promise<void> {
    return apiFetch<void>(`/calendar/events/${id}`, { method: "DELETE" });
  },
};

// ── AI agents ───────────────────────────────────────────────────────────────────────

export interface QualificationQuestion {
  id: string;
  question: string;
  captures?: string;
  required: boolean;
}

export interface ObjectionResponse {
  id: string;
  objection: string;
  response: string;
}

export interface ApiAgent {
  id: string;
  name: string;
  avatarUrl: string | null;
  language: string;
  accent: string | null;
  gender: string | null;
  voiceId: string | null;
  personality: string | null;
  systemPrompt: string | null;
  openingMessage: string | null;
  qualificationQuestions: QualificationQuestion[] | null;
  objectionHandling: ObjectionResponse[] | null;
  closingInstructions: string | null;
  knowledgeBase: string | null;
  transferRules: Record<string, unknown> | null;
  dispositionRules: Record<string, unknown> | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count: { calls: number; campaigns: number };
}

/** One row of `GET /agents/performance` — the Analytics comparison. */
export interface AgentPerformanceRow {
  id: string;
  name: string;
  language: string;
  calls: number;
  interested: number;
}

export interface AgentStats {
  total: number;
  active: number;
  callsPlaced: number;
  connectRate: number;
}

export interface AgentInput {
  name?: string;
  language?: string;
  accent?: string;
  gender?: string;
  voiceId?: string;
  personality?: string;
  systemPrompt?: string;
  openingMessage?: string;
  qualificationQuestions?: QualificationQuestion[];
  objectionHandling?: ObjectionResponse[];
  closingInstructions?: string;
  knowledgeBase?: string;
  isActive?: boolean;
}

/** The languages the API will accept. Anything else is refused at the edge. */
export const AGENT_LANGUAGES: { value: string; label: string }[] = [
  { value: "hi-IN", label: "Hindi (India)" },
  { value: "en-IN", label: "English (India)" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "mr-IN", label: "Marathi" },
  { value: "gu-IN", label: "Gujarati" },
  { value: "ta-IN", label: "Tamil" },
  { value: "te-IN", label: "Telugu" },
  { value: "kn-IN", label: "Kannada" },
  { value: "bn-IN", label: "Bengali" },
  { value: "pa-IN", label: "Punjabi" },
];

/** "hi-IN" -> "Hindi": the short form persona labels use, as in "Anjali (Hindi)". */
export function shortLanguageName(code: string): string {
  const label = AGENT_LANGUAGES.find((language) => language.value === code)?.label ?? code;
  return label.replace(/\s*\(.*\)$/, "");
}

export const agentsApi = {
  list(query: { search?: string; activeOnly?: boolean; language?: string } = {}) {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.activeOnly !== undefined) params.set("activeOnly", String(query.activeOnly));
    if (query.language) params.set("language", query.language);
    const qs = params.toString();
    return apiFetch<ApiAgent[]>(`/agents${qs ? `?${qs}` : ""}`);
  },

  stats(): Promise<AgentStats> {
    return apiFetch<AgentStats>("/agents/stats");
  },

  /** Calls and interested outcomes per agent, busiest first. */
  performance(): Promise<AgentPerformanceRow[]> {
    return apiFetch<AgentPerformanceRow[]>("/agents/performance");
  },

  get(id: string): Promise<ApiAgent> {
    return apiFetch<ApiAgent>(`/agents/${id}`);
  },

  create(input: AgentInput & { name: string }): Promise<ApiAgent> {
    return apiFetch<ApiAgent>("/agents", { method: "POST", body: JSON.stringify(input) });
  },

  update(id: string, patch: AgentInput): Promise<ApiAgent> {
    return apiFetch<ApiAgent>(`/agents/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },

  /** The copy arrives deactivated, so a live campaign cannot pick up an unread script. */
  duplicate(id: string): Promise<ApiAgent> {
    return apiFetch<ApiAgent>(`/agents/${id}/duplicate`, { method: "POST" });
  },

  remove(id: string): Promise<void> {
    return apiFetch<void>(`/agents/${id}`, { method: "DELETE" });
  },
};

// ── workspace ───────────────────────────────────────────────────────────────────────

export const workspaceApi = {
  /**
   * Self-serve signup. Public: one request creates the workspace and its OWNER together,
   * so there is never a workspace nobody can sign in to.
   */
  create(input: CreateWorkspaceRequest): Promise<CreateWorkspaceResponse> {
    return apiFetch<CreateWorkspaceResponse>("/workspace", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  /** The caller's own workspace: name, sign-in subdomain, industry, status. */
  mine(): Promise<TenantSummary> {
    return apiFetch<TenantSummary>("/workspace");
  },

  /** Renames the workspace or changes its industry. The subdomain is not editable. */
  update(patch: { name?: string; industryVertical?: string | null }): Promise<TenantSummary> {
    return apiFetch<TenantSummary>("/workspace", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },
};

// ── credits ─────────────────────────────────────────────────────────────────────────

export interface CreditWallet {
  balance: number;
  lowBalanceThreshold: number | null;
  isLow: boolean;
}

/** One row of the credit ledger, as Settings → Billing lists it. */
export interface CreditTransaction {
  id: string;
  type: "CREDIT" | "DEBIT";
  operation: string;
  amount: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
}

export const creditsApi = {
  wallet(): Promise<CreditWallet> {
    return apiFetch<CreditWallet>("/credits");
  },

  /** The ledger, newest first. */
  history(page = 1, pageSize = 10) {
    return apiFetch<{
      data: CreditTransaction[];
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    }>(`/credits/history?page=${page}&pageSize=${pageSize}`);
  },

  /** Credits spent per operation over the last 30 days. Debits only. */
  usage(): Promise<{ operation: string; credits: number }[]> {
    return apiFetch<{ operation: string; credits: number }[]>("/credits/usage");
  },
};

// ── call settings ───────────────────────────────────────────────────────────────────

export type VoicemailBehavior = "HANG_UP" | "LEAVE_MESSAGE" | "RETRY_LATER";

/**
 * The workspace's calling rules — the same record the dialer and the calling gates read
 * before every call.
 */
export interface CallSettings {
  id: string;
  callingEnabled: boolean;
  defaultAiAgentId: string | null;
  defaultLanguage: string;
  defaultVoiceId: string | null;
  timezone: string;
  callerId: string | null;
  recordingEnabled: boolean;
  transcriptionEnabled: boolean;
  aiAnalysisEnabled: boolean;
  /** Minutes from midnight in `timezone`. */
  callWindowStart: number;
  callWindowEnd: number;
  /** 0 is Sunday. */
  callDays: number[];
  maxCallsPerDay: number | null;
  maxAttemptsPerLead: number;
  retryDelayMinutes: number;
  ringTimeoutSeconds: number;
  maxCallSeconds: number;
  silenceTimeoutSeconds: number;
  voicemailBehavior: VoicemailBehavior;
  dncEnabled: boolean;
  blockedNumbers: string[];
  allowedCountries: string[];
  recordingAnnouncement: boolean;
  consentRequired: boolean;
  minimumBalanceRequired: number;
  stopWhenCreditsLow: boolean;
  lowCreditThreshold: number;
  updatedAt: string;
}

export type CallSettingsPatch = Partial<Omit<CallSettings, "id" | "updatedAt">>;

export const callSettingsApi = {
  get(): Promise<CallSettings> {
    return apiFetch<CallSettings>("/call-settings");
  },

  update(patch: CallSettingsPatch): Promise<CallSettings> {
    return apiFetch<CallSettings>("/call-settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },
};

// ── notification preferences ────────────────────────────────────────────────────────

export type NotificationChannel = "IN_APP" | "EMAIL" | "SMS" | "WHATSAPP" | "PUSH";
export type NotificationFrequency = "INSTANT" | "DAILY_DIGEST" | "WEEKLY_DIGEST";

export interface NotificationPreference {
  type: string;
  channels: NotificationChannel[];
  frequency: NotificationFrequency;
}

/** One notification as the bell shows it. */
export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  linkPath: string | null;
  read: boolean;
  createdAt: string;
  /** Addressed to the whole workspace rather than to you. */
  workspaceWide: boolean;
}

export const notificationsApi = {
  list(options: { unreadOnly?: boolean; limit?: number } = {}): Promise<AppNotification[]> {
    const params = new URLSearchParams();
    if (options.unreadOnly) params.set("unreadOnly", "true");
    if (options.limit) params.set("limit", String(options.limit));
    const qs = params.toString();
    return apiFetch<AppNotification[]>(`/notifications${qs ? `?${qs}` : ""}`);
  },

  /** Its own endpoint because the header asks for this on a timer and nothing else. */
  async unreadCount(): Promise<number> {
    const { count } = await apiFetch<{ count: number }>("/notifications/unread-count");
    return count;
  },

  async markRead(id: string): Promise<void> {
    await apiFetch<void>(`/notifications/${id}/read`, { method: "PATCH" });
  },

  markAllRead(): Promise<{ updated: number }> {
    return apiFetch<{ updated: number }>("/notifications/read-all", { method: "POST" });
  },

  preferences(): Promise<NotificationPreference[]> {
    return apiFetch<NotificationPreference[]>("/notification-preferences");
  },

  savePreferences(preferences: NotificationPreference[]): Promise<NotificationPreference[]> {
    return apiFetch<NotificationPreference[]>("/notification-preferences", {
      method: "PATCH",
      body: JSON.stringify({ preferences }),
    });
  },
};

// ── integrations (read-only: provider health) ───────────────────────────────────────

export interface ProviderHealth {
  /** "TELEPHONY", "LLM", "SPEECH_TO_TEXT", "TEXT_TO_SPEECH". */
  kind: string;
  /** The adapter actually in use — the sandbox one when nothing is configured. */
  provider: string;
  configured: boolean;
  reachable: boolean;
  /** Present when the check failed. Safe to show: never contains secrets. */
  detail?: string;
  checkedAt: string;
  configuredProvider: string | null;
  usingSandbox: boolean;
}

export const providersApi = {
  health(): Promise<{ encryptionReady: boolean; providers: ProviderHealth[] }> {
    return apiFetch<{ encryptionReady: boolean; providers: ProviderHealth[] }>(
      "/providers/health",
    );
  },
};
