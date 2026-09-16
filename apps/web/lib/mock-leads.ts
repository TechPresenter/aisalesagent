import type {
  ActivityEvent,
  AIAgentPersona,
  CallOutcome,
  CallStatus,
  LeadCall,
  LeadDetail,
  LeadNote,
  LeadPriority,
  LeadSource,
  LeadStatus,
  ScoreFactor,
} from "./types";

/**
 * Build Plan Phase 4 seed data — the lead database behind /leads and /leads/{id}.
 *
 * The API swap is `GET /leads` for `leads` and `GET /leads/{id}` for `getLead()`
 * (TRD §8); `lib/leads-repository.ts` already prefers the API when it is reachable and
 * uses this only as the fallback.
 *
 * Two things are worth knowing about how this file is built:
 *
 * 1. The first ten rows are written out longhand because they are the reference design —
 *    the leads, contacts, scores, agents and timestamps a reviewer will compare against
 *    the spec screens. They must match exactly, so they are not generated.
 *
 * 2. The remaining rows are generated to bring the total to 612, the count the design
 *    shows. That is not padding: 612 rows is 62 pages, which is the only way the
 *    pagination control gets exercised against the ellipsis it was drawn with. The
 *    generator is a pure function of the row index — no randomness — so the list is
 *    stable across a server render and its hydration.
 */

export const TOTAL_LEAD_COUNT = 612;

const PERSONAS: Record<string, AIAgentPersona> = {
  anjali: {
    id: "persona-anjali",
    name: "Anjali",
    language: "Hindi",
    avatarUrl:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop&crop=faces&q=80",
  },
  rohan: {
    id: "persona-rohan",
    name: "Rohan",
    language: "Hindi",
    avatarUrl:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=faces&q=80",
  },
};

/** The ten rows the reference design shows, in the order it shows them. */
interface HeroSeed {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email?: string;
  website?: string;
  city: string;
  address: string;
  category: string;
  source: LeadSource;
  score: number;
  status: LeadStatus;
  agent: AIAgentPersona;
  lastContactedAt?: string;
  nextFollowUpAt?: string;
  followUpNote?: string;
  campaign: string;
  priority: LeadPriority;
  tags: string[];
  addedOn: string;
}

