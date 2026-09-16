"use client";

import {
  ApiError,
  callsApi,
  followUpsApi,
  isApiReachable,
  leadsApi,
  notesApi,
  shortLanguageName,
  type ApiCallDetailed,
  type ApiFollowUp,
  type ApiLead,
  type ApiLeadActivity,
  type ApiNote,
  type FollowUpChannel,
  type LeadActivityType,
  type LeadQuery,
} from "./api-client";
import { leads as seedLeads } from "./mock-leads";
import type { ActivityEvent, ActivityKind, LeadCall, LeadDetail, LeadNote } from "./types";

/**
 * One place that decides where lead data comes from.
 *
 * With the API up (`docker-compose up && npm run dev`) this reads `GET /leads`. Without
 * it, it falls back to the seed set in mock-leads.ts and filters in memory, so the page
 * is developable and demoable before anyone has Postgres running.
 *
 * The fallback is a scaffolding measure with a deliberate expiry: it exists so the UI
 * could be built against the real query shape before the database was provisioned, and
 * it should be deleted the moment login lands and every environment has an API. Two
 * things keep it honest in the meantime — it announces itself in the console, and
 * `source` is returned to the caller so the page can say on screen which one it is
 * showing rather than quietly presenting seed rows as live data.
 */

export interface LeadPage {
  leads: LeadDetail[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  source: "api" | "seed";
}

const DEFAULT_PAGE_SIZE = 10;

export async function fetchLeads(query: LeadQuery = {}): Promise<LeadPage> {
  if (await isApiReachable()) {
    try {
      const response = await leadsApi.list({ pageSize: DEFAULT_PAGE_SIZE, ...query });
      return {
        leads: response.data.map(toLeadDetail),
        total: response.total,
        page: response.page,
        pageSize: response.pageSize,
        totalPages: response.totalPages,
        source: "api",
      };
    } catch (error) {
      // A reachable API that errors is a real problem, not a reason to quietly show seed
      // data — but showing something beats showing a blank page, so it degrades and says so.
      console.warn("[leads] API request failed, falling back to seed data", error);
    }
  }

  return filterSeed(query);
}

/** A lead with everything its detail page shows, plus where it sits in the list. */
export interface LeadDetailResult {
  lead: LeadDetail;
  /** The row as the API returned it, so an edit can send back fields the view drops. */
  record?: ApiLead;
  previousId?: string;
  nextId?: string;
  source: "api" | "seed";
}

/**
 * Everything the lead detail page needs. The API has no single "lead with history"
 * endpoint, so this assembles one from the lead, its timeline, calls, notes and
 * follow-ups — each of which the API already serves filtered by `leadId`.
 *
 * `undefined` means the lead does not exist, or belongs to another workspace, which the
 * API deliberately reports the same way.
 */
export async function fetchLeadDetail(id: string): Promise<LeadDetailResult | undefined> {
  if (!(await isApiReachable())) {
    const index = seedLeads.findIndex((lead) => lead.id === id);
    if (index === -1) return undefined;
    return {
      lead: seedLeads[index],
      previousId: seedLeads[index - 1]?.id,
      nextId: seedLeads[index + 1]?.id,
      source: "seed",
    };
  }

  let record: ApiLead;
  try {
    record = await leadsApi.get(id);
  } catch (error) {
    // 400 is an id that is not a uuid at all — an old seed link, say. Same answer.
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
      return undefined;
    }
    throw error;
  }

  // Each panel degrades on its own: a role that cannot see calls still gets the lead with
  // that tab empty, rather than an error page for the whole record.
  const [activity, calls, notes, followUps, order] = await Promise.all([
    leadsApi.activity(id).catch((): ApiLeadActivity[] => []),
    callsApi.list({ leadId: id, pageSize: 50 }).then(
      (page) => page.data,
      (): ApiCallDetailed[] => [],
    ),
    notesApi.list({ leadId: id, pageSize: 50 }).then(
      (page) => page.data,
      (): ApiNote[] => [],
    ),
    followUpsApi.list({ leadId: id, sort: "dueAt", direction: "asc", pageSize: 20 }).then(
      (page) => page.data,
      (): ApiFollowUp[] => [],
    ),
    // Previous/Next walk the list in the order the Leads table shows it, newest first.
    leadsApi.list({ pageSize: 200 }).then(
      (page) => page.data.map((lead) => lead.id),
      (): string[] => [],
    ),
  ]);

  const index = order.indexOf(id);
  return {
    lead: composeLeadDetail(record, activity, calls, notes, followUps),
    record,
    previousId: index > 0 ? order[index - 1] : undefined,
    nextId: index >= 0 && index < order.length - 1 ? order[index + 1] : undefined,
    source: "api",
  };
}

