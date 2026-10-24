import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import * as argon2 from "argon2";
import request from "supertest";
import type { Role } from "@appsgain/shared";
import { CreditLedger } from "../src/credits/credit-ledger";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  createTestApp,
  createWorkspace,
  resetDatabase,
  TEST_PASSWORD,
  type TestWorkspace,
} from "./helpers";

/** A ConfigService that answers only the keys given — the credit policy, here. */
function configWith(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/**
 * The credit lockdown, end to end: a workspace cannot mint its own credits any more, and
 * the trial grant that replaces that is applied exactly once and keeps the wallet equal
 * to its ledger.
 *
 * The policy is injected rather than read from the environment, so these hold whatever
 * the developer's .env says about TRIAL_CREDITS.
 */
describe("Credits", () => {
  const TRIAL = 100;

  let app: INestApplication;
  let prisma: PrismaService;
  let alpha: TestWorkspace;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp((builder) =>
      builder.overrideProvider(CreditLedger).useFactory({
        factory: (db: PrismaService) => new CreditLedger(db, configWith({ TRIAL_CREDITS: String(TRIAL) })),
        inject: [PrismaService],
      }),
    ));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    alpha = await createWorkspace(app, "credits-alpha");
  });

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function member(role: Role): Promise<string> {
    const email = `${role.toLowerCase()}@credits-alpha.test`;
    await prisma.user.create({
      data: {
        tenantId: alpha.tenantId,
        email,
        name: `A ${role.toLowerCase()}`,
        role,
        passwordHash: await argon2.hash(TEST_PASSWORD, { type: argon2.argon2id }),
      },
    });
    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ subdomain: alpha.subdomain, email, password: TEST_PASSWORD })
      .expect(200);
    return login.body.accessToken;
  }

  describe("the trial grant", () => {
    it("starts a new workspace with TRIAL_CREDITS as one PLAN_GRANT, however many first requests race", async () => {
      // Three first requests together: each may find no wallet and try to create one. One
      // wins; the others' transactions roll back with their grants.
      const first = await Promise.all(
        [1, 2, 3].map(() => request(app.getHttpServer()).get("/api/credits").set(as(alpha.accessToken))),
      );
      for (const response of first) {
        expect(response.status).toBe(200);
        expect(response.body.balance).toBe(TRIAL);
      }

      const again = await request(app.getHttpServer())
        .get("/api/credits")
        .set(as(alpha.accessToken))
        .expect(200);
      expect(again.body.balance).toBe(TRIAL);

      const ledger = await prisma.creditTransaction.findMany({ where: { tenantId: alpha.tenantId } });
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({
        type: "CREDIT",
        operation: "PLAN_GRANT",
        amount: TRIAL,
        balanceBefore: 0,
        balanceAfter: TRIAL,
        referenceType: "trial",
        referenceId: alpha.tenantId,
      });
    });

    it("keeps the wallet equal to its ledger from the first moment", async () => {
      const reconcile = await request(app.getHttpServer())
        .get("/api/credits/reconcile")
        .set(as(alpha.accessToken))
        .expect(200);
      expect(reconcile.body).toEqual({ walletBalance: TRIAL, ledgerBalance: TRIAL, drift: 0 });
    });

    it("leaves a new workspace's trial open-ended while TRIAL_DAYS is unset", async () => {
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: alpha.tenantId } });
      expect(tenant).toMatchObject({ status: "TRIAL", trialEndsAt: null });
    });
  });

  describe("minting credits from inside a workspace", () => {
    it("is refused to the owner, by name", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/credits/adjust")
        .set(as(alpha.accessToken))
        .send({ amount: 1_000_000, note: "free money" })
        .expect(403);
      expect(response.body.message).toMatch(/credits\.adjust/);

      const wallet = await request(app.getHttpServer())
        .get("/api/credits")
        .set(as(alpha.accessToken))
        .expect(200);
      expect(wallet.body.balance).toBe(TRIAL);
    });

    it("is refused to an admin too", async () => {
      const admin = await member("ADMIN");
      await request(app.getHttpServer())
        .post("/api/credits/adjust")
        .set(as(admin))
        .send({ amount: 10 })
        .expect(403);
    });

    it("cannot be granted to an API key", async () => {
      for (const scope of ["credits.view", "credits.manage", "credits.adjust"]) {
        await request(app.getHttpServer())
          .post("/api/api-keys")
          .set(as(alpha.accessToken))
          .send({ name: "Mint", scopes: [scope] })
          .expect(400);
      }
    });

    it("still lets the owner read and reconcile the ledger", async () => {
      for (const path of ["/api/credits", "/api/credits/history", "/api/credits/usage", "/api/credits/reconcile"]) {
        await request(app.getHttpServer()).get(path).set(as(alpha.accessToken)).expect(200);
      }
    });
  });

  describe("the grant-reference index", () => {
    const row = (overrides: Partial<Prisma.CreditTransactionUncheckedCreateInput>) => ({
      tenantId: alpha.tenantId,
      type: "CREDIT" as const,
      operation: "PURCHASE" as const,
      amount: 10,
      balanceBefore: 0,
      balanceAfter: 10,
      referenceType: "payment",
      referenceId: "pay_123",
      ...overrides,
    });

    // Inside a transaction, as the ledger writes them — which is also the only way the
    // PGlite test database answers a constraint violation without dropping the connection.
    const insert = (data: Prisma.CreditTransactionUncheckedCreateInput) =>
      prisma.$transaction((tx) => tx.creditTransaction.create({ data }), { maxWait: 10_000 });

    it("refuses a second grant against the same reference", async () => {
      await insert(row({}));
      await expect(insert(row({}))).rejects.toMatchObject({ code: "P2002" });
      await expect(insert(row({ operation: "PLAN_GRANT" }))).rejects.toMatchObject({ code: "P2002" });
    });

    it("leaves charges and refunds free to repeat a reference, as calls to one lead do", async () => {
      const lead = { referenceType: "lead", referenceId: "lead-1" };
      await prisma.creditTransaction.createMany({
        data: [
          row({ ...lead, type: "DEBIT", operation: "AI_CALL" }),
          row({ ...lead, type: "DEBIT", operation: "AI_CALL" }),
          row({ ...lead, operation: "REFUND" }),
          row({ ...lead, operation: "REFUND" }),
          // And grants with no reference at all, as every grant before this had.
          row({ referenceType: null, referenceId: null, operation: "MANUAL_ADJUSTMENT" }),
          row({ referenceType: null, referenceId: null, operation: "MANUAL_ADJUSTMENT" }),
        ],
      });
      expect(await prisma.creditTransaction.count({ where: { tenantId: alpha.tenantId } })).toBe(6);
    });

    it("scopes the reference to the workspace", async () => {
      const beta = await createWorkspace(app, "credits-beta");
      await insert(row({}));
      await insert(row({ tenantId: beta.tenantId }));
    });
  });
});