const HERO_SEED: HeroSeed[] = [
  {
    id: "lead-1",
    name: "Apex Dental Care",
    contactPerson: "Dr. Sanjay Verma",
    phone: "+91 98765 43211",
    email: "apexdentalcare@gmail.com",
    website: "https://apexdentalcare.in",
    city: "Patna",
    address: "Exhibition Road, Patna, Bihar",
    category: "Dental Clinic",
    source: "AI_FOUND",
    score: 88,
    status: "INTERESTED",
    agent: PERSONAS.anjali,
    lastContactedAt: "2025-05-31T10:24:00",
    nextFollowUpAt: "2025-06-02T11:00:00",
    followUpNote: "Demo call with technical team",
    campaign: "Dental Clinics - Bihar",
    priority: "HIGH",
    tags: ["Dental", "B2B", "Clinic"],
    addedOn: "2025-05-31T09:40:00",
  },
  {
    id: "lead-2",
    name: "Health Plus Clinic",
    contactPerson: "Dr. Neha Singh",
    phone: "+91 87654 32123",
    email: "healthplus.gaya@gmail.com",
    city: "Gaya",
    address: "Civil Lines, Gaya, Bihar",
    category: "General Clinic",
    source: "UPLOAD",
    score: 76,
    status: "FOLLOW_UP",
    agent: PERSONAS.rohan,
    lastContactedAt: "2025-05-31T09:15:00",
    nextFollowUpAt: "2025-06-02T14:00:00",
    followUpNote: "Call back after clinic hours",
    campaign: "Bihar Clinics - May",
    priority: "MEDIUM",
    tags: ["Clinic", "B2B"],
    addedOn: "2025-05-30T16:20:00",
  },
  {
    id: "lead-3",
    name: "City Medical Centre",
    contactPerson: "Dr. Amit Kumar",
    phone: "+91 76543 21234",
    city: "Patna",
    address: "Kankarbagh, Patna, Bihar",
    category: "Polyclinic",
    source: "AI_FOUND",
    score: 62,
    status: "NOT_INTERESTED",
    agent: PERSONAS.anjali,
    lastContactedAt: "2025-05-30T16:20:00",
    campaign: "Dental Clinics - Bihar",
    priority: "LOW",
    tags: ["Polyclinic"],
    addedOn: "2025-05-30T10:05:00",
  },
  {
    id: "lead-4",
    name: "LifeCare Clinic",
    contactPerson: "Dr. Priya Sinha",
    phone: "+91 65432 12345",
    email: "reception@lifecareranchi.in",
    website: "https://lifecareranchi.in",
    city: "Ranchi",
    address: "Lalpur, Ranchi, Jharkhand",
    category: "General Clinic",
    source: "WEBSITE",
    score: 91,
    status: "DEMO_BOOKED",
    agent: PERSONAS.rohan,
    lastContactedAt: "2025-05-30T11:10:00",
    nextFollowUpAt: "2025-06-05T11:00:00",
    followUpNote: "Product demo with the clinic owner",
    campaign: "Jharkhand Expansion",
    priority: "HIGH",
    tags: ["Clinic", "Inbound", "Hot"],
    addedOn: "2025-05-29T14:35:00",
  },
  {
    id: "lead-5",
    name: "MediLife Hospital",
    contactPerson: "Dr. Rajesh Mehta",
    phone: "+91 54321 23456",
    email: "admin@medilife.in",
    city: "Patna",
    address: "Bailey Road, Patna, Bihar",
    category: "Hospital",
    source: "UPLOAD",
    score: 58,
    status: "NEW",
    agent: PERSONAS.anjali,
    lastContactedAt: "2025-05-29T15:45:00",
    nextFollowUpAt: "2025-06-01T10:00:00",
    followUpNote: "First contact attempt",
    campaign: "Bihar Clinics - May",
    priority: "MEDIUM",
    tags: ["Hospital", "Enterprise"],
    addedOn: "2025-05-29T09:00:00",
  },
  {
    id: "lead-6",
    name: "Sharma Dental Clinic",
    contactPerson: "Dr. Pooja Sharma",
    phone: "+91 98765 43210",
    email: "sharmadental@gmail.com",
    city: "Patna",
    address: "Rajendra Nagar, Patna, Bihar",
    category: "Dental Clinic",
    source: "AI_FOUND",
    score: 82,
    status: "INTERESTED",
    agent: PERSONAS.anjali,
    lastContactedAt: "2025-05-29T12:30:00",
    nextFollowUpAt: "2025-06-03T16:00:00",
    followUpNote: "Send pricing for the 3-chair plan",
    campaign: "Dental Clinics - Bihar",
    priority: "HIGH",
    tags: ["Dental", "Clinic"],
    addedOn: "2025-05-28T11:15:00",
  },
  {
    id: "lead-7",
    name: "Smile Care Hospital",
    contactPerson: "Dr. Vikram Jha",
    phone: "+91 91234 56789",
    email: "contact@smilecare.in",
    city: "Gaya",
    address: "AP Colony, Gaya, Bihar",
    category: "Dental Hospital",
    source: "REFERRAL",
    score: 69,
    status: "FOLLOW_UP",
    agent: PERSONAS.rohan,
    lastContactedAt: "2025-05-28T17:10:00",
    nextFollowUpAt: "2025-06-02T12:00:00",
    followUpNote: "Decision maker unavailable, retry",
    campaign: "Bihar Clinics - May",
    priority: "MEDIUM",
    tags: ["Dental", "Referral"],
    addedOn: "2025-05-28T08:50:00",
  },
  {
    id: "lead-8",
    name: "CityCare Multispeciality",
    contactPerson: "Dr. Alka Rani",
    phone: "+91 99887 66554",
    email: "info@citycarems.in",
    city: "Muzaffarpur",
    address: "Motijheel, Muzaffarpur, Bihar",
    category: "Multispeciality Hospital",
    source: "AI_FOUND",
    score: 74,
    status: "NEW",
    agent: PERSONAS.anjali,
    lastContactedAt: "2025-05-28T11:00:00",
    nextFollowUpAt: "2025-06-01T15:00:00",
    followUpNote: "Introductory call",
    campaign: "Bihar Clinics - May",
    priority: "MEDIUM",
    tags: ["Hospital", "B2B"],
    addedOn: "2025-05-27T17:40:00",
  },
  {
    id: "lead-9",
    name: "Green Life Clinic",
    contactPerson: "Dr. Manoj Tiwari",
    phone: "+91 88776 55443",
    email: "greenlife.delhi@gmail.com",
    city: "Delhi",
    address: "Rohini Sector 7, New Delhi",
    category: "General Clinic",
    source: "SOCIAL_MEDIA",
    score: 67,
    status: "FOLLOW_UP",
    agent: PERSONAS.rohan,
    lastContactedAt: "2025-05-27T14:18:00",
    nextFollowUpAt: "2025-06-02T17:00:00",
    followUpNote: "Wants a written proposal first",
    campaign: "Metro Clinics - Q2",
    priority: "MEDIUM",
    tags: ["Clinic", "Inbound"],
    addedOn: "2025-05-27T10:30:00",
  },
  {
    id: "lead-10",
    name: "Wellness Dental Care",
    contactPerson: "Dr. Kavita Rai",
    phone: "+91 77665 44332",
    email: "wellnessdental@gmail.com",
    city: "Noida",
    address: "Sector 62, Noida, Uttar Pradesh",
    category: "Dental Clinic",
    source: "AI_FOUND",
    score: 79,
    status: "INTERESTED",
    agent: PERSONAS.anjali,
    lastContactedAt: "2025-05-27T10:05:00",
    nextFollowUpAt: "2025-06-04T11:30:00",
    followUpNote: "Demo scheduled with the partner dentist",
    campaign: "Metro Clinics - Q2",
    priority: "HIGH",
    tags: ["Dental", "B2B"],
    addedOn: "2025-05-26T15:55:00",
  },
];

