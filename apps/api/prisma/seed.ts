import { randomBytes, createHash } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import * as argon2 from "argon2";
import { PERMISSIONS, PERMISSION_CATEGORY } from "@appsgain/shared";

/**
 * Development seed.
 *
 * Two rules this file follows, both of which matter more than the data itself:
 *
 *   1. It is idempotent. Every write is an upsert on a natural key, so running it twice
 *      is the same as running it once. A seed that only works against an empty database
 *      is a seed nobody runs after the first day.
 *
 *   2. It seeds *two* tenants. One would let a broken tenant filter pass every test —
 *      if there is only one workspace's data, failing to scope a query looks identical
 *      to scoping it correctly. The second workspace is what makes isolation observable.
 *
 * Passwords are hashed with the same argon2 configuration the auth service uses. There
 * is no "seed shortcut" that writes a weaker digest, because a fixture that differs from
 * production in how it stores credentials is a fixture that stops testing the thing.
 */

const prisma = new PrismaClient();

/** Shared across seeded logins so the demo is usable; never valid in production. */
const DEMO_PASSWORD = "Appsgain#2026";

const INDUSTRIES = [
  "Software",
  "IT Services",
  "E-commerce",
  "Healthcare",
  "Manufacturing",
  "Education",
  "Real Estate",
  "Finance",
  "Professional Services",
  "Logistics",
];

const CITIES: { city: string; state: string; country: string }[] = [
  { city: "Bengaluru", state: "Karnataka", country: "India" },
  { city: "Noida", state: "Uttar Pradesh", country: "India" },
  { city: "Pune", state: "Maharashtra", country: "India" },
  { city: "Hyderabad", state: "Telangana", country: "India" },
  { city: "Gurugram", state: "Haryana", country: "India" },
  { city: "Chennai", state: "Tamil Nadu", country: "India" },
  { city: "Mumbai", state: "Maharashtra", country: "India" },
  { city: "Ahmedabad", state: "Gujarat", country: "India" },
  { city: "Singapore", state: "—", country: "Singapore" },
  { city: "Dubai", state: "—", country: "UAE" },
];

const COMPANY_NAMES = [
  "Meridian Software", "Nimbus Cloud Systems", "Vertex Analytics", "Orbit Commerce",
  "Lumen Health Tech", "Ironclad Manufacturing", "Scholar Education Group", "Beacon Realty",
  "Sterling Capital", "Apex Consulting", "Northgate Logistics", "Quantum Payments",
  "Cobalt Interactive", "Redwood Systems", "Helix Diagnostics", "Summit Industrial",
  "Bluebird Learning", "Landmark Properties", "Crescent Finance", "Pinnacle Advisory",
  "Trailhead Freight", "Everest Digital", "Aurora Robotics", "Tidewater Retail",
  "Granite Security", "Silverline Media", "Copperfield Legal", "Harbour Insurance",
  "Willow Biotech", "Foundry Labs",
];

const CONTACTS = [
  "Rajesh Kumar", "Priya Menon", "Arjun Sharma", "Sneha Patel", "Vikram Rao",
  "Ananya Iyer", "Karthik Nair", "Divya Reddy", "Rohan Mehta", "Neha Gupta",
  "Sanjay Verma", "Meera Krishnan", "Aditya Joshi", "Kavita Desai", "Nikhil Bansal",
];

const JOB_TITLES = [
  "Founder & CEO", "CTO", "VP Engineering", "Head of Operations", "Director of Sales",
  "IT Manager", "Procurement Lead", "Managing Director", "COO", "Head of Growth",
];

/**
 * Deterministic pseudo-randomness.
 *
 * A seed that reshuffles on every run makes two things impossible: comparing a screenshot
 * to yesterday's, and writing a test that asserts on seeded data. Same input, same
 * database, every time.
 */
function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const rng = makeRng(20260910);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)];
const between = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

/** Days before now, as a Date — keeps the demo looking current whenever it is run. */
function daysAgo(days: number, hour = 10, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function daysAhead(days: number, hour = 11, minute = 0): Date {
  return daysAgo(-days, hour, minute);
}

/** Matches the normalisation the import pipeline applies, so the unique index agrees. */
function phoneFor(index: number): string {
  return `+9198${String(76500000 + index * 1237).slice(0, 8)}`;
}

async function seedPermissions() {
  // The catalogue is global and code-owned: the rows exist so custom roles can reference
  // them by foreign key, not so anyone can edit the list in the database.
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: { category: PERMISSION_CATEGORY[key] },
      create: {
        key,
        category: PERMISSION_CATEGORY[key],
        description: describePermission(key),
      },
    });
  }
  console.log(`  permissions: ${PERMISSIONS.length}`);
}

