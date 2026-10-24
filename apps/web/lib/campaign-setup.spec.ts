import type { ApiCampaign } from "./api-client";
import {
  campaignReadiness,
  describeDays,
  minutesToTime,
  scriptFromAgent,
  settingsForm,
  settingsPatch,
  settingsProblems,
  timeToMinutes,
  timezoneOptions,
  toDateInput,
} from "./campaign-setup";

const EMPTY_AGENT = {
  openingMessage: null,
  qualificationQuestions: null,
  objectionHandling: null,
  closingInstructions: null,
};

const STATS = {
  leads: 0,
  calls: 0,
  connected: 0,
  interested: 0,
  demoBooked: 0,
  converted: 0,
  followUps: 0,
  creditsUsed: 0,
  connectRate: 0,
  conversionRate: 0,
};

describe("scriptFromAgent", () => {
  it("writes the same script the API copies in", () => {
    // The fixture and the expected text are the API's own test
    // (apps/api/src/campaigns/campaign-script.spec.ts): the prefilled box and the saved
    // script must not disagree.
    const script = scriptFromAgent({
      openingMessage: "  Hello, this is Asha from Acme. Do you have two minutes?  ",
      qualificationQuestions: [
        { id: "q1", question: "What are you using today?", required: true },
        { id: "q2", question: "Who else decides?", required: false },
      ],
      objectionHandling: [
        { id: "o1", objection: "Too expensive", response: "Plans start small and scale with use." },
      ],
      closingInstructions: "Offer a demo slot this week.",
    });

    expect(script).toBe(
      [
        "Opening",
        "Hello, this is Asha from Acme. Do you have two minutes?",
        "",
        "Questions to ask",
        "1. What are you using today? (must ask)",
        "2. Who else decides?",
        "",
        "If they object",
        '- "Too expensive": Plans start small and scale with use.',
        "",
        "Closing",
        "Offer a demo slot this week.",
      ].join("\n"),
    );
  });

  it("is null for an agent with nothing to say", () => {
    expect(scriptFromAgent(EMPTY_AGENT)).toBeNull();
    expect(
      scriptFromAgent({ ...EMPTY_AGENT, openingMessage: "  ", qualificationQuestions: [] }),
    ).toBeNull();
  });
});

describe("campaignReadiness", () => {
  it("asks an AI calling campaign for an agent, a script and a lead", () => {
    const items = campaignReadiness({
      type: "AI_CALLING",
      aiAgentId: null,
      callScript: "   ",
      stats: STATS,
    });
    expect(items.map((item) => [item.key, item.done])).toEqual([
      ["agent", false],
      ["script", false],
      ["leads", false],
    ]);

    const ready = campaignReadiness({
      type: "AI_CALLING",
      aiAgentId: "agent-1",
      callScript: "Hello",
      stats: { ...STATS, leads: 3 },
    });
    expect(ready.every((item) => item.done)).toBe(true);
  });

  it("asks any other campaign only for a lead, as the API does", () => {
    const items = campaignReadiness({
      type: "MULTI_CHANNEL",
      aiAgentId: null,
      callScript: null,
      stats: STATS,
    });
    expect(items.map((item) => item.key)).toEqual(["leads"]);
  });
});

describe("clock and calendar fields", () => {
  it("turns minutes from midnight into a time input's value and back", () => {
    expect(minutesToTime(600)).toBe("10:00");
    expect(minutesToTime(1139)).toBe("18:59");
    expect(timeToMinutes("10:00")).toBe(600);
    expect(timeToMinutes("9:30")).toBe(570);
  });

  it("reads an emptied or impossible time as not set", () => {
    expect(timeToMinutes("")).toBeNull();
    expect(timeToMinutes("24:00")).toBeNull();
    expect(timeToMinutes("10:75")).toBeNull();
  });

  it("gives a date input the calendar date of a stored timestamp", () => {
    expect(toDateInput("2026-11-02T00:00:00.000Z")).toBe("2026-11-02");
    expect(toDateInput(null)).toBe("");
  });
});