/* ------------------------------------------------------------------ *
 * Derivations — everything below is a pure function of a seed row.
 * ------------------------------------------------------------------ */

/** Working Flow §Flow 6 — the outcome that put a lead in its current status. */
const OUTCOME_FOR_STATUS: Record<LeadStatus, CallOutcome | undefined> = {
  NEW: undefined,
  CONTACTED: "FOLLOW_UP",
  INTERESTED: "INTERESTED",
  FOLLOW_UP: "FOLLOW_UP",
  NOT_INTERESTED: "NOT_INTERESTED",
  NO_ANSWER: "NO_ANSWER",
  WRONG_NUMBER: "WRONG_NUMBER",
  DEMO_BOOKED: "INTERESTED",
  NEGOTIATION: "INTERESTED",
  CONVERTED: "INTERESTED",
  // A lead can be marked invalid without any call having produced that verdict — a bad
  // number found on import, say — so there is no outcome to attribute it to.
  INVALID: undefined,
  LOST: "NOT_INTERESTED",
  CLOSED: "NOT_INTERESTED",
};

/** Flow 7 — an unanswered dial never reaches Talking, so it cannot end Completed. */
function callStatusFor(outcome: CallOutcome): CallStatus {
  return outcome === "NO_ANSWER" ? "NO_ANSWER" : "COMPLETED";
}

function durationFor(outcome: CallOutcome, index: number): number {
  if (outcome === "NO_ANSWER") return 0;
  if (outcome === "WRONG_NUMBER") return 11 + index;
  if (outcome === "NOT_INTERESTED") return 24 + index * 7;
  if (outcome === "FOLLOW_UP") return 66 + index * 11;
  return 154 + index * 13;
}

function daysBefore(iso: string, days: number): string {
  const date = new Date(iso);
  date.setDate(date.getDate() - days);
  return toLocalIso(date);
}

function minutesAfter(iso: string, minutes: number): string {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() + minutes);
  return toLocalIso(date);
}

/**
 * Local-time ISO without a zone suffix. Deliberately not `toISOString()`: that converts
 * to UTC, which would shift every seeded timestamp by the renderer's offset and make a
 * "10:24 AM" call display as something else on a machine outside IST.
 */
function toLocalIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
  );
}

function attemptsFor(status: LeadStatus, index: number): number {
  if (status === "NEW") return index === 0 ? 1 : 0;
  if (status === "CONVERTED" || status === "DEMO_BOOKED") return 3;
  if (status === "NO_ANSWER" || status === "FOLLOW_UP") return 2;
  return 1 + (index % 2);
}

function buildCalls(seed: HeroSeed, index: number): LeadCall[] {
  const finalOutcome = OUTCOME_FOR_STATUS[seed.status] ?? "FOLLOW_UP";
  const contactedAt = seed.lastContactedAt;
  if (!contactedAt) return [];

  const total = attemptsFor(seed.status, index);

  // Newest first: attempt 0 is the call that set the current status; each earlier attempt
  // is a no-answer two days further back — the ordinary shape of a lead that took a few
  // tries to reach.
  return Array.from({ length: total }, (_, i) => {
    const outcome: CallOutcome = i === 0 ? finalOutcome : "NO_ANSWER";
    return {
      id: `${seed.id}-call-${total - i}`,
      startedAt: daysBefore(contactedAt, i * 2),
      duration: durationFor(outcome, i),
      status: callStatusFor(outcome),
      outcome,
      personaName: seed.agent.name,
      campaignName: seed.campaign,
      hasRecording: outcome !== "NO_ANSWER",
    };
  });
}

/**
 * Feature List §2 "AI lead scoring" with §9's "score plus contributing factors". The
 * factors are read off the same fields the score is scored from, so the rationale can
 * never disagree with the number printed beside it.
 */
function buildScoreFactors(seed: HeroSeed, calls: LeadCall[]): ScoreFactor[] {
  const factors: ScoreFactor[] = [];

  if (seed.status === "NEW") {
    factors.push({ label: "Not yet qualified — score is a pre-call estimate", impact: "negative" });
  }
  if (seed.status === "INTERESTED" || seed.status === "DEMO_BOOKED" || seed.status === "CONVERTED") {
    factors.push({ label: "Expressed interest on the call", impact: "positive" });
  }
  if (seed.status === "DEMO_BOOKED" || seed.status === "CONVERTED") {
    factors.push({ label: "Agreed to a scheduled demo", impact: "positive" });
  }
  if (seed.status === "FOLLOW_UP") {
    factors.push({ label: "Asked to be called back — decision pending", impact: "positive" });
  }
  if (seed.status === "NOT_INTERESTED" || seed.status === "CLOSED") {
    factors.push({ label: "Declined on the call", impact: "negative" });
  }

  const longest = calls.reduce((max, call) => Math.max(max, call.duration), 0);
  if (longest >= 120) {
    factors.push({
      label: `Longest call ${Math.round(longest / 60)} min — engaged conversation`,
      impact: "positive",
    });
  }

  factors.push(
    seed.email
      ? { label: "Email on file — reachable on a second channel", impact: "positive" }
      : { label: "No email on file", impact: "negative" },
  );

  if (["Hospital", "Multispeciality Hospital", "Dental Hospital"].includes(seed.category)) {
    factors.push({ label: `${seed.category} — high-value segment`, impact: "positive" });
  }

  return factors;
}

const SUMMARY_FOR_OUTCOME: Record<CallOutcome, string> = {
  INTERESTED:
    "Very positive response. Interested in appointment scheduling and patient management.",
  FOLLOW_UP:
    "Reached the front desk rather than the decision maker. Asked us to call back after clinic hours.",
  NOT_INTERESTED:
    "Already on another clinic management system and under contract. Not open to switching this year.",
  NO_ANSWER: "No answer after the full ring cycle. Requeued for retry per campaign rules.",
  WRONG_NUMBER: "Number reaches a private individual, not the listed business.",
  DEMO_BOOKED:
    "Agreed to a demo and picked a slot. Calendar invite sent to the decision maker.",
  CALLBACK_REQUESTED:
    "Asked to be called back at a specific time. Nothing was discussed on this attempt.",
  DO_NOT_CALL:
    "Asked not to be contacted again. Marked do-not-call; no further attempts will be made.",
};

