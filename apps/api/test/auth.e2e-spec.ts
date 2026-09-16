import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  createTestApp,
  createWorkspace,
  resetDatabase,
  TEST_PASSWORD,
  type TestWorkspace,
} from "./helpers";

describe("Auth and workspace signup", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  describe("POST /workspace", () => {
    it("creates the tenant and its owner together", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/workspace")
        .send({
          name: "Northwind Solutions",
          subdomain: "northwind",
          industryVertical: "Healthcare",
          ownerName: "Shailesh",
          ownerEmail: "shailesh@northwind.io",
          ownerPassword: TEST_PASSWORD,
        })
        .expect(201);

      expect(response.body.tenant.subdomain).toBe("northwind");
      expect(response.body.owner.role).toBe("OWNER");
      // Derived from the camel case, matching the sidebar monogram the web app renders.
      expect(response.body.tenant.brandingConfig.monogram).toBe("DH");

      const users = await prisma.user.findMany({
        where: { tenantId: response.body.tenant.id },
      });
      expect(users).toHaveLength(1);
      expect(users[0].role).toBe("OWNER");
    });

    it("never returns the password or its hash", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/workspace")
        .send({
          name: "Quiet Co",
          subdomain: "quiet-co",
          ownerName: "Owner",
          ownerEmail: "owner@quiet.co",
          ownerPassword: TEST_PASSWORD,
        })
        .expect(201);

      expect(JSON.stringify(response.body)).not.toContain(TEST_PASSWORD);
      expect(JSON.stringify(response.body)).not.toContain("passwordHash");
    });

    it("rejects a duplicate subdomain", async () => {
      const body = {
        name: "First",
        subdomain: "taken",
        ownerName: "Owner",
        ownerEmail: "first@example.com",
        ownerPassword: TEST_PASSWORD,
      };

      await request(app.getHttpServer()).post("/api/workspace").send(body).expect(201);
      await request(app.getHttpServer())
        .post("/api/workspace")
        .send({ ...body, ownerEmail: "second@example.com" })
        .expect(409);
    });

    it("rejects reserved subdomains", async () => {
      await request(app.getHttpServer())
        .post("/api/workspace")
        .send({
          name: "Impostor",
          subdomain: "api",
          ownerName: "Owner",
          ownerEmail: "owner@example.com",
          ownerPassword: TEST_PASSWORD,
        })
        .expect(409);
    });

    it("rejects a short password", async () => {
      await request(app.getHttpServer())
        .post("/api/workspace")
        .send({
          name: "Weak",
          subdomain: "weak-co",
          ownerName: "Owner",
          ownerEmail: "owner@example.com",
          ownerPassword: "short",
        })
        .expect(400);
    });

    it("leaves no tenant behind when the owner cannot be created", async () => {
      // The transaction is the point: a workspace nobody can log into is worse than a
      // failed signup, because the subdomain is now taken.
      await request(app.getHttpServer())
        .post("/api/workspace")
        .send({
          name: "Broken",
          subdomain: "broken-co",
          ownerName: "Owner",
          ownerEmail: "not-an-email",
          ownerPassword: TEST_PASSWORD,
        })
        .expect(400);

      expect(await prisma.tenant.findUnique({ where: { subdomain: "broken-co" } })).toBeNull();
    });

    it("allows the same email to own two different workspaces", async () => {
      const email = "consultant@example.com";

      for (const subdomain of ["client-one", "client-two"]) {
        await request(app.getHttpServer())
          .post("/api/workspace")
          .send({
            name: subdomain,
            subdomain,
            ownerName: "Consultant",
            ownerEmail: email,
            ownerPassword: TEST_PASSWORD,
          })
          .expect(201);
      }

      expect(await prisma.user.count({ where: { email } })).toBe(2);
    });
  });

  describe("POST /auth/login", () => {
    let workspace: TestWorkspace;

    beforeEach(async () => {
      workspace = await createWorkspace(app, "login-tests");
    });

    it("returns a token pair and the session user", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({
          subdomain: workspace.subdomain,
          email: workspace.ownerEmail,
          password: TEST_PASSWORD,
        })
        .expect(200);

      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.refreshToken).toEqual(expect.any(String));
      expect(response.body.user.tenantId).toBe(workspace.tenantId);
      expect(response.body.user.role).toBe("OWNER");
    });

    it("gives the same answer for a wrong password and an unknown account", async () => {
      // Different responses would turn login into a directory of who has an account.
      const wrongPassword = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({
          subdomain: workspace.subdomain,
          email: workspace.ownerEmail,
          password: "definitely-not-the-password",
        })
        .expect(401);

      const unknownUser = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({
          subdomain: workspace.subdomain,
          email: "nobody@example.com",
          password: TEST_PASSWORD,
        })
        .expect(401);

      const unknownWorkspace = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({
          subdomain: "no-such-workspace",
          email: workspace.ownerEmail,
          password: TEST_PASSWORD,
        })
        .expect(401);

      expect(wrongPassword.body.message).toBe(unknownUser.body.message);
      expect(unknownUser.body.message).toBe(unknownWorkspace.body.message);
    });

    it("will not authenticate the right credentials against the wrong workspace", async () => {
      const other = await createWorkspace(app, "other-workspace");

      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({
          subdomain: other.subdomain,
          email: workspace.ownerEmail,
          password: TEST_PASSWORD,
        })
        .expect(401);
    });

    it("refuses a disabled account", async () => {
      await prisma.user.update({
        where: { id: workspace.ownerId },
        data: { status: "DISABLED" },
      });

      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({
          subdomain: workspace.subdomain,
          email: workspace.ownerEmail,
          password: TEST_PASSWORD,
        })
        .expect(401);
    });
  });

  describe("POST /auth/refresh", () => {
    let workspace: TestWorkspace;

    beforeEach(async () => {
      workspace = await createWorkspace(app, "refresh-tests");
    });

    it("exchanges a refresh token for a new pair", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/auth/refresh")
        .send({ refreshToken: workspace.refreshToken })
        .expect(200);

      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.refreshToken).not.toBe(workspace.refreshToken);
    });

    it("rotates: the old token stops working once it has been spent", async () => {
      await request(app.getHttpServer())
        .post("/api/auth/refresh")
        .send({ refreshToken: workspace.refreshToken })
        .expect(200);

      // A stolen refresh token is therefore good for one use, and the theft surfaces as
      // the real user being logged out rather than going unnoticed.
      await request(app.getHttpServer())
        .post("/api/auth/refresh")
        .send({ refreshToken: workspace.refreshToken })
        .expect(401);
    });

    it("re-reads the role from the database rather than trusting the old token", async () => {
      await prisma.user.update({
        where: { id: workspace.ownerId },
        data: { role: "AGENT" },
      });

      const refreshed = await request(app.getHttpServer())
        .post("/api/auth/refresh")
        .send({ refreshToken: workspace.refreshToken })
        .expect(200);

      const me = await request(app.getHttpServer())
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${refreshed.body.accessToken}`)
        .expect(200);

      expect(me.body.role).toBe("AGENT");
    });

    it("refuses an access token presented as a refresh token", async () => {
      // The two are signed with different secrets precisely so this cannot work.
      await request(app.getHttpServer())
        .post("/api/auth/refresh")
        .send({ refreshToken: workspace.accessToken })
        .expect(401);
    });

    it("refuses to refresh a disabled account", async () => {
      await prisma.user.update({
        where: { id: workspace.ownerId },
        data: { status: "DISABLED" },
      });

      await request(app.getHttpServer())
        .post("/api/auth/refresh")
        .send({ refreshToken: workspace.refreshToken })
        .expect(401);
    });
  });

  describe("POST /auth/logout", () => {
    it("revokes the presented session and no other", async () => {
      const workspace = await createWorkspace(app, "logout-tests");

      const second = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({
          subdomain: workspace.subdomain,
          email: workspace.ownerEmail,
          password: TEST_PASSWORD,
        })
        .expect(200);

      await request(app.getHttpServer())
        .post("/api/auth/logout")
        .send({ refreshToken: workspace.refreshToken })
        .expect(204);

      await request(app.getHttpServer())
        .post("/api/auth/refresh")
        .send({ refreshToken: workspace.refreshToken })
        .expect(401);

      // Logging out of a laptop must not sign the phone out too.
      await request(app.getHttpServer())
        .post("/api/auth/refresh")
        .send({ refreshToken: second.body.refreshToken })
        .expect(200);
    });

    it("succeeds for a token that was already revoked", async () => {
      const workspace = await createWorkspace(app, "idempotent-logout");

      await request(app.getHttpServer())
        .post("/api/auth/logout")
        .send({ refreshToken: workspace.refreshToken })
        .expect(204);

      await request(app.getHttpServer())
        .post("/api/auth/logout")
        .send({ refreshToken: workspace.refreshToken })
        .expect(204);
    });
  });

  describe("route protection", () => {
    it("leaves health and signup open", async () => {
      await request(app.getHttpServer()).get("/api/health").expect(200);
    });

    it("closes everything else by default", async () => {
      await request(app.getHttpServer()).get("/api/leads").expect(401);
      await request(app.getHttpServer()).get("/api/workspace").expect(401);
      await request(app.getHttpServer()).get("/api/auth/me").expect(401);
    });
  });
});
