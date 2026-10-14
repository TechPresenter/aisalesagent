import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createSuperAdmin } from "../scripts/create-super-admin";
import { ClerkIdentityVerifier, type ClerkIdentity } from "../src/auth/clerk-identity";
import { TenantAccessService } from "../src/auth/tenant-access.service";
import { base32Decode, hotp, totpStep } from "../src/auth/totp";
import { CreditLedger } from "../src/credits/credit-ledger";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  createTestApp,
  createWorkspace,
  randomIndianMobile,
  resetDatabase,
  TEST_PASSWORD,
  type TestWorkspace,
} from "./helpers";

function configWith(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

interface Operator {
  tenantId: string;
  userId: string;
  accessToken: string;
}

/**
 * The operator console, end to end, through the real guards: who can reach it (only a
 * SUPER_ADMIN, and only while they still are one), what each action does to a
 * workspace's access, and that every action leaves an audit row in that workspace.
 *
 * The operator is created with scripts/create-super-admin.ts, the way production gets one.
 */
describe("Operator console", () => {
  const TRIAL = 50;
  const DAILY_CAP = 1_000;

  let app: INestApplication;
  let prisma: PrismaService;
  let acme: TestWorkspace;
  let operator: Operator;

  /** Clerk, as in sso.e2e-spec.ts: made-up tokens for identities it has verified. */
  const identities = new Map<string, ClerkIdentity>();
  const clerk = {
    enabled: true,
    async identify(token: string): Promise<ClerkIdentity> {
      const identity = identities.get(token);
      if (!identity) throw new Error(`The Clerk stub was not given ${token}`);
      return identity;
    },
  };
  function clerkToken(email: string): string {
    const token = `clerk-session-${identities.size + 1}`;
    identities.set(token, {
      userId: `user_clerk_${identities.size + 1}`,
      primaryEmail: { address: email, verified: true },
      name: "Whoever Holds The Mailbox",
      provider: "google",
    });
    return token;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp((builder) =>
      builder
        .overrideProvider(CreditLedger)
        .useFactory({
          factory: (db: PrismaService) =>
            new CreditLedger(
              db,
              configWith({ TRIAL_CREDITS: String(TRIAL), OPERATOR_DAILY_CREDIT_CAP: String(DAILY_CAP) }),
            ),
          inject: [PrismaService],
        })
        .overrideProvider(ClerkIdentityVerifier)
        .useValue(clerk),
    ));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    acme = await createWorkspace(app, "acme-ops");
    operator = await signInOperator();
  });

  async function signInOperator(): Promise<Operator> {
    const created = await createSuperAdmin(prisma, {
      email: "ops@platform.test",
      name: "Platform Ops",
      password: TEST_PASSWORD,
      subdomain: "platform-ops",
    });
    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ subdomain: "platform-ops", email: "ops@platform.test", password: TEST_PASSWORD })
      .expect(200);
    expect(login.body.user.role).toBe("SUPER_ADMIN");
    return { tenantId: created.tenantId, userId: created.userId, accessToken: login.body.accessToken };
  }

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());

  const auditRows = (tenantId: string, action: string) =>
    prisma.auditLog.findMany({ where: { tenantId, action }, orderBy: { createdAt: "asc" } });

  function createLead(token: string) {
    return http()
      .post("/api/leads")
      .set(as(token))
      .send({ name: "Status Probe", phone: randomIndianMobile() });
  }

  describe("who can reach it", () => {
    it("refuses a workspace owner, even addressing their own workspace", async () => {
      await http().get("/api/admin/tenants").set(as(acme.accessToken)).expect(403);

      // The hole this console must not reopen: an owner granting credits to themselves.
      await http()
        .post(`/api/admin/tenants/${acme.tenantId}/credits`)
        .set(as(acme.accessToken))
        .send({ amount: 500, note: "for me" })
        .expect(403);
      await http()
        .post(`/api/admin/tenants/${operator.tenantId}/suspend`)
        .set(as(acme.accessToken))
        .send({ reason: "turning the tables" })
        .expect(403);

      const grants = await prisma.creditTransaction.count({
        where: { tenantId: acme.tenantId, operation: { not: "PLAN_GRANT" } },
      });
      expect(grants).toBe(0);
    });

    it("refuses an API key, whoever made it", async () => {
      const created = await http()
        .post("/api/api-keys")
        .set(as(acme.accessToken))
        .send({ name: "Sync", scopes: ["leads.view"] })
        .expect(201);
      await http().get("/api/admin/tenants").set("X-API-Key", created.body.secret).expect(403);
    });

    it("refuses an operator who is no longer one, though their token still says so", async () => {
      await prisma.user.update({ where: { id: operator.userId }, data: { role: "OWNER" } });
      await http().get("/api/admin/tenants").set(as(operator.accessToken)).expect(403);
    });

    it("will not act on the operator's own workspace, or one that does not exist", async () => {
      await http()
        .post(`/api/admin/tenants/${operator.tenantId}/suspend`)
        .set(as(operator.accessToken))
        .send({ reason: "lock myself out" })
        .expect(400);
      await http()
        .post(`/api/admin/tenants/${randomUUID()}/suspend`)
        .set(as(operator.accessToken))
        .send({ reason: "nobody" })
        .expect(404);
    });

    it("will not act on another operator's platform workspace either", async () => {
      const other = await createSuperAdmin(prisma, {
        email: "ops-two@platform.test",
        name: "Second Ops",
        password: TEST_PASSWORD,
        subdomain: "platform-two",
      });
      const otherSession = await http()
        .post("/api/auth/login")
        .send({ subdomain: "platform-two", email: "ops-two@platform.test", password: TEST_PASSWORD })
        .expect(200);

      for (const action of ["suspend", "cancel"]) {
        const refused = await http()
          .post(`/api/admin/tenants/${other.tenantId}/${action}`)
          .set(as(operator.accessToken))
          .send({ reason: "one operator closing another" })
          .expect(400);
        expect(refused.body.message).toMatch(/platform workspace/);
      }
      await http()
        .post(`/api/admin/tenants/${other.tenantId}/credits`)
        .set(as(operator.accessToken))
        .send({ amount: 10, note: "to the other platform" })
        .expect(400);

      // Nothing happened to it: still open, and the other operator still signed in.
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: other.tenantId } });
      expect(tenant.status).toBe("ACTIVE");
      await http().get("/api/admin/tenants").set(as(otherSession.body.accessToken)).expect(200);
      await http().post("/api/auth/refresh").send({ refreshToken: otherSession.body.refreshToken }).expect(200);
    });
  });

  describe("GET /admin/tenants", () => {
    it("lists every workspace with status, people, balance and the last 30 days", async () => {
      // The wallet, and with it the trial grant, appears on first use.
      await http().get("/api/credits").set(as(acme.accessToken)).expect(200);

      const response = await http()
        .get("/api/admin/tenants?status=TRIAL&search=ACME")
        .set(as(operator.accessToken))
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.data[0]).toMatchObject({
        id: acme.tenantId,
        subdomain: "acme-ops",
        status: "TRIAL",
        trialEndsAt: null,
        plan: null,
        users: { total: 1, active: 1 },
        balance: TRIAL,
        last30Days: { calls: 0, creditsSpent: 0 },
      });

      const everyone = await http().get("/api/admin/tenants").set(as(operator.accessToken)).expect(200);
      expect(everyone.body.data.map((row: { subdomain: string }) => row.subdomain).sort()).toEqual([
        "acme-ops",
        "platform-ops",
      ]);

      // A list touches no one workspace, so it is recorded in the operator's own.
      expect(await auditRows(operator.tenantId, "platform.tenants.list")).toHaveLength(2);
    });
  });

  describe("POST /admin/tenants/:tenantId/credits", () => {
    const grant = (body: Record<string, unknown>) =>
      http().post(`/api/admin/tenants/${acme.tenantId}/credits`).set(as(operator.accessToken)).send(body);

    it("requires a note", async () => {
      await grant({ amount: 100 }).expect(400);
      await grant({ amount: 100, note: "  " }).expect(400);
    });

    it("credits the target workspace's own wallet and ledger, attributed and audited", async () => {
      const response = await grant({
        amount: 300,
        note: "Paid by bank transfer",
        reference: "INV-1001",
        operation: "PURCHASE",
      }).expect(201);

      // The wallet did not exist yet, so it was created with the trial grant first.
      expect(response.body).toMatchObject({ balance: TRIAL + 300, grantedLast24h: 300, dailyCap: DAILY_CAP });

      const wallet = await http().get("/api/credits").set(as(acme.accessToken)).expect(200);
      expect(wallet.body.balance).toBe(TRIAL + 300);

      const purchase = await prisma.creditTransaction.findFirstOrThrow({
        where: { tenantId: acme.tenantId, operation: "PURCHASE" },
      });
      expect(purchase).toMatchObject({
        type: "CREDIT",
        amount: 300,
        actorId: operator.userId,
        referenceType: "operator",
        referenceId: "INV-1001",
        note: "Paid by bank transfer",
      });

      const [audit] = await auditRows(acme.tenantId, "platform.credits.grant");
      expect(audit).toMatchObject({ actorId: operator.userId, actorEmail: "ops@platform.test" });
      expect(audit.metadata).toMatchObject({ amount: 300, reference: "INV-1001", balanceAfter: TRIAL + 300 });

      // TRD §5: the boundary crossing itself is on file in the workspace reached into.
      expect((await auditRows(acme.tenantId, "platform.cross_tenant_access")).length).toBeGreaterThan(0);

      const reconcile = await http().get("/api/credits/reconcile").set(as(acme.accessToken)).expect(200);
      expect(reconcile.body.drift).toBe(0);
    });

    it("applies a reference once", async () => {
      await grant({ amount: 100, note: "Invoice 7", reference: "INV-7" }).expect(201);
      await grant({ amount: 100, note: "Invoice 7, clicked twice", reference: "INV-7" }).expect(409);

      const wallet = await prisma.creditWallet.findUniqueOrThrow({ where: { tenantId: acme.tenantId } });
      expect(wallet.balance).toBe(TRIAL + 100);
    });

    it("holds one workspace to OPERATOR_DAILY_CREDIT_CAP in any 24 hours", async () => {
      await grant({ amount: DAILY_CAP + 1, note: "too much at once" }).expect(400);
      await grant({ amount: 700, note: "first" }).expect(201);
      const over = await grant({ amount: 400, note: "second" }).expect(400);
      expect(over.body.message).toMatch(/300 can still be granted/);
      await grant({ amount: 300, note: "up to the cap" }).expect(201);

      const wallet = await prisma.creditWallet.findUniqueOrThrow({ where: { tenantId: acme.tenantId } });
      expect(wallet.balance).toBe(TRIAL + DAILY_CAP);
    });
  });

  describe("suspend and reactivate", () => {
    it("makes a suspended workspace read-only, and reactivating restores it", async () => {
      const lead = await createLead(acme.accessToken).expect(201);

      await http()
        .post(`/api/admin/tenants/${acme.tenantId}/suspend`)
        .set(as(operator.accessToken))
        .send({})
        .expect(400);
      const suspended = await http()
        .post(`/api/admin/tenants/${acme.tenantId}/suspend`)
        .set(as(operator.accessToken))
        .send({ reason: "Chargeback under review" })
        .expect(200);
      expect(suspended.body).toMatchObject({ previousStatus: "TRIAL", status: "SUSPENDED" });

      // Reads still work, with the token issued before the suspension.
      await http().get("/api/leads").set(as(acme.accessToken)).expect(200);
      await http().get(`/api/leads/${lead.body.id}`).set(as(acme.accessToken)).expect(200);
      await http().get("/api/credits").set(as(acme.accessToken)).expect(200);

      // Writes do not.
      const refused = await createLead(acme.accessToken).expect(403);
      expect(refused.body.code).toBe("WORKSPACE_SUSPENDED");
      await http()
        .patch(`/api/leads/${lead.body.id}`)
        .set(as(acme.accessToken))
        .send({ city: "Pune" })
        .expect(403);

      // A person's own account security is exempt: this reaches the handler (no such
      // session, so 404) instead of being refused at the door.
      await http().delete(`/api/auth/sessions/${randomUUID()}`).set(as(acme.accessToken)).expect(404);

      // Members can still sign in, to see their data and settle up.
      await http()
        .post("/api/auth/login")
        .send({ subdomain: acme.subdomain, email: acme.ownerEmail, password: TEST_PASSWORD })
        .expect(200);

      const reactivated = await http()
        .post(`/api/admin/tenants/${acme.tenantId}/reactivate`)
        .set(as(operator.accessToken))
        .send({ reason: "Resolved" })
        .expect(200);
      // Back to what it was: a trial, not a workspace that never expires.
      expect(reactivated.body).toMatchObject({ previousStatus: "SUSPENDED", status: "TRIAL" });
      await createLead(acme.accessToken).expect(201);

      const [suspendAudit] = await auditRows(acme.tenantId, "platform.tenant.suspend");
      expect(suspendAudit.metadata).toMatchObject({ from: "TRIAL", to: "SUSPENDED", reason: "Chargeback under review" });
      expect(await auditRows(acme.tenantId, "platform.tenant.reactivate")).toHaveLength(1);
    });

    it("treats a trial that has ended like a suspension until it is reactivated", async () => {
      await prisma.tenant.update({
        where: { id: acme.tenantId },
        data: { trialEndsAt: new Date(Date.now() - 60_000) },
      });
      // As if the guard's 30-second cache had run out.
      app.get(TenantAccessService).forget(acme.tenantId);

      await http().get("/api/leads").set(as(acme.accessToken)).expect(200);
      const refused = await createLead(acme.accessToken).expect(403);
      expect(refused.body.code).toBe("TRIAL_ENDED");

      const reactivated = await http()
        .post(`/api/admin/tenants/${acme.tenantId}/reactivate`)
        .set(as(operator.accessToken))
        .send({})
        .expect(200);
      expect(reactivated.body).toMatchObject({ previousStatus: "TRIAL", status: "ACTIVE" });
      await createLead(acme.accessToken).expect(201);
    });

    describe("a workspace suspended mid-trial", () => {
      const trialEnds = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const post = (action: string, body: Record<string, unknown>) =>
        http().post(`/api/admin/tenants/${acme.tenantId}/${action}`).set(as(operator.accessToken)).send(body);

      beforeEach(async () => {
        await prisma.tenant.update({ where: { id: acme.tenantId }, data: { trialEndsAt: trialEnds } });
        await post("suspend", { reason: "Chargeback under review" }).expect(200);
      });

      it("goes back to its trial, which still ends when it was going to", async () => {
        const reactivated = await post("reactivate", { reason: "Resolved" }).expect(200);
        expect(reactivated.body.status).toBe("TRIAL");
        await createLead(acme.accessToken).expect(201);

        const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: acme.tenantId } });
        expect(tenant).toMatchObject({ status: "TRIAL", trialEndsAt: trialEnds });

        // And when that date comes, it ends like any other trial.
        await prisma.tenant.update({
          where: { id: acme.tenantId },
          data: { trialEndsAt: new Date(Date.now() - 60_000) },
        });
        app.get(TenantAccessService).forget(acme.tenantId);
        const refused = await createLead(acme.accessToken).expect(403);
        expect(refused.body.code).toBe("TRIAL_ENDED");
      });

      it("goes back to its trial after being cancelled too", async () => {
        await post("cancel", { reason: "Requested by the customer" }).expect(200);
        const reactivated = await post("reactivate", {}).expect(200);
        expect(reactivated.body).toMatchObject({ previousStatus: "CANCELLED", status: "TRIAL" });
      });

      it("becomes ACTIVE if the trial ended while it was suspended", async () => {
        await prisma.tenant.update({
          where: { id: acme.tenantId },
          data: { trialEndsAt: new Date(Date.now() - 60_000) },
        });
        const reactivated = await post("reactivate", {}).expect(200);
        expect(reactivated.body.status).toBe("ACTIVE");
        await createLead(acme.accessToken).expect(201);
      });
    });

    it("keeps a paying workspace ACTIVE through a suspension", async () => {
      await prisma.tenant.update({ where: { id: acme.tenantId }, data: { status: "ACTIVE" } });
      app.get(TenantAccessService).forget(acme.tenantId);

      for (const action of ["suspend", "reactivate"]) {
        await http()
          .post(`/api/admin/tenants/${acme.tenantId}/${action}`)
          .set(as(operator.accessToken))
          .send({ reason: "Card declined, then paid" })
          .expect(200);
      }
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: acme.tenantId } });
      expect(tenant.status).toBe("ACTIVE");
    });
  });

  describe("cancel", () => {
    it("closes the workspace: its tokens, sessions and API keys all stop working", async () => {
      const key = await http()
        .post("/api/api-keys")
        .set(as(acme.accessToken))
        .send({ name: "Sync", scopes: ["leads.view"] })
        .expect(201);
      await http().get("/api/leads").set("X-API-Key", key.body.secret).expect(200);

      const cancelled = await http()
        .post(`/api/admin/tenants/${acme.tenantId}/cancel`)
        .set(as(operator.accessToken))
        .send({ reason: "Requested by the customer" })
        .expect(200);
      expect(cancelled.body).toMatchObject({ status: "CANCELLED", apiKeysRevoked: 1 });
      expect(cancelled.body.sessionsRevoked).toBeGreaterThanOrEqual(1);

      const refused = await http().get("/api/leads").set(as(acme.accessToken)).expect(403);
      expect(refused.body.code).toBe("WORKSPACE_CANCELLED");
      await http().post("/api/auth/refresh").send({ refreshToken: acme.refreshToken }).expect(401);
      await http().get("/api/leads").set("X-API-Key", key.body.secret).expect(401);
      await http()
        .post("/api/auth/login")
        .send({ subdomain: acme.subdomain, email: acme.ownerEmail, password: TEST_PASSWORD })
        .expect(401);

      // Closed means closed: no credits, and suspending would reopen it for reading.
      await http()
        .post(`/api/admin/tenants/${acme.tenantId}/credits`)
        .set(as(operator.accessToken))
        .send({ amount: 10, note: "goodwill" })
        .expect(409);
      await http()
        .post(`/api/admin/tenants/${acme.tenantId}/suspend`)
        .set(as(operator.accessToken))
        .send({ reason: "too late" })
        .expect(409);

      const [audit] = await auditRows(acme.tenantId, "platform.tenant.cancel");
      expect(audit.metadata).toMatchObject({ from: "TRIAL", to: "CANCELLED", apiKeysRevoked: 1 });
    });
  });

  /**
   * The only way an operator comes to exist, so the ways it refuses matter as much as the
   * way it succeeds: it must never hand a customer's workspace, or a customer's account,
   * the platform's keys.
   */
  describe("scripts/create-super-admin.ts", () => {
    it("will not turn a customer's workspace into the platform's", async () => {
      await expect(
        createSuperAdmin(prisma, {
          email: "intruder@platform.test",
          name: "Not Ops",
          password: TEST_PASSWORD,
          subdomain: acme.subdomain,
        }),
      ).rejects.toThrow(/customer workspace/);

      const people = await prisma.user.findMany({ where: { tenantId: acme.tenantId } });
      expect(people.map((person) => person.role)).toEqual(["OWNER"]);
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: acme.tenantId } });
      expect(tenant.status).toBe("TRIAL");
    });

    it("will not promote an account that is not already an operator", async () => {
      // Someone in the platform workspace who is not a SUPER_ADMIN. The script stops
      // rather than guess that they should be one — and since an operator's workspace
      // holds only operators, a member like this makes it look like a customer's.
      await prisma.user.create({
        data: {
          tenantId: operator.tenantId,
          email: "colleague@platform.test",
          name: "A Colleague",
          role: "VIEWER",
          passwordHash: "not-a-real-hash",
        },
      });

      await expect(
        createSuperAdmin(prisma, {
          email: "colleague@platform.test",
          name: "A Colleague",
          password: TEST_PASSWORD,
          subdomain: "platform-ops",
          resetPassword: true,
        }),
      ).rejects.toThrow(/customer workspace/);

      const colleague = await prisma.user.findUniqueOrThrow({
        where: { tenantId_email: { tenantId: operator.tenantId, email: "colleague@platform.test" } },
      });
      expect(colleague.role).toBe("VIEWER");
    });

    it("refuses to create the same operator twice, and a weak password at all", async () => {
      await expect(
        createSuperAdmin(prisma, {
          email: "ops@platform.test",
          name: "Platform Ops",
          password: TEST_PASSWORD,
          subdomain: "platform-ops",
        }),
      ).rejects.toThrow(/already an operator/);

      await expect(
        createSuperAdmin(prisma, {
          email: "second@platform.test",
          name: "Second Ops",
          password: "too-short",
          subdomain: "platform-ops",
        }),
      ).rejects.toThrow(/12 to 200 characters/);
    });

    it("confirms the operator's address, so Google or Microsoft sign-in meets their 2FA", async () => {
      const created = await prisma.user.findUniqueOrThrow({ where: { id: operator.userId } });
      expect(created.emailVerifiedAt).not.toBeNull();

      const auth = as(operator.accessToken);
      const setup = await http().post("/api/auth/2fa/setup").set(auth).send({ password: TEST_PASSWORD }).expect(200);
      const secret = base32Decode(setup.body.secret);
      await http()
        .post("/api/auth/2fa/confirm")
        .set(auth)
        .send({ code: hotp(secret, totpStep()) })
        .expect(200);

      // Whoever can read the operator's mailbox gets this far, and no further: the
      // challenge, with the operator's password and 2FA enrolment left where they were.
      const response = await http()
        .post("/api/auth/sso/clerk")
        .send({ token: clerkToken("ops@platform.test") })
        .expect(200);
      expect(response.body).toMatchObject({ twoFactorRequired: true, challengeToken: expect.any(String) });
      expect(response.body).not.toHaveProperty("accessToken");
      expect(response.body).not.toHaveProperty("passwordCleared");

      expect(await prisma.twoFactorAuth.count({ where: { userId: operator.userId } })).toBe(1);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: operator.userId } });
      expect(after.hasPassword).toBe(true);
      await http()
        .post("/api/auth/login")
        .send({ subdomain: "platform-ops", email: "ops@platform.test", password: TEST_PASSWORD })
        .expect(200);
    });

    it("resets an operator's password and ends every session the old one opened", async () => {
      const session = await http()
        .post("/api/auth/login")
        .send({ subdomain: "platform-ops", email: "ops@platform.test", password: TEST_PASSWORD })
        .expect(200);
      // An operator from before the script confirmed addresses: a reset confirms it too.
      await prisma.user.update({ where: { id: operator.userId }, data: { emailVerifiedAt: null } });

      const rotated = `${TEST_PASSWORD}-rotated`;
      const result = await createSuperAdmin(prisma, {
        email: "ops@platform.test",
        password: rotated,
        subdomain: "platform-ops",
        resetPassword: true,
      });
      expect(result).toMatchObject({ userId: operator.userId, createdUser: false, createdWorkspace: false });

      await http().post("/api/auth/refresh").send({ refreshToken: session.body.refreshToken }).expect(401);
      await http()
        .post("/api/auth/login")
        .send({ subdomain: "platform-ops", email: "ops@platform.test", password: TEST_PASSWORD })
        .expect(401);
      await http()
        .post("/api/auth/login")
        .send({ subdomain: "platform-ops", email: "ops@platform.test", password: rotated })
        .expect(200);
      const reset = await prisma.user.findUniqueOrThrow({ where: { id: operator.userId } });
      expect(reset.emailVerifiedAt).not.toBeNull();

      expect(await auditRows(operator.tenantId, "platform.operator.password_reset")).toHaveLength(1);
    });
  });
});