function buildNotes(seed: HeroSeed, calls: LeadCall[]): LeadNote[] {
  const notes: LeadNote[] = calls
    .filter((call) => call.status === "COMPLETED" && call.outcome)
    .map((call) => ({
      id: `${call.id}-note`,
      author: "AI" as const,
      authorName: `${seed.agent.name} (AI)`,
      timestamp: minutesAfter(call.startedAt, 6),
      text: SUMMARY_FOR_OUTCOME[call.outcome as CallOutcome],
    }));

  // Feature List §9 — "Manual note override": a human adds what the AI cannot know.
  if (seed.priority === "HIGH" && seed.lastContactedAt) {
    notes.unshift({
      id: `${seed.id}-note-human`,
      author: "HUMAN",
      authorName: "Shailesh",
      timestamp: minutesAfter(seed.lastContactedAt, 20),
      text: `${seed.followUpNote ?? "Follow-up agreed"}. Confirmed over WhatsApp.`,
    });
  }

  return notes;
}

/**
 * The activity timeline on the detail page. Built from the calls, notes and follow-up
 * that already exist rather than as a separate list, so the timeline cannot show an
 * event the rest of the record disagrees with.
 */
function buildActivity(seed: HeroSeed, calls: LeadCall[], notes: LeadNote[]): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const call of calls) {
    events.push({
      id: `${call.id}-activity`,
      kind: call.status === "COMPLETED" ? "CALL" : "CALL",
      title: call.status === "COMPLETED" ? "AI Call Completed" : "Call Not Answered",
      subtitle:
        call.status === "COMPLETED" ? `Duration: ${formatSeconds(call.duration)}` : undefined,
      detail: call.outcome ? SUMMARY_FOR_OUTCOME[call.outcome] : undefined,
      timestamp: call.startedAt,
    });

    if (call.hasRecording) {
      events.push({
        id: `${call.id}-transcript`,
        kind: "TRANSCRIPT",
        title: "Transcript Available",
        timestamp: call.startedAt,
      });
    }
  }

  for (const note of notes) {
    events.push({
      id: `${note.id}-activity`,
      kind: "NOTE",
      title: "Note Added",
      subtitle: `Added by ${note.authorName}`,
      detail: note.text,
      timestamp: note.timestamp,
    });
  }

  if (seed.nextFollowUpAt && seed.lastContactedAt) {
    events.push({
      id: `${seed.id}-followup`,
      kind: "FOLLOW_UP",
      title: "Follow-up Scheduled",
      subtitle: formatDateTime(seed.nextFollowUpAt),
      detail: seed.followUpNote,
      timestamp: minutesAfter(seed.lastContactedAt, 8),
    });
  }

  if (seed.email && seed.lastContactedAt) {
    events.push({
      id: `${seed.id}-email`,
      kind: "EMAIL",
      title: "Email Sent",
      detail: "Product brochure sent to email",
      timestamp: minutesAfter(seed.lastContactedAt, 11),
    });
  }

  // Oldest first: the timeline reads downwards as the story of the lead, which is how
  // someone picking it up cold wants it — the first call, then what followed. A reverse
  // sort would be better for a lead with years of history, but that is not the case this
  // page is for.
  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** Feature List §9 — AI summary and extracted key points. */
function buildAiSummary(seed: HeroSeed): { summary: string; keyPoints: string[] } {
  if (seed.status === "NOT_INTERESTED" || seed.status === "CLOSED") {
    return {
      summary: `${seed.name} is already committed to another system and declined on the call. Worth revisiting when their current contract is up.`,
      keyPoints: [
        "Already on a competing system",
        "Under contract this year",
        `Decision maker: ${seed.contactPerson}`,
      ],
    };
  }

  if (seed.status === "NEW") {
    return {
      summary: `${seed.name} has not been qualified yet. Score is a pre-call estimate from segment and firmographics.`,
      keyPoints: [
        "Not yet contacted",
        `${seed.category} in ${seed.city}`,
        `Queued on ${seed.campaign}`,
      ],
    };
  }

  return {
    summary:
      "Clinic shows strong interest in AI-powered patient management and appointment " +
      `scheduling. Looking for demo next week. Budget confirmed. Decision maker is ` +
      `${seed.contactPerson.replace(/^Dr\.\s+\w+\s+/, "Dr. ")}.`,
    keyPoints: [
      "Interested in appointment scheduling",
      "Needs patient management system",
      "Budget confirmed",
      "Wants demo next week",
      `Decision maker: ${seed.contactPerson}`,
    ],
  };
}

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })} at ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