function composeLeadDetail(
  record: ApiLead,
  activity: ApiLeadActivity[],
  calls: ApiCallDetailed[],
  notes: ApiNote[],
  followUps: ApiFollowUp[],
): LeadDetail {
  const base = toLeadDetail(record);
  const when = (call: ApiCallDetailed) => new Date(call.startedAt ?? call.queuedAt).getTime();
  const history = [...calls].sort((a, b) => when(b) - when(a));
  const latest = history[0];
  const agent = history.find((call) => call.aiAgent)?.aiAgent;
  const next = followUps
    .filter((followUp) => followUp.status === "PENDING")
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0];

  return {
    ...base,
    campaign: latest?.campaign?.name,
    assignedAgent: agent
      ? { id: agent.id, name: agent.name, language: shortLanguageName(agent.language), avatarUrl: "" }
      : undefined,
    lastContactedAt: base.lastContactedAt ?? latest?.startedAt ?? undefined,
    nextFollowUp: next
      ? {
          id: next.id,
          dueAt: next.dueAt,
          description: next.notes ?? `${CHANNEL_LABEL[next.channel]} follow-up`,
        }
      : undefined,
    calls: history.map(toLeadCall),
    notes: notes.map(toLeadNote),
    activity: activity.map(toActivityEvent),
    aiSummary: history.find((call) => call.transcript?.summary)?.transcript?.summary ?? undefined,
  };
}

function toLeadCall(call: ApiCallDetailed): LeadCall {
  return {
    id: call.id,
    startedAt: call.startedAt ?? call.queuedAt,
    duration: call.durationSeconds ?? 0,
    status: call.status,
    outcome: call.outcome ?? undefined,
    personaName: call.aiAgent?.name ?? "—",
    campaignName: call.campaign?.name ?? "—",
    hasRecording: Boolean(call.recording),
    transcriptId: call.transcript?.id,
    transcriptSummary: call.transcript?.summary ?? undefined,
  };
}

function toLeadNote(note: ApiNote): LeadNote {
  return {
    id: note.id,
    author: note.isAiGenerated ? "AI" : "HUMAN",
    authorName: note.author?.name ?? (note.isAiGenerated ? "AI Agent" : "Team member"),
    timestamp: note.createdAt,
    text: note.title ? `${note.title} — ${note.content}` : note.content,
  };
}

/** Timeline rows the view has no dedicated icon for read as a change to the record. */
const ACTIVITY_KIND: Partial<Record<LeadActivityType, ActivityKind>> = {
  CALL_PLACED: "CALL",
  CALL_COMPLETED: "CALL",
  NOTE_ADDED: "NOTE",
  FOLLOWUP_CREATED: "FOLLOW_UP",
  FOLLOWUP_COMPLETED: "FOLLOW_UP",
  EMAIL_SENT: "EMAIL",
  WHATSAPP_SENT: "EMAIL",
};

function toActivityEvent(entry: ApiLeadActivity): ActivityEvent {
  return {
    id: entry.id,
    kind: ACTIVITY_KIND[entry.type] ?? "STATUS_CHANGE",
    title: entry.summary,
    subtitle: entry.actor ? `by ${entry.actor.name}` : "by the system",
    timestamp: entry.createdAt,
  };
}

const CHANNEL_LABEL: Record<FollowUpChannel, string> = {
  CALL: "Call",
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  MEETING: "Meeting",
};

/**
 * The Lead row alone, as the list shows it. History — calls, notes, the timeline — is
 * only fetched for the detail page (`composeLeadDetail`), so list rows carry empty panels.
 */
function toLeadDetail(lead: ApiLead): LeadDetail {
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    city: lead.city ?? "",
    source: lead.source,
    status: lead.status,
    score: lead.score,
    addedOn: lead.createdAt,
    // These are real columns now, not entries in customFields — the schema grew to hold
    // them, so reaching into a JSON blob for a value the table has would be reading the
    // wrong copy.
    category: lead.industry ?? "—",
    address: lead.address ?? "",
    email: lead.email ?? undefined,
    website: lead.website ?? undefined,
    contactPerson: lead.contactPerson ?? "—",
    tags: Array.isArray(lead.customFields?.tags) ? (lead.customFields.tags as string[]) : [],
    priority: lead.temperature === "HOT" ? "HIGH" : lead.temperature === "WARM" ? "MEDIUM" : "LOW",
    lastContactedAt: lead.lastContactedAt ?? undefined,
    scoreFactors: (lead.scoreReasons ?? []).map((reason) => ({
      label: reason.label,
      impact: reason.impact,
    })),
    calls: [],
    notes: [],
    activity: [],
    keyPoints: [],
  };
}

/** In-memory equivalent of what the API's `where` clause does, for the seed path. */
function filterSeed(query: LeadQuery): LeadPage {
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = query.page ?? 1;

  let rows = seedLeads;

  if (query.search) {
    const term = query.search.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");
    rows = rows.filter(
      (lead) =>
        lead.name.toLowerCase().includes(term) ||
        lead.city.toLowerCase().includes(term) ||
        lead.category.toLowerCase().includes(term) ||
        (digits.length > 0 && lead.phone.replace(/\D/g, "").includes(digits)),
    );
  }

  if (query.status?.length) {
    rows = rows.filter((lead) => query.status!.includes(lead.status));
  }
  if (query.source?.length) {
    rows = rows.filter((lead) => query.source!.includes(lead.source));
  }
  if (query.city) {
    rows = rows.filter((lead) => lead.city === query.city);
  }

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  return {
    leads: rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    total,
    page: safePage,
    pageSize,
    totalPages,
    source: "seed",
  };
}