describe("timezoneOptions", () => {
  it("shows ICU's older names under their current ones, once, sorted, with UTC", () => {
    const options = timezoneOptions(null, () => ["Europe/London", "Asia/Calcutta", "Europe/Kiev"]);
    expect(options).toEqual(["Asia/Kolkata", "Europe/Kyiv", "Europe/London", "UTC"]);
  });

  it("keeps a zone a campaign already holds, even if the list lacks it", () => {
    expect(timezoneOptions("America/Argentina/Salta", () => ["Asia/Dubai"])).toEqual([
      "America/Argentina/Salta",
      "Asia/Dubai",
      "UTC",
    ]);
  });

  it("falls back to a short list where the browser cannot list zones", () => {
    const options = timezoneOptions(null, () => {
      throw new TypeError("Intl.supportedValuesOf is not a function");
    });
    expect(options).toContain("Asia/Kolkata");
    expect(options).toContain("Europe/London");
  });
});

const CAMPAIGN: ApiCampaign = {
  id: "c1",
  name: "Q4 Outbound",
  description: null,
  type: "AI_CALLING",
  status: "DRAFT",
  targetAudience: null,
  aiAgentId: "agent-1",
  callScript: "Hello",
  aiInstructions: null,
  startDate: "2026-11-02T00:00:00.000Z",
  endDate: null,
  dailyCallLimit: null,
  callWindowStart: 600,
  callWindowEnd: 1080,
  callDays: [5, 1, 3],
  timezone: null,
  language: "en",
  maxAttempts: 3,
  retryDelayMinutes: 240,
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
  stats: STATS,
};

describe("the settings form", () => {
  it("reads a campaign into text fields, empty where the workspace's setting applies", () => {
    expect(settingsForm(CAMPAIGN)).toEqual({
      aiAgentId: "agent-1",
      callScript: "Hello",
      timezone: "",
      windowStart: "10:00",
      windowEnd: "18:00",
      callDays: [1, 3, 5],
      startDate: "2026-11-02",
      endDate: "",
      dailyCallLimit: "",
      maxAttempts: "3",
      retryDelayMinutes: "240",
    });
  });

  it("writes every field back, empty ones as null", () => {
    expect(settingsPatch(settingsForm(CAMPAIGN), true)).toEqual({
      aiAgentId: "agent-1",
      callScript: "Hello",
      timezone: null,
      callWindowStart: 600,
      callWindowEnd: 1080,
      callDays: [1, 3, 5],
      startDate: "2026-11-02",
      endDate: null,
      dailyCallLimit: null,
      maxAttempts: 3,
      retryDelayMinutes: 240,
    });
  });

  it("sends a blank script as null, so the API copies the agent's in", () => {
    const patch = settingsPatch({ ...settingsForm(CAMPAIGN), callScript: "   " }, true);
    expect(patch.callScript).toBeNull();
  });

  it("leaves the agent and script alone for a campaign type that does not dial", () => {
    const patch = settingsPatch(settingsForm(CAMPAIGN), false);
    expect(patch).not.toHaveProperty("aiAgentId");
    expect(patch).not.toHaveProperty("callScript");
  });

  it("finds nothing wrong with a saved campaign", () => {
    expect(settingsProblems(settingsForm(CAMPAIGN))).toEqual([]);
  });

  it("says what the API would refuse", () => {
    const form = settingsForm(CAMPAIGN);
    expect(settingsProblems({ ...form, windowEnd: "" })).toEqual([
      "Set both ends of the calling window, or clear both to use the workspace's hours.",
    ]);
    expect(settingsProblems({ ...form, windowEnd: "09:00" })).toEqual([
      "The calling window must end after it starts.",
    ]);
    expect(settingsProblems({ ...form, startDate: "2026-11-02", endDate: "2026-11-02" })).toEqual([
      "The end date must be after the start date.",
    ]);
    expect(
      settingsProblems({ ...form, dailyCallLimit: "0", maxAttempts: "11", retryDelayMinutes: "2" }),
    ).toHaveLength(3);
  });

  it("accepts both ends of the window cleared, for the workspace's hours", () => {
    expect(settingsProblems({ ...settingsForm(CAMPAIGN), windowStart: "", windowEnd: "" })).toEqual(
      [],
    );
  });
});

describe("describeDays", () => {
  it("names a run of days by its ends, and anything else day by day", () => {
    expect(describeDays([1, 2, 3, 4, 5])).toBe("Mon–Fri");
    expect(describeDays([1, 3, 5])).toBe("Mon, Wed, Fri");
    expect(describeDays([6, 0])).toBe("Sat, Sun");
    expect(describeDays([])).toBe("Every day");
    expect(describeDays([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
  });
});