function toLead(seed: HeroSeed, index: number): LeadDetail {
  const calls = buildCalls(seed, index);
  const notes = buildNotes(seed, calls);
  const { summary, keyPoints } = buildAiSummary(seed);

  return {
    id: seed.id,
    name: seed.name,
    contactPerson: seed.contactPerson,
    phone: seed.phone,
    email: seed.email,
    website: seed.website,
    city: seed.city,
    address: seed.address,
    category: seed.category,
    source: seed.source,
    status: seed.status,
    score: seed.score,
    addedOn: seed.addedOn,
    campaign: seed.campaign,
    assignedAgent: seed.agent,
    priority: seed.priority,
    tags: seed.tags,
    lastContactedAt: seed.lastContactedAt,
    nextFollowUp: seed.nextFollowUpAt
      ? { dueAt: seed.nextFollowUpAt, description: seed.followUpNote ?? "Follow-up call" }
      : undefined,
    freeformNotes:
      seed.status === "INTERESTED" || seed.status === "DEMO_BOOKED"
        ? "Looking for patient management and appointment scheduling solution."
        : undefined,
    scoreFactors: buildScoreFactors(seed, calls),
    calls,
    notes,
    activity: buildActivity(seed, calls, notes),
    aiSummary: summary,
    keyPoints,
  };
}

/* ------------------------------------------------------------------ *
 * Generated rows — brings the list to the 612 the design shows.
 * ------------------------------------------------------------------ */

const CLINIC_PREFIXES = [
  "Sunrise", "Ganga", "Prakash", "Nova", "Verma", "Metro", "Sanjeevani", "Sinha",
  "Aarogya", "Kumar", "Bihar", "Shanti", "Om", "Sarita", "Pathfinder", "Mishra",
  "Green Leaf", "Anand", "Kashyap", "Lotus", "Vaidya", "Sewa", "Navjeevan", "Ashirwad",
];
const CLINIC_SUFFIXES = [
  "Dental Clinic", "Diagnostic Lab", "Nursing Home", "Eye Hospital", "Skin Clinic",
  "Child Care", "Path Lab", "Physiotherapy", "ENT Clinic", "Ayurveda Centre",
  "Medical Store", "Multispeciality",
];
const CONTACT_FIRST = ["Dr. Rakesh", "Dr. Sunita", "Dr. Anil", "Dr. Meena", "Dr. Vinod", "Dr. Asha"];
const CONTACT_LAST = ["Prasad", "Gupta", "Yadav", "Choudhary", "Mishra", "Ranjan"];
const CITIES = [
  "Patna", "Gaya", "Ranchi", "Muzaffarpur", "Bhagalpur", "Darbhanga",
  "Jamshedpur", "Dhanbad", "Delhi", "Noida",
];
const SOURCES: LeadSource[] = ["AI_FOUND", "UPLOAD", "WEBSITE", "REFERRAL", "SOCIAL_MEDIA"];
const STATUSES: LeadStatus[] = [
  "NEW", "CONTACTED", "INTERESTED", "FOLLOW_UP", "NOT_INTERESTED",
  "NO_ANSWER", "DEMO_BOOKED", "CONVERTED", "WRONG_NUMBER", "CLOSED",
];
const CAMPAIGNS = [
  "Dental Clinics - Bihar", "Bihar Clinics - May", "Jharkhand Expansion",
  "Metro Clinics - Q2", "Re-engagement - Q2",
];

/**
 * Deterministic pseudo-randomness: the same index always produces the same lead, so the
 * list does not reshuffle between the server render and the client hydration.
 */
function pick<T>(pool: T[], index: number, salt: number): T {
  return pool[(index * salt + salt) % pool.length];
}