function describePermission(key: string): string {
  const [resource, action] = key.split(".");
  const verb: Record<string, string> = {
    view: "View",
    create: "Create",
    edit: "Edit",
    delete: "Delete",
    export: "Export",
    import: "Import",
    manage: "Manage",
    assign: "Assign",
    start: "Start",
    download: "Download",
  };
  const noun = resource.replace(/([a-z])([A-Z])/g, "$1 $2");
  return `${verb[action] ?? action} ${noun}`;
}

async function seedPlans() {
  const plans: Prisma.PlanCreateInput[] = [
    {
      key: "starter", name: "Starter", tagline: "Perfect for small teams getting started",
      monthlyPrice: 299900, yearlyPrice: 2879000, sortOrder: 1,
      monthlyCallLimit: 500, leadLimit: 2000, teamMemberLimit: 1, storageGb: 5,
      recordingRetentionDays: 7, includedCredits: 500,
      features: ["AI_CALLING"],
    },
    {
      key: "professional", name: "Professional", tagline: "Great for growing businesses",
      monthlyPrice: 999900, yearlyPrice: 9599000, sortOrder: 2,
      monthlyCallLimit: 2500, leadLimit: 20000, teamMemberLimit: 3, storageGb: 25,
      recordingRetentionDays: 30, includedCredits: 2500,
      features: ["AI_CALLING", "AI_LEAD_SEARCH", "ADVANCED_ANALYTICS", "WHATSAPP"],
    },
    {
      key: "business", name: "Business", tagline: "For large teams and multi-site operations",
      monthlyPrice: 2499900, yearlyPrice: 23999000, sortOrder: 3,
      monthlyCallLimit: 10000, leadLimit: 100000, teamMemberLimit: 10, storageGb: 100,
      recordingRetentionDays: 90, includedCredits: 10000,
      features: ["AI_CALLING", "AI_LEAD_SEARCH", "ADVANCED_ANALYTICS", "WHATSAPP",
                 "EMAIL_OUTREACH", "MULTI_AGENT", "CUSTOM_AI"],
    },
    {
      key: "enterprise", name: "Enterprise", tagline: "Custom solutions for large organizations",
      monthlyPrice: 0, yearlyPrice: 0, sortOrder: 4, isPublic: false,
      monthlyCallLimit: null, leadLimit: null, teamMemberLimit: null, storageGb: null,
      recordingRetentionDays: null, includedCredits: 0,
      features: ["AI_CALLING", "AI_LEAD_SEARCH", "ADVANCED_ANALYTICS", "WHATSAPP",
                 "EMAIL_OUTREACH", "MULTI_AGENT", "CUSTOM_AI", "ENTERPRISE_INTEGRATIONS"],
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({ where: { key: plan.key }, update: plan, create: plan });
  }
  console.log(`  plans: ${plans.length}`);
}

interface TenantSpec {
  name: string;
  subdomain: string;
  industry: string;
  planKey: string;
  leadCount: number;
  /** Offsets the generated data so the two workspaces do not look like copies. */
  variant: number;
}

async function seedTenant(spec: TenantSpec) {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  const tenant = await prisma.tenant.upsert({
    where: { subdomain: spec.subdomain },
    update: { name: spec.name, industryVertical: spec.industry },
    create: {
      name: spec.name,
      subdomain: spec.subdomain,
      industryVertical: spec.industry,
      status: "ACTIVE",
      onboardedAt: daysAgo(90),
    },
  });

  // ── settings ──────────────────────────────────────────────────────────────────────
  await prisma.tenantSettings.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: {
      tenantId: tenant.id,
      website: `https://${spec.subdomain}.example.com`,
      industry: spec.industry,
      companySize: "51-200",
      city: spec.variant === 0 ? "Noida" : "Bengaluru",
      state: spec.variant === 0 ? "Uttar Pradesh" : "Karnataka",
      country: "India",
    },
  });

  await prisma.callSettings.upsert({
    where: { tenantId: tenant.id },
    update: {},
    // Calling stays off until a telephony provider is actually connected. Seeding it
    // enabled would mean a fresh clone looks ready to dial real numbers, which it is not.
    create: { tenantId: tenant.id, callingEnabled: false },
  });

  await prisma.aiSettings.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: { tenantId: tenant.id },
  });

  // ── people ────────────────────────────────────────────────────────────────────────
  const team: { email: string; name: string; role: "OWNER" | "ADMIN" | "MANAGER" | "AGENT" | "VIEWER" }[] = [
    { email: `owner@${spec.subdomain}.test`, name: "Shailesh Kumar", role: "OWNER" },
    { email: `admin@${spec.subdomain}.test`, name: "Priya Menon", role: "ADMIN" },
    { email: `manager@${spec.subdomain}.test`, name: "Arjun Sharma", role: "MANAGER" },
    { email: `agent@${spec.subdomain}.test`, name: "Sneha Patel", role: "AGENT" },
    { email: `viewer@${spec.subdomain}.test`, name: "Vikram Rao", role: "VIEWER" },
  ];

  const users = [];
  for (const member of team) {
    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: member.email } },
      update: { name: member.name, role: member.role },
      create: {
        tenantId: tenant.id,
        email: member.email,
        name: member.name,
        role: member.role,
        passwordHash,
        status: "ACTIVE",
        emailVerifiedAt: daysAgo(90),
        lastLoginAt: daysAgo(between(0, 5)),
      },
    });
    await prisma.userSettings.upsert({
      where: { userId: user.id },
      update: {},
      create: { tenantId: tenant.id, userId: user.id },
    });
    users.push(user);
  }

  const owner = users[0];
  const agents = users.filter((u) => u.role === "AGENT" || u.role === "MANAGER");

  // ── subscription and credits ──────────────────────────────────────────────────────
  const plan = await prisma.plan.findUniqueOrThrow({ where: { key: spec.planKey } });

  const existingSub = await prisma.subscription.findFirst({ where: { tenantId: tenant.id } });
  if (!existingSub) {
    await prisma.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        status: "ACTIVE",
        period: "MONTHLY",
        currentPeriodStart: daysAgo(12),
        currentPeriodEnd: daysAhead(18),
      },
    });
  }

  // The wallet is created at zero and moved only by ledger entries, so the seeded
  // balance is the sum of its own history rather than a number typed in beside it.
  const wallet = await prisma.creditWallet.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: { tenantId: tenant.id, balance: 0, lowBalanceThreshold: 100 },
  });

  const ledgerCount = await prisma.creditTransaction.count({ where: { tenantId: tenant.id } });
  if (ledgerCount === 0) {
    let balance = 0;
    const entries: Prisma.CreditTransactionCreateManyInput[] = [];

    const grant = plan.includedCredits;
    entries.push({
      tenantId: tenant.id, type: "CREDIT", operation: "PLAN_GRANT", amount: grant,
      balanceBefore: balance, balanceAfter: (balance += grant),
      note: `${plan.name} monthly allowance`, createdAt: daysAgo(12),
    });

    for (let i = 0; i < 40; i += 1) {
      const op = pick(["AI_CALL", "TRANSCRIPTION", "AI_ANALYSIS", "AI_LEAD_SEARCH"] as const);
      const amount = op === "AI_CALL" ? between(2, 6) : between(1, 3);
      if (balance - amount < 0) break;
      entries.push({
        tenantId: tenant.id, type: "DEBIT", operation: op, amount,
        balanceBefore: balance, balanceAfter: (balance -= amount),
        createdAt: daysAgo(between(0, 11), between(9, 18), between(0, 59)),
      });
    }

    await prisma.creditTransaction.createMany({ data: entries });
    await prisma.creditWallet.update({ where: { id: wallet.id }, data: { balance } });
  }

  // ── AI agents ─────────────────────────────────────────────────────────────────────
  const agentSpecs = [
    { name: "Anjali", language: "hi-IN", gender: "female", personality: "Warm, concise, consultative" },
    { name: "Rohan", language: "hi-IN", gender: "male", personality: "Direct, energetic, benefit-led" },
    { name: "Maya", language: "en-IN", gender: "female", personality: "Professional, precise, patient" },
  ];

  const aiAgents = [];
  for (const a of agentSpecs) {
    aiAgents.push(
      await prisma.aiAgent.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: a.name } },
        update: {},
        create: {
          tenantId: tenant.id,
          name: a.name,
          language: a.language,
          gender: a.gender,
          personality: a.personality,
          openingMessage: `Hello, this is ${a.name} from ${spec.name}. Do you have two minutes?`,
          systemPrompt:
            "You are a B2B sales development representative. Qualify the prospect on need, " +
            "budget, authority and timeline. Be brief, never oversell, and offer to book a " +
            "demo when there is genuine interest.",
          // Objects, not bare strings. The editor and the calling pipeline both read
          // `question` / `captures` / `required` off each row; a list of strings parses
          // as three rows with no text, which looks like an empty script rather than a
          // shape mismatch. `readQuestions` in agents/agent-script.ts still tolerates the
          // old form, for databases seeded before this was fixed.
          qualificationQuestions: [
            {
              id: "q1",
              question: "What are you using for this today?",
              captures: "incumbent",
              required: true,
            },
            {
              id: "q2",
              question: "How many people would need access?",
              captures: "seats",
              required: true,
            },
            {
              id: "q3",
              question: "What is your timeline for making a change?",
              captures: "timeline",
              required: false,
            },
          ],
          objectionHandling: [
            {
              id: "o1",
              objection: "It is too expensive",
              response:
                "Acknowledge it, then ask what they are comparing against and what the " +
                "current approach costs them in time.",
            },
            {
              id: "o2",
              objection: "Send me an email instead",
              response:
                "Agree to send one, then ask a single qualifying question before ending " +
                "the call so the email can be specific.",
            },
            {
              id: "o3",
              objection: "We already have something for this",
              response:
                "Ask what it does well before asking what it does not. Never disparage " +
                "the incumbent.",
            },
          ],
        },
      }),
    );
  }

  // ── tags ──────────────────────────────────────────────────────────────────────────
  const tagSpecs = [
    { label: "Enterprise", tone: "purple" }, { label: "SMB", tone: "blue" },
    { label: "Hot", tone: "red" }, { label: "Pricing", tone: "amber" },
    { label: "Demo Requested", tone: "green" }, { label: "Competitor", tone: "gray" },
  ];
  const tags = [];
  for (const t of tagSpecs) {
    tags.push(
      await prisma.tag.upsert({
        where: { tenantId_label: { tenantId: tenant.id, label: t.label } },
        update: {},
        create: { tenantId: tenant.id, label: t.label, tone: t.tone },
      }),
    );
  }

  // ── campaigns ─────────────────────────────────────────────────────────────────────
  const campaignSpecs = [
    { name: "Q3 Software Outbound", status: "ACTIVE" as const, type: "AI_CALLING" as const },
    { name: "IT Services — North India", status: "ACTIVE" as const, type: "AI_CALLING" as const },
    { name: "E-commerce Expansion", status: "PAUSED" as const, type: "MULTI_CHANNEL" as const },
    { name: "Enterprise Named Accounts", status: "DRAFT" as const, type: "AI_CALLING" as const },
  ];

  const campaigns = [];
  for (const [i, c] of campaignSpecs.entries()) {
    campaigns.push(
      await prisma.campaign.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: c.name } },
        update: {},
        create: {
          tenantId: tenant.id,
          name: c.name,
          description: `Outbound programme targeting ${INDUSTRIES[i % INDUSTRIES.length]} accounts.`,
          type: c.type,
          status: c.status,
          aiAgentId: aiAgents[i % aiAgents.length].id,
          startDate: daysAgo(30 - i * 5),
          dailyCallLimit: 120,
          callWindowStart: 600,
          callWindowEnd: 1140,
          callDays: [1, 2, 3, 4, 5],
        },
      }),
    );
  }

  // ── leads, and the history hanging off them ───────────────────────────────────────
  const existingLeads = await prisma.lead.count({ where: { tenantId: tenant.id } });
  if (existingLeads >= spec.leadCount) {
    console.log(`  ${spec.subdomain}: already seeded (${existingLeads} leads)`);
    return;
  }

  const statuses = [
    "NEW", "CONTACTED", "INTERESTED", "FOLLOW_UP", "DEMO_BOOKED",
    "NEGOTIATION", "CONVERTED", "NOT_INTERESTED", "NO_ANSWER", "LOST",
  ] as const;

  for (let i = 0; i < spec.leadCount; i += 1) {
    const loc = CITIES[(i + spec.variant) % CITIES.length];
    const company = `${COMPANY_NAMES[(i + spec.variant * 7) % COMPANY_NAMES.length]}${
      i >= COMPANY_NAMES.length ? ` ${Math.floor(i / COMPANY_NAMES.length) + 1}` : ""
    }`;
    const status = statuses[i % statuses.length];
    const score = status === "CONVERTED" ? between(82, 97)
      : status === "INTERESTED" || status === "DEMO_BOOKED" ? between(68, 90)
      : status === "NOT_INTERESTED" || status === "LOST" ? between(8, 34)
      : between(35, 72);

    const contacted = status !== "NEW";

    const lead = await prisma.lead.upsert({
      where: { tenantId_phone: { tenantId: tenant.id, phone: phoneFor(i + spec.variant * 500) } },
      update: {},
      create: {
        tenantId: tenant.id,
        name: company,
        contactPerson: CONTACTS[i % CONTACTS.length],
        jobTitle: JOB_TITLES[i % JOB_TITLES.length],
        phone: phoneFor(i + spec.variant * 500),
        email: `${CONTACTS[i % CONTACTS.length].split(" ")[0].toLowerCase()}@${company
          .toLowerCase().replace(/[^a-z0-9]/g, "")}.com`,
        website: `https://${company.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`,
        city: loc.city,
        state: loc.state,
        country: loc.country,
        industry: INDUSTRIES[i % INDUSTRIES.length],
        companySize: pick(["1-10", "11-50", "51-200", "201-500", "500+"]),
        source: pick(["UPLOAD", "AI_FOUND", "WEBSITE", "REFERRAL", "IMPORT"] as const),
        status,
        score,
        scoreReasons: [
          { label: `${INDUSTRIES[i % INDUSTRIES.length]} is a core vertical`, impact: "positive" },
          { label: `${loc.city} is in an active territory`, impact: "positive" },
          ...(score < 50 ? [{ label: "No decision-maker contact confirmed", impact: "negative" }] : []),
        ],
        scoredAt: daysAgo(between(0, 20)),
        temperature: score >= 75 ? "HOT" : score >= 45 ? "WARM" : "COLD",
        ownerId: agents[i % agents.length].id,
        lastContactedAt: contacted ? daysAgo(between(0, 25), between(9, 18)) : null,
        convertedAt: status === "CONVERTED" ? daysAgo(between(1, 15)) : null,
        createdAt: daysAgo(between(20, 120)),
      },
    });

    await prisma.leadActivity.create({
      data: {
        tenantId: tenant.id,
        leadId: lead.id,
        actorId: owner.id,
        type: "CREATED",
        summary: `Lead created from ${lead.source.toLowerCase().replace("_", " ")}`,
        createdAt: lead.createdAt,
      },
    });

    // Two tags per lead, deterministic so the demo is stable.
    for (const tag of [tags[i % tags.length], tags[(i + 3) % tags.length]]) {
      await prisma.leadTag.upsert({
        where: { leadId_tagId: { leadId: lead.id, tagId: tag.id } },
        update: {},
        create: { tenantId: tenant.id, leadId: lead.id, tagId: tag.id },
      });
    }

    const campaign = campaigns[i % campaigns.length];
    await prisma.campaignLead.upsert({
      where: { campaignId_leadId: { campaignId: campaign.id, leadId: lead.id } },
      update: {},
      create: {
        tenantId: tenant.id,
        campaignId: campaign.id,
        leadId: lead.id,
        state: contacted ? "COMPLETED" : "PENDING",
        attempts: contacted ? between(1, 3) : 0,
        lastAttemptAt: lead.lastContactedAt,
      },
    });

    if (!contacted) continue;

    // ── a completed call, with everything it produces ───────────────────────────────
    const duration = between(35, 260);
    const startedAt = lead.lastContactedAt!;
    const outcome =
      status === "INTERESTED" || status === "DEMO_BOOKED" || status === "CONVERTED" ? "INTERESTED"
      : status === "FOLLOW_UP" || status === "NEGOTIATION" ? "FOLLOW_UP"
      : status === "NOT_INTERESTED" || status === "LOST" ? "NOT_INTERESTED"
      : "NO_ANSWER";

    const connected = outcome !== "NO_ANSWER";
    const aiAgent = aiAgents[i % aiAgents.length];

    const call = await prisma.call.create({
      data: {
        tenantId: tenant.id,
        leadId: lead.id,
        campaignId: campaign.id,
        aiAgentId: aiAgent.id,
        phone: lead.phone,
        direction: "OUTBOUND",
        status: connected ? "COMPLETED" : "NO_ANSWER",
        outcome,
        durationSeconds: connected ? duration : 0,
        queuedAt: startedAt,
        startedAt,
        answeredAt: connected ? new Date(startedAt.getTime() + 6000) : null,
        endedAt: new Date(startedAt.getTime() + duration * 1000),
        creditsUsed: connected ? Math.max(1, Math.ceil(duration / 60)) : 0,
        provider: "sandbox",
      },
    });

    await prisma.callParticipant.createMany({
      data: [
        { tenantId: tenant.id, callId: call.id, role: "AI_AGENT", label: `${aiAgent.name} (AI)`, joinedAt: startedAt },
        { tenantId: tenant.id, callId: call.id, role: "LEAD", label: lead.contactPerson ?? lead.name, joinedAt: startedAt },
      ],
    });

    if (!connected) continue;

    const recording = await prisma.recording.create({
      data: {
        tenantId: tenant.id,
        callId: call.id,
        storageKey: `recordings/${tenant.id}/${call.id}.mp3`,
        storageBucket: "appsgain-dev",
        sizeBytes: BigInt(duration * 13_000),
        durationSeconds: duration,
      },
    });
    void recording;

    const turns = [
      { speaker: "AI_AGENT" as const, label: `${aiAgent.name} (AI)`,
        text: `Hello, this is ${aiAgent.name} from ${spec.name}. Do you have two minutes?` },
      { speaker: "LEAD" as const, label: lead.contactPerson ?? "Client", text: "Yes, go ahead." },
      { speaker: "AI_AGENT" as const, label: `${aiAgent.name} (AI)`,
        text: "We help teams automate outbound calling and lead qualification. How are you handling that today?" },
      { speaker: "LEAD" as const, label: lead.contactPerson ?? "Client",
        text: outcome === "INTERESTED" ? "Mostly manual. That sounds useful — can you show me?"
          : outcome === "FOLLOW_UP" ? "I'd need to check with my team first."
          : "We already have something in place, thanks." },
    ];

    const transcript = await prisma.transcript.create({
      data: {
        tenantId: tenant.id,
        callId: call.id,
        language: aiAgent.language,
        confidence: 0.93,
        provider: "sandbox",
        summary:
          outcome === "INTERESTED"
            ? "Prospect qualified. Manual process today, asked for a demo."
            : outcome === "FOLLOW_UP"
              ? "Reached a non-decision-maker. Interest is plausible but unconfirmed."
              : "Already using a competing product; no opening at present.",
        sentiment: outcome === "INTERESTED" ? "POSITIVE" : outcome === "FOLLOW_UP" ? "NEUTRAL" : "NEGATIVE",
        suggestedOutcome: outcome,
        analysedAt: new Date(startedAt.getTime() + duration * 1000 + 30_000),
      },
    });

    await prisma.transcriptSegment.createMany({
      data: turns.map((t, seq) => ({
        tenantId: tenant.id,
        transcriptId: transcript.id,
        sequence: seq,
        speaker: t.speaker,
        speakerLabel: t.label,
        text: t.text,
        startMs: seq * Math.floor((duration * 1000) / turns.length),
        endMs: (seq + 1) * Math.floor((duration * 1000) / turns.length),
        confidence: 0.93,
      })),
    });

    await prisma.salesNote.create({
      data: {
        tenantId: tenant.id,
        leadId: lead.id,
        callId: call.id,
        campaignId: campaign.id,
        content: transcript.summary!,
        type: outcome === "INTERESTED" ? "DEMO" : outcome === "FOLLOW_UP" ? "FOLLOW_UP" : "NEGATIVE",
        sentiment: transcript.sentiment,
        isAiGenerated: true,
        createdAt: transcript.analysedAt!,
      },
    });

    if (outcome === "INTERESTED" || outcome === "FOLLOW_UP") {
      const dueAt = daysAhead(between(-4, 9), between(10, 17));
      const followUp = await prisma.followUp.create({
        data: {
          tenantId: tenant.id,
          leadId: lead.id,
          campaignId: campaign.id,
          callId: call.id,
          assigneeId: lead.ownerId,
          dueAt,
          channel: "CALL",
          priority: outcome === "INTERESTED" ? "HIGH" : "MEDIUM",
          // Only PENDING and COMPLETED are stored; "today" and "overdue" are read off
          // dueAt, which is why some of these dates are deliberately in the past.
          status: dueAt < new Date() && i % 3 === 0 ? "COMPLETED" : "PENDING",
          completedAt: dueAt < new Date() && i % 3 === 0 ? dueAt : null,
          notes: outcome === "INTERESTED" ? "Send pricing, then confirm the demo slot."
                                          : "Ask for the decision maker by name.",
          isAiGenerated: true,
          remindAt: new Date(dueAt.getTime() - 30 * 60_000),
        },
      });

      if (outcome === "INTERESTED") {
        await prisma.calendarEvent.create({
          data: {
            tenantId: tenant.id,
            title: `Demo — ${lead.name}`,
            type: "DEMO",
            startAt: dueAt,
            endAt: new Date(dueAt.getTime() + 45 * 60_000),
            ownerId: lead.ownerId,
            leadId: lead.id,
            campaignId: campaign.id,
            followUpId: followUp.id,
          },
        });
      }
    }
  }

  // ── a few notifications, so the bell is not empty ─────────────────────────────────
  const notifCount = await prisma.notification.count({ where: { tenantId: tenant.id } });
  if (notifCount === 0) {
    await prisma.notification.createMany({
      data: [
        { tenantId: tenant.id, userId: owner.id, type: "INTERESTED_LEAD",
          title: "New interested lead", body: "Meridian Software marked interested after an AI call.",
          linkPath: "/leads", createdAt: daysAgo(0, 11, 20) },
        { tenantId: tenant.id, userId: owner.id, type: "FOLLOWUP_DUE",
          title: "Follow-ups due today", body: "You have follow-ups scheduled for today.",
          linkPath: "/follow-ups", createdAt: daysAgo(0, 9, 5) },
        { tenantId: tenant.id, userId: owner.id, type: "CREDITS_LOW",
          title: "Credits running low", body: "Your workspace is below 25% of its monthly allowance.",
          linkPath: "/settings/credits", createdAt: daysAgo(1, 16, 40) },
      ],
    });
  }

  // ── one pending invitation, so Team has something to show ─────────────────────────
  const inviteEmail = `newhire@${spec.subdomain}.test`;
  const existingInvite = await prisma.invitation.findFirst({
    where: { tenantId: tenant.id, email: inviteEmail },
  });
  if (!existingInvite) {
    await prisma.invitation.create({
      data: {
        tenantId: tenant.id,
        email: inviteEmail,
        name: "Ananya Iyer",
        role: "AGENT",
        // Only the digest is stored, exactly as the real invite flow does it.
        tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
        invitedById: owner.id,
        expiresAt: daysAhead(7),
      },
    });
  }

  // Serial, not Promise.all: the dev database (scripts/dev-db.mjs) serves one connection
  // at a time, and three concurrent counts is enough to make it drop the pool. Against a
  // real Postgres either shape works, so the sequential one costs nothing and runs
  // everywhere.
  const leadCount = await prisma.lead.count({ where: { tenantId: tenant.id } });
  const callCount = await prisma.call.count({ where: { tenantId: tenant.id } });
  const followUpCount = await prisma.followUp.count({ where: { tenantId: tenant.id } });
  console.log(`  ${spec.subdomain}: ${leadCount} leads, ${callCount} calls, ${followUpCount} follow-ups`);
}

async function main() {
  console.log("seeding…");
  await seedPermissions();
  await seedPlans();

  // Two workspaces on purpose — see the note at the top of this file.
  await seedTenant({
    name: "Northwind Solutions", subdomain: "northwind",
    industry: "IT Services", planKey: "professional", leadCount: 60, variant: 0,
  });
  await seedTenant({
    name: "Cobalt Interactive", subdomain: "cobalt",
    industry: "Software", planKey: "starter", leadCount: 25, variant: 1,
  });

  console.log(`\ndemo logins — password: ${DEMO_PASSWORD}`);
  console.log("  owner@northwind.test   (OWNER,   Northwind Solutions)");
  console.log("  manager@northwind.test (MANAGER, Northwind Solutions)");
  console.log("  agent@northwind.test   (AGENT,   Northwind Solutions)");
  console.log("  viewer@northwind.test  (VIEWER,  Northwind Solutions)");
  console.log("  owner@cobalt.test      (OWNER,   Cobalt Interactive)");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
