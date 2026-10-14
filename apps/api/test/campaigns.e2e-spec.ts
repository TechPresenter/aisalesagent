import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  createLead,
  createTestApp,
  createWorkspace,
  resetDatabase,
  type TestWorkspace,
} from "./helpers";

/**
 * A campaign from creation to dialling: configured, given leads, and activated — and
 * refused activation, with the reasons, until it has an agent, a script and a lead.
 *
 * Until the campaign page existed none of this was reachable from the app, so the API
 * is the contract the page is built on: what PATCH accepts, what it copies from the agent
 * on its own, and what activation insists on.
 */
describe("Campaigns", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let alpha: TestWorkspace;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    alpha = await createWorkspace(app, "campaigns-alpha");
  });

  const authed = (workspace: { accessToken: string }) => ({
    Authorization: `Bearer ${workspace.accessToken}`,
  });

  const api = (workspace: TestWorkspace = alpha) => ({
    get: (path: string) => request(app.getHttpServer()).get(`/api${path}`).set(authed(workspace)),
    post: (path: string, body: object = {}) =>
      request(app.getHttpServer()).post(`/api${path}`).set(authed(workspace)).send(body),
    patch: (path: string, body: object) =>
      request(app.getHttpServer()).patch(`/api${path}`).set(authed(workspace)).send(body),
  });

  /** An agent with a script: an opening line, one question, one objection and a closing. */
  async function createAgent(
    workspace: TestWorkspace = alpha,
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string }> {
    const response = await api(workspace)
      .post("/agents", {
        name: "Asha",
        openingMessage: "Hello, this is Asha. Do you have two minutes?",
        qualificationQuestions: [
          { id: "q1", question: "What are you using today?", required: true },
        ],
        objectionHandling: [
          { id: "o1", objection: "Too expensive", response: "Plans start small." },
        ],
        closingInstructions: "Offer a demo slot this week.",
        ...overrides,
      })
      .expect(201);
    return response.body;
  }

  async function createCampaign(body: Record<string, unknown> = {}, workspace = alpha) {
    const response = await api(workspace)
      .post("/campaigns", { name: "Q4 Outbound", ...body })
      .expect(201);
    return response.body as {
      id: string;
      status: string;
      timezone: string | null;
      callScript: string | null;
      aiAgentId: string | null;
    };
  }

  describe("creating", () => {
    it("starts as a draft that follows the workspace's calling timezone", async () => {
      const campaign = await createCampaign();

      expect(campaign.status).toBe("DRAFT");
      // Empty, so the calling gate reads the workspace's own zone at dial time.
      expect(campaign.timezone).toBeNull();
    });

    it("keeps a timezone someone picked", async () => {
      const campaign = await createCampaign({ timezone: "Asia/Dubai" });
      expect(campaign.timezone).toBe("Asia/Dubai");
    });

    it("copies the agent's script when it names an agent and brings no script of its own", async () => {
      const agent = await createAgent();
      const campaign = await createCampaign({ aiAgentId: agent.id });

      expect(campaign.callScript).toBe(
        [
          "Opening",
          "Hello, this is Asha. Do you have two minutes?",
          "",
          "Questions to ask",
          "1. What are you using today? (must ask)",
          "",
          "If they object",
          '- "Too expensive": Plans start small.',
          "",
          "Closing",
          "Offer a demo slot this week.",
        ].join("\n"),
      );
    });

    it("keeps a script it was given", async () => {
      const agent = await createAgent();
      const campaign = await createCampaign({ aiAgentId: agent.id, callScript: "Our own words." });
      expect(campaign.callScript).toBe("Our own words.");
    });

    it("refuses another workspace's agent", async () => {
      const beta = await createWorkspace(app, "campaigns-beta");
      const theirs = await createAgent(beta);

      const response = await api()
        .post("/campaigns", { name: "Borrowed agent", aiAgentId: theirs.id })
        .expect(400);
      expect(response.body.message).toMatch(/does not exist in this workspace/);
    });
  });

  describe("configuring", () => {
    it("saves the agent, the script and the whole schedule", async () => {
      const agent = await createAgent();
      const campaign = await createCampaign();

      const response = await api()
        .patch(`/campaigns/${campaign.id}`, {
          aiAgentId: agent.id,
          callScript: "Hello from the campaign.",
          callWindowStart: 600,
          callWindowEnd: 1080,
          callDays: [1, 2, 3, 4, 5],
          timezone: "Europe/London",
          startDate: "2026-11-02",
          endDate: "2026-11-30",
          dailyCallLimit: 150,
          maxAttempts: 4,
          retryDelayMinutes: 120,
        })
        .expect(200);

      expect(response.body).toMatchObject({
        aiAgentId: agent.id,
        callScript: "Hello from the campaign.",
        callWindowStart: 600,
        callWindowEnd: 1080,
        callDays: [1, 2, 3, 4, 5],
        timezone: "Europe/London",
        dailyCallLimit: 150,
        maxAttempts: 4,
        retryDelayMinutes: 120,
      });
      expect(response.body.startDate.slice(0, 10)).toBe("2026-11-02");
      expect(response.body.endDate.slice(0, 10)).toBe("2026-11-30");
    });

    it("copies the agent's script when an agent is chosen for a campaign with none", async () => {
      const agent = await createAgent();
      const campaign = await createCampaign();
      expect(campaign.callScript).toBeNull();

      const response = await api()
        .patch(`/campaigns/${campaign.id}`, { aiAgentId: agent.id })
        .expect(200);
      expect(response.body.callScript).toMatch(/^Opening\nHello, this is Asha/);
    });

    it("clears the optional settings with null, back to the workspace's", async () => {
      const campaign = await createCampaign({
        timezone: "Asia/Dubai",
        callWindowStart: 600,
        callWindowEnd: 1080,
        dailyCallLimit: 50,
        startDate: "2026-11-02",
      });

      const response = await api()
        .patch(`/campaigns/${campaign.id}`, {
          timezone: null,
          callWindowStart: null,
          callWindowEnd: null,
          dailyCallLimit: null,
          startDate: null,
          // Ignored rather than an error: the name cannot be empty.
          name: null,
        })
        .expect(200);

      expect(response.body).toMatchObject({
        name: "Q4 Outbound",
        timezone: null,
        callWindowStart: null,
        callWindowEnd: null,
        dailyCallLimit: null,
        startDate: null,
      });
    });

    it("refuses a timezone that is not an IANA zone", async () => {
      const campaign = await createCampaign();

      for (const timezone of ["Mars/Base", "IST", "+05:30"]) {
        const response = await api().patch(`/campaigns/${campaign.id}`, { timezone }).expect(400);
        expect(JSON.stringify(response.body.message)).toMatch(/IANA timezone/);
      }
      await api().post("/campaigns", { name: "Martian", timezone: "Mars/Base" }).expect(400);
    });

    it("refuses a calling window that ends when or before it starts", async () => {
      const campaign = await createCampaign();

      await api()
        .patch(`/campaigns/${campaign.id}`, { callWindowStart: 1080, callWindowEnd: 600 })
        .expect(400);
      await api()
        .patch(`/campaigns/${campaign.id}`, { callWindowStart: 600, callWindowEnd: 600 })
        .expect(400);
    });

    it("judges a change to one end of the window against the saved other end", async () => {
      const campaign = await createCampaign({ callWindowStart: 600, callWindowEnd: 1080 });

      const response = await api()
        .patch(`/campaigns/${campaign.id}`, { callWindowEnd: 540 })
        .expect(400);
      expect(response.body.message).toBe("The calling window must end after it starts.");

      // Half a window would be finished by the workspace's other half at dial time.
      await api().patch(`/campaigns/${campaign.id}`, { callWindowStart: null }).expect(400);
      await api().post("/campaigns", { name: "Half window", callWindowStart: 600 }).expect(400);
    });

    it("refuses an end date that is not after the start date, including against the saved one", async () => {
      await api()
        .post("/campaigns", { name: "Backwards", startDate: "2026-11-30", endDate: "2026-11-01" })
        .expect(400);

      const campaign = await createCampaign({ startDate: "2026-11-10" });
      const response = await api()
        .patch(`/campaigns/${campaign.id}`, { endDate: "2026-11-05" })
        .expect(400);
      expect(response.body.message).toBe("The end date must be after the start date.");
    });

    it("answers 404 for a campaign that is not there", async () => {
      await api()
        .patch("/campaigns/00000000-0000-4000-8000-000000000000", { name: "Ghost" })
        .expect(404);
    });
  });

  describe("adding leads", () => {
    it("adds leads by id, skipping do-not-call leads and ones already added", async () => {
      const campaign = await createCampaign();
      const callable = await createLead(app, alpha, { name: "Callable Traders" });
      const optedOut = await createLead(app, alpha, { name: "Opted Out Ltd" });
      await api().patch(`/leads/${optedOut.id}`, { doNotCall: true }).expect(200);

      const first = await api()
        .post(`/campaigns/${campaign.id}/leads`, { leadIds: [callable.id, optedOut.id] })
        .expect(200);
      expect(first.body).toEqual({ added: 1, skipped: 1 });

      const again = await api()
        .post(`/campaigns/${campaign.id}/leads`, { leadIds: [callable.id] })
        .expect(200);
      expect(again.body).toEqual({ added: 0, skipped: 1 });

      const listed = await api().get(`/campaigns/${campaign.id}/leads`).expect(200);
      expect(listed.body.total).toBe(1);
      expect(listed.body.data[0]).toMatchObject({
        leadId: callable.id,
        state: "PENDING",
        attempts: 0,
        lead: { id: callable.id, name: "Callable Traders", doNotCall: false },
      });
    });

    it("adds every lead matching the Leads list's filter", async () => {
      const campaign = await createCampaign();
      await api()
        .post("/leads", { name: "Hot One", phone: "9811100001", status: "INTERESTED" })
        .expect(201);
      await api()
        .post("/leads", { name: "Hot Two", phone: "9811100002", status: "INTERESTED" })
        .expect(201);
      await api()
        .post("/leads", { name: "Cold One", phone: "9811100003", status: "LOST" })
        .expect(201);

      const response = await api()
        .post(`/campaigns/${campaign.id}/leads`, {
          allMatchingFilter: true,
          status: ["INTERESTED"],
        })
        .expect(200);
      expect(response.body).toEqual({ added: 2, skipped: 0 });

      const searched = await api()
        .get(`/campaigns/${campaign.id}/leads?search=hot two`)
        .expect(200);
      expect(searched.body.data.map((row: { lead: { name: string } }) => row.lead.name)).toEqual([
        "Hot Two",
      ]);
    });

    it("refuses a filter by campaign status, which the old body took by mistake", async () => {
      const campaign = await createCampaign();
      await api()
        .post(`/campaigns/${campaign.id}/leads`, { allMatchingFilter: true, status: ["ACTIVE"] })
        .expect(400);
    });

    it("never adds another workspace's leads, and never shows its campaign's", async () => {
      const beta = await createWorkspace(app, "campaigns-beta");
      const theirLead = await createLead(app, beta);
      const theirCampaign = await createCampaign({ name: "Beta Outbound" }, beta);
      const campaign = await createCampaign();

      const response = await api()
        .post(`/campaigns/${campaign.id}/leads`, { leadIds: [theirLead.id] })
        .expect(200);
      expect(response.body).toEqual({ added: 0, skipped: 1 });

      await api().get(`/campaigns/${theirCampaign.id}/leads`).expect(404);
      await api().patch(`/campaigns/${theirCampaign.id}`, { name: "Taken over" }).expect(404);
    });
  });

  describe("activating", () => {
    it("is refused, with everything missing, until the campaign has an agent, a script and a lead", async () => {
      const campaign = await createCampaign();

      const bare = await api().post(`/campaigns/${campaign.id}/activate`).expect(400);
      expect(bare.body.message).toBe(
        "Before activating, assign an AI agent, add a call script, add at least one lead.",
      );

      // An agent with no script of its own: the campaign still has none to copy.
      const silent = await createAgent(alpha, {
        name: "Silent",
        openingMessage: undefined,
        qualificationQuestions: [],
        objectionHandling: [],
        closingInstructions: undefined,
      });
      await api().patch(`/campaigns/${campaign.id}`, { aiAgentId: silent.id }).expect(200);
      const noScript = await api().post(`/campaigns/${campaign.id}/activate`).expect(400);
      expect(noScript.body.message).toBe(
        "Before activating, add a call script, add at least one lead.",
      );

      const agent = await createAgent();
      const configured = await api()
        .patch(`/campaigns/${campaign.id}`, {
          aiAgentId: agent.id,
          callWindowStart: 600,
          callWindowEnd: 1140,
          callDays: [1, 2, 3, 4, 5],
          timezone: "Asia/Kolkata",
        })
        .expect(200);
      expect(configured.body.callScript).toMatch(/^Opening/);

      const noLeads = await api().post(`/campaigns/${campaign.id}/activate`).expect(400);
      expect(noLeads.body.message).toBe("Before activating, add at least one lead.");
      expect((await api().get(`/campaigns/${campaign.id}`).expect(200)).body.status).toBe("DRAFT");

      const lead = await createLead(app, alpha);
      await api()
        .post(`/campaigns/${campaign.id}/leads`, { leadIds: [lead.id] })
        .expect(200);

      const active = await api().post(`/campaigns/${campaign.id}/activate`).expect(200);
      expect(active.body.status).toBe("ACTIVE");
      expect(active.body.stats.leads).toBe(1);
    });

    it("then pauses, resumes and completes, after which it takes no more leads", async () => {
      const agent = await createAgent();
      const campaign = await createCampaign({ aiAgentId: agent.id });
      const lead = await createLead(app, alpha);
      await api()
        .post(`/campaigns/${campaign.id}/leads`, { leadIds: [lead.id] })
        .expect(200);
      await api().post(`/campaigns/${campaign.id}/activate`).expect(200);

      expect((await api().post(`/campaigns/${campaign.id}/pause`).expect(200)).body.status).toBe(
        "PAUSED",
      );
      // Resuming is activating a paused campaign; the checks run again and pass.
      expect((await api().post(`/campaigns/${campaign.id}/activate`).expect(200)).body.status).toBe(
        "ACTIVE",
      );
      expect((await api().post(`/campaigns/${campaign.id}/complete`).expect(200)).body.status).toBe(
        "COMPLETED",
      );

      const another = await createLead(app, alpha);
      await api()
        .post(`/campaigns/${campaign.id}/leads`, { leadIds: [another.id] })
        .expect(400);
    });
  });
});