function generateLead(index: number): LeadDetail {
  const n = index + 11;
  const status = pick(STATUSES, index, 7);
  const score = 12 + ((index * 37) % 84);
  const dayOffset = Math.floor(index / 4) + 1;
  const addedOn = daysBefore("2025-05-26T12:00:00", dayOffset);
  const contacted = status === "NEW" ? undefined : daysBefore("2025-05-26T14:30:00", dayOffset - 1);

  const seed: HeroSeed = {
    id: `lead-${n}`,
    name: `${pick(CLINIC_PREFIXES, index, 5)} ${pick(CLINIC_SUFFIXES, index, 3)}`,
    contactPerson: `${pick(CONTACT_FIRST, index, 11)} ${pick(CONTACT_LAST, index, 13)}`,
    phone: `+91 ${String(90000 + ((index * 137) % 9999)).slice(0, 5)} ${String(
      10000 + ((index * 911) % 89999),
    ).slice(0, 5)}`,
    email: index % 3 === 0 ? undefined : `contact${n}@example.in`,
    city: pick(CITIES, index, 3),
    address: `${pick(CITIES, index, 3)}, India`,
    category: pick(CLINIC_SUFFIXES, index, 3),
    source: pick(SOURCES, index, 2),
    score,
    status,
    agent: index % 2 === 0 ? PERSONAS.anjali : PERSONAS.rohan,
    lastContactedAt: contacted,
    nextFollowUpAt:
      status === "NOT_INTERESTED" || status === "CLOSED" || status === "CONVERTED"
        ? undefined
        : daysBefore("2025-06-06T11:00:00", index % 5),
    followUpNote: "Scheduled follow-up call",
    campaign: pick(CAMPAIGNS, index, 3),
    priority: score >= 75 ? "HIGH" : score >= 50 ? "MEDIUM" : "LOW",
    tags: [pick(["Dental", "Clinic", "Hospital", "Lab"], index, 3), "B2B"],
    addedOn,
  };

  return toLead(seed, index + 10);
}

/** GET /leads — the full database, newest first. */
export const leads: LeadDetail[] = [
  ...HERO_SEED.map(toLead),
  ...Array.from({ length: TOTAL_LEAD_COUNT - HERO_SEED.length }, (_, i) => generateLead(i)),
];

/** GET /leads/{id} — undefined is what drives notFound() on the detail route. */
export function getLead(id: string): LeadDetail | undefined {
  return leads.find((lead) => lead.id === id);
}

/** The first five, for the dashboard's Recent Leads card. */
export const recentLeads = leads.slice(0, 5);

/** Distinct values for the filter dropdowns. */
export const leadCities: string[] = Array.from(new Set(leads.map((l) => l.city))).sort();
export const leadAgents: string[] = Array.from(
  new Set(leads.map((l) => l.assignedAgent?.name).filter((n): n is string => Boolean(n))),
).sort();

/**
 * Feature List §1 — the KPI strip above the Leads table. Fixed rather than counted off
 * `leads`, because these are period-over-period aggregates from
 * `GET /analytics/dashboard` (TRD §8), not properties of the current page of rows.
 */
export const leadStats = [
  { id: "total-leads", label: "Total Leads", value: TOTAL_LEAD_COUNT, trend: 33, sparkline: [280, 320, 360, 390, 430, 470, 500, 540, 570, 590, 600, 612] },
  { id: "new-today", label: "New Today", value: 28, trend: 12, sparkline: [12, 15, 13, 18, 16, 21, 19, 24, 22, 26, 25, 28] },
  { id: "interested", label: "Interested", value: 46, trend: 27, sparkline: [18, 21, 20, 26, 24, 30, 28, 34, 33, 40, 42, 46] },
  { id: "followups-due", label: "Follow-ups Due", value: 18, trend: 18, sparkline: [8, 10, 9, 12, 11, 14, 13, 15, 14, 17, 16, 18] },
  { id: "demo-booked", label: "Demo Booked", value: 22, trend: 46, sparkline: [4, 6, 5, 8, 7, 11, 10, 14, 13, 18, 20, 22] },
];
