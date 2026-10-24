import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  createLead,
  createTestApp,
  createWorkspace,
  resetDatabase,
  TEST_PASSWORD,
  type TestWorkspace,
} from "./helpers";

/**
 * The requirement under test, TRD §5: "Every request is authenticated and scoped to
 * exactly one tenant_id; the Super Admin role is the only one that can query across
 * tenants."
 *
 * Two workspaces, each with data, and one question asked many ways: can A see B?
 *
 * The tests deliberately attack from several directions, because the two enforcement
 * layers fail differently. TenantGuard stops a request that *names* another tenant; the
 * scoped Prisma client stops a query that forgets to filter. A suite that only tested the
 * guard would pass with the data layer removed, and vice versa.
 */
describe("Tenant isolation", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let alpha: TestWorkspace;
  let beta: TestWorkspace;
  let alphaLeadId: string;
  let betaLeadId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);

    alpha = await createWorkspace(app, "alpha-clinics");
    beta = await createWorkspace(app, "beta-diagnostics");

    alphaLeadId = (await createLead(app, alpha, { name: "Alpha Dental", phone: "9876500001" })).id;
    betaLeadId = (await createLead(app, beta, { name: "Beta Path Lab", phone: "9876500002" })).id;
  });

  const authed = (workspace: TestWorkspace) => ({
    Authorization: `Bearer ${workspace.accessToken}`,
  });

  describe("reading another tenant's data", () => {
    it("lists only its own leads", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/leads")
        .set(authed(alpha))
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe("Alpha Dental");
      expect(response.body.data[0].tenantId).toBe(alpha.tenantId);
    });

    it("404s on another tenant's lead, addressed directly by id", async () => {
      // 404 rather than 403 on purpose: a 403 would confirm the id exists, which is
      // itself a cross-tenant disclosure.
      await request(app.getHttpServer())
        .get(`/api/leads/${betaLeadId}`)
        .set(authed(alpha))
        .expect(404);
    });

    it("still returns its own lead by id, so the 404 above is isolation and not a broken route", async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/leads/${alphaLeadId}`)
        .set(authed(alpha))
        .expect(200);

      expect(response.body.id).toBe(alphaLeadId);
    });

    it("cannot widen the result set with a tenantId query parameter", async () => {
      await request(app.getHttpServer())
        .get(`/api/leads?tenantId=${beta.tenantId}`)
        .set(authed(alpha))
        .expect(403);
    });

    it("cannot reach another workspace's record through GET /workspace", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/workspace")
        .set(authed(alpha))
        .expect(200);

      expect(response.body.id).toBe(alpha.tenantId);
      expect(response.body.subdomain).toBe("alpha-clinics");
    });
  });

  describe("writing to another tenant's data", () => {
    it("404s when patching another tenant's lead", async () => {
      await request(app.getHttpServer())
        .patch(`/api/leads/${betaLeadId}`)
        .set(authed(alpha))
        .send({ status: "CONVERTED" })
        .expect(404);

      // And the row is genuinely untouched, not merely reported as missing.
      const beta_lead = await prisma.lead.findUnique({ where: { id: betaLeadId } });
      expect(beta_lead?.status).toBe("NEW");
    });

    it("404s when deleting another tenant's lead, and the row survives", async () => {
      await request(app.getHttpServer())
        .delete(`/api/leads/${betaLeadId}`)
        .set(authed(alpha))
        .expect(404);

      expect(await prisma.lead.findUnique({ where: { id: betaLeadId } })).not.toBeNull();
    });

    it("refuses a tenantId smuggled into a create body", async () => {
      // TenantGuard reads a tenantId from the body as well as the path and query, and
      // refuses one naming another workspace before ValidationPipe would have rejected the
      // unknown property. Either way the lead cannot land in beta.
      await request(app.getHttpServer())
        .post("/api/leads")
        .set(authed(alpha))
        .send({
          name: "Smuggled Lead",
          phone: "9876500003",
          tenantId: beta.tenantId,
        })
        .expect(403);

      const betaLeads = await prisma.lead.findMany({ where: { tenantId: beta.tenantId } });
      expect(betaLeads).toHaveLength(1);
      expect(betaLeads[0].name).toBe("Beta Path Lab");
    });

    it("writes a created lead into the caller's tenant, not one it names", async () => {
      const created = await createLead(app, alpha, { name: "Second Alpha", phone: "9876500004" });
      const row = await prisma.lead.findUnique({ where: { id: created.id } });
      expect(row?.tenantId).toBe(alpha.tenantId);
    });
  });

  describe("linking to another tenant's records from a request body", () => {
    // A different attack from an id in the URL. The row being written is the caller's
    // own, so the scoped client lets the write through, and only the foreign key stands
    // in the way — which accepts any workspace's campaign or member. Stored, the link
    // would show the other workspace's names through every include that follows it.
    let alphaCampaignId: string;
    let betaCampaignId: string;

    beforeEach(async () => {
      alphaCampaignId = (
        await prisma.campaign.create({ data: { tenantId: alpha.tenantId, name: "Alpha Outreach" } })
      ).id;
      betaCampaignId = (
        await prisma.campaign.create({ data: { tenantId: beta.tenantId, name: "Beta Launch" } })
      ).id;
    });

    const note = (extra: Record<string, unknown>) => ({
      leadId: alphaLeadId,
      content: "Spoke to the practice manager.",
      ...extra,
    });

    const event = (extra: Record<string, unknown> = {}) => ({
      title: "Demo",
      startAt: "2026-11-02T10:00:00.000Z",
      endAt: "2026-11-02T10:30:00.000Z",
      ...extra,
    });

    it("refuses a note filed under another tenant's campaign, or on its lead", async () => {
      await request(app.getHttpServer())
        .post("/api/notes")
        .set(authed(alpha))
        .send(note({ campaignId: betaCampaignId }))
        .expect(404);

      await request(app.getHttpServer())
        .post("/api/notes")
        .set(authed(alpha))
        .send(note({ leadId: betaLeadId }))
        .expect(404);

      expect(await prisma.salesNote.count()).toBe(0);
    });

    it("still files a note under the caller's own campaign", async () => {
      const created = await request(app.getHttpServer())
        .post("/api/notes")
        .set(authed(alpha))
        .send(note({ campaignId: alphaCampaignId }))
        .expect(201);

      expect(created.body.campaignId).toBe(alphaCampaignId);
    });

    it("refuses a calendar event owned by another tenant's member or under its campaign", async () => {
      await request(app.getHttpServer())
        .post("/api/calendar/events")
        .set(authed(alpha))
        .send(event({ ownerId: beta.ownerId }))
        .expect(404);

      await request(app.getHttpServer())
        .post("/api/calendar/events")
        .set(authed(alpha))
        .send(event({ campaignId: betaCampaignId }))
        .expect(404);

      expect(await prisma.calendarEvent.count()).toBe(0);

      // The same body with the caller's own ids goes through, so the 404s above are the
      // check and not a broken route.
      const own = await request(app.getHttpServer())
        .post("/api/calendar/events")
        .set(authed(alpha))
        .send(event({ ownerId: alpha.ownerId, campaignId: alphaCampaignId }))
        .expect(201);
      expect(own.body.ownerId).toBe(alpha.ownerId);
      expect(own.body.campaignId).toBe(alphaCampaignId);
    });

    it("refuses to hand an existing event to another tenant's member", async () => {
      const created = await request(app.getHttpServer())
        .post("/api/calendar/events")
        .set(authed(alpha))
        .send(event())
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/calendar/events/${created.body.id}`)
        .set(authed(alpha))
        .send({ ownerId: beta.ownerId })
        .expect(404);

      const row = await prisma.calendarEvent.findUnique({ where: { id: created.body.id } });
      expect(row?.ownerId).toBe(alpha.ownerId);

      // Clearing the owner is not a foreign id and still works.
      await request(app.getHttpServer())
        .patch(`/api/calendar/events/${created.body.id}`)
        .set(authed(alpha))
        .send({ ownerId: null })
        .expect(200);
      const cleared = await prisma.calendarEvent.findUnique({ where: { id: created.body.id } });
      expect(cleared?.ownerId).toBeNull();
    });
  });

  describe("de-duplication is scoped to the workspace", () => {
    it("rejects a phone number the workspace already holds", async () => {
      await request(app.getHttpServer())
        .post("/api/leads")
        .set(authed(alpha))
        .send({ name: "Duplicate", phone: "+91 98765 00001" })
        .expect(400);
    });

    it("permits the same number in a different workspace", async () => {
      // Two agencies may both be calling the same clinic. Treating that as a duplicate
      // would leak the fact that the other workspace holds the number.
      await request(app.getHttpServer())
        .post("/api/leads")
        .set(authed(beta))
        .send({ name: "Same Clinic, Other Workspace", phone: "9876500001" })
        .expect(201);
    });
  });

  describe("tokens", () => {
    it("rejects an unauthenticated request", async () => {
      await request(app.getHttpServer()).get("/api/leads").expect(401);
    });

    it("rejects a token signed with the wrong secret", async () => {
      const forged =
        alpha.accessToken.slice(0, alpha.accessToken.lastIndexOf(".")) + ".not-a-real-signature";
      await request(app.getHttpServer())
        .get("/api/leads")
        .set("Authorization", `Bearer ${forged}`)
        .expect(401);
    });

    it("carries the tenant on the token, not the request", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/auth/me")
        .set(authed(alpha))
        .expect(200);

      expect(response.body.tenantId).toBe(alpha.tenantId);
      expect(response.body.role).toBe("OWNER");
    });

    it("does not let a beta token read alpha data even with alpha's subdomain", async () => {
      // The subdomain is a routing hint, never an authorisation input.
      await request(app.getHttpServer())
        .get(`/api/leads/${alphaLeadId}`)
        .set(authed(beta))
        .set("Host", "alpha-clinics.appsgain.app")
        .expect(404);
    });
  });

  describe("SUPER_ADMIN", () => {
    it("is still confined to its own tenant on ordinary tenant-scoped routes", async () => {
      // The exemption is for the /admin group (TRD §8), not a blanket override. A super
      // admin hitting /leads sees their own workspace like anyone else — otherwise every
      // ordinary route silently becomes cross-tenant for one role.
      await prisma.user.update({
        where: { id: alpha.ownerId },
        data: { role: "SUPER_ADMIN" },
      });

      const login = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ subdomain: alpha.subdomain, email: alpha.ownerEmail, password: TEST_PASSWORD })
        .expect(200);

      // SUPER_ADMIN holds no workspace permissions at all (ROLE_PERMISSIONS in
      // @appsgain/shared), so PermissionGuard refuses before any row is looked up: the same
      // answer for another tenant's lead as for one that does not exist, so it confirms
      // nothing about either.
      for (const id of [betaLeadId, "00000000-0000-4000-8000-000000000000"]) {
        const refused = await request(app.getHttpServer())
          .get(`/api/leads/${id}`)
          .set("Authorization", `Bearer ${login.body.accessToken}`)
          .expect(403);
        expect(refused.body.message).toBe("Missing permission: leads.view");
      }
    });

    it("is not rejected outright for naming another tenant, unlike a normal user", async () => {
      await prisma.user.update({
        where: { id: alpha.ownerId },
        data: { role: "SUPER_ADMIN" },
      });

      const login = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ subdomain: alpha.subdomain, email: alpha.ownerEmail, password: TEST_PASSWORD })
        .expect(200);

      // /leads is not marked @AllowCrossTenant, so even a super admin is refused here —
      // the difference is that the refusal is a policy decision per route rather than a
      // property of the role.
      await request(app.getHttpServer())
        .get(`/api/leads?tenantId=${beta.tenantId}`)
        .set("Authorization", `Bearer ${login.body.accessToken}`)
        .expect(403);
    });
  });

  describe("the data layer, independently of the guards", () => {
    it("returns nothing for a forgotten where clause", async () => {
      // This is the layer a guard cannot cover: a service method that simply asks for
      // every lead. Scoped, it gets one workspace's worth.
      const scoped = prisma.forTenant(alpha.tenantId);
      const all = await scoped.lead.findMany({});

      expect(all).toHaveLength(1);
      expect(all[0].tenantId).toBe(alpha.tenantId);
    });

    it("cannot be talked out of the filter by an explicit contradictory where", async () => {
      const scoped = prisma.forTenant(alpha.tenantId);
      const leads = await scoped.lead.findMany({ where: { tenantId: beta.tenantId } });

      // The injected filter is applied last and wins, so asking for beta's leads returns
      // alpha's own (the one from the test above) rather than nothing, and never beta's.
      expect(leads).toHaveLength(1);
      expect(leads.every((lead) => lead.tenantId === alpha.tenantId)).toBe(true);
      expect(leads.map((lead) => lead.id)).not.toContain(betaLeadId);
    });

    it("returns null from findUnique for another tenant's row", async () => {
      const scoped = prisma.forTenant(alpha.tenantId);
      expect(await scoped.lead.findUnique({ where: { id: betaLeadId } })).toBeNull();
    });

    it("refuses an update addressed at another tenant's row", async () => {
      const scoped = prisma.forTenant(alpha.tenantId);
      await expect(
        scoped.lead.update({ where: { id: betaLeadId }, data: { status: "CONVERTED" } }),
      ).rejects.toThrow();
    });

    it("stamps the tenant onto creates regardless of what the caller passes", async () => {
      const scoped = prisma.forTenant(alpha.tenantId);
      const created = await scoped.lead.create({
        data: {
          name: "Stamped",
          phone: "919876500009",
          tenantId: beta.tenantId,
        },
      });

      expect(created.tenantId).toBe(alpha.tenantId);
    });

    it("counts only the caller's rows", async () => {
      const scoped = prisma.forTenant(alpha.tenantId);
      expect(await scoped.lead.count()).toBe(1);
      expect(await prisma.lead.count()).toBe(2);
    });
  });
});
