import { INestApplication, UnauthorizedException } from "@nestjs/common";
import request from "supertest";
import { ClerkIdentityVerifier, type ClerkIdentity } from "../src/auth/clerk-identity";
import { base32Decode, hotp, totpStep } from "../src/auth/totp";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  createTestApp,
  createWorkspace,
  resetDatabase,
  TEST_PASSWORD,
  type TestWorkspace,
} from "./helpers";

/**
 * Google and Microsoft sign-in end to end, with Clerk replaced by a stub that maps made-up
 * tokens to identities. Everything after Clerk is real: the routes, the validation, the
 * database, the sessions — and the signup that finishes on POST /workspace.
 */
describe("Google and Microsoft sign-in (Clerk)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const identities = new Map<string, ClerkIdentity>();
  const clerk = {
    enabled: true,
    async identify(token: string): Promise<ClerkIdentity> {
      const identity = identities.get(token);
      if (!identity)
        throw new UnauthorizedException(
          "Your Google or Microsoft sign-in could not be confirmed. Try again.",
        );
      return identity;
    },
  };

  /** A token the stub will vouch for, as Clerk would after a Google or Microsoft redirect. */
  function clerkToken(email: string, options: { verified?: boolean; name?: string } = {}): string {
    const token = `clerk-session-${identities.size + 1}`;
    identities.set(token, {
      userId: `user_clerk_${identities.size + 1}`,
      primaryEmail: { address: email, verified: options.verified ?? true },
      name: options.name ?? "Priya Sharma",
      provider: "google",
    });
    return token;
  }

  function ssoSignIn(body: Record<string, unknown>) {
    return request(app.getHttpServer()).post("/api/auth/sso/clerk").send(body);
  }

  async function verifiedWorkspace(subdomain: string): Promise<TestWorkspace> {
    const workspace = await createWorkspace(app, subdomain);
    await prisma.user.update({
      where: { id: workspace.ownerId },
      data: { emailVerifiedAt: new Date() },
    });
    return workspace;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp((builder) =>
      builder.overrideProvider(ClerkIdentityVerifier).useValue(clerk),
    ));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    clerk.enabled = true;
  });

  it("answers 503, saying why, while Clerk is not configured", async () => {
    clerk.enabled = false;
    const response = await ssoSignIn({ token: "anything" }).expect(503);
    expect(response.body.message).toMatch(/not set up/);

    await request(app.getHttpServer())
      .post("/api/auth/sso/select")
      .send({ selectionToken: "anything", subdomain: "acme" })
      .expect(503);
  });

  it("refuses a token Clerk did not confirm", async () => {
    await ssoSignIn({ token: "made-up" }).expect(401);
  });

  it("refuses an address Clerk has not verified, even one with an account", async () => {
    const workspace = await verifiedWorkspace("unverified-sso");
    const sessionsBefore = await prisma.refreshToken.count();

    await ssoSignIn({ token: clerkToken(workspace.ownerEmail, { verified: false }) }).expect(401);
    expect(await prisma.refreshToken.count()).toBe(sessionsBefore);
  });

  it("signs in the one account the address has, and leaves its password working", async () => {
    const workspace = await verifiedWorkspace("sso-one");

    const response = await ssoSignIn({
      token: clerkToken(workspace.ownerEmail.toUpperCase()),
    }).expect(200);
    expect(response.body.user).toMatchObject({ tenantId: workspace.tenantId, role: "OWNER" });
    expect(response.body).not.toHaveProperty("passwordCleared");

    const me = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${response.body.accessToken}`)
      .expect(200);
    expect(me.body.tenantId).toBe(workspace.tenantId);

    await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({
        subdomain: workspace.subdomain,
        email: workspace.ownerEmail,
        password: TEST_PASSWORD,
      })
      .expect(200);
  });

  describe("an account whose email was never confirmed", () => {
    // createWorkspace leaves the owner's email unconfirmed, as a real signup does.
    let workspace: TestWorkspace;
    beforeEach(async () => {
      workspace = await createWorkspace(app, "pre-hijacked");
    });

    it("is never opened without asking: the answer is a choice, with what it holds", async () => {
      await request(app.getHttpServer())
        .post("/api/users/invitations")
        .set("Authorization", `Bearer ${workspace.accessToken}`)
        .send({ email: "accomplice@example.com", role: "ADMIN" })
        .expect((response) => expect(response.status).toBeLessThan(300));

      const choice = await ssoSignIn({
        token: clerkToken(workspace.ownerEmail),
        subdomain: workspace.subdomain,
      }).expect(200);
      expect(choice.body).toMatchObject({
        status: "choose-workspace",
        workspaces: [
          {
            subdomain: workspace.subdomain,
            unconfirmed: { otherMembers: 0, pendingInvitations: 1, apiKeys: 0, webhooks: 0 },
          },
        ],
        signup: { email: workspace.ownerEmail, signupToken: expect.any(String) },
      });
      expect(choice.body).not.toHaveProperty("accessToken");

      // Nothing has changed yet: the creator's password still works.
      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({
          subdomain: workspace.subdomain,
          email: workspace.ownerEmail,
          password: TEST_PASSWORD,
        })
        .expect(200);
    });

    it("is taken back from whoever set it up once it is picked", async () => {
      // The creator turned on 2FA too: an authenticator the owner does not have.
      const auth = { Authorization: `Bearer ${workspace.accessToken}` };
      const setup = await request(app.getHttpServer())
        .post("/api/auth/2fa/setup")
        .set(auth)
        .send({ password: TEST_PASSWORD })
        .expect(200);
      await request(app.getHttpServer())
        .post("/api/auth/2fa/confirm")
        .set(auth)
        .send({ code: hotp(base32Decode(setup.body.secret), totpStep()) })
        .expect(200);

      const choice = await ssoSignIn({ token: clerkToken(workspace.ownerEmail) }).expect(200);
      const response = await request(app.getHttpServer())
        .post("/api/auth/sso/select")
        .send({ selectionToken: choice.body.selectionToken, subdomain: workspace.subdomain })
        .expect(200);
      expect(response.body).toMatchObject({
        passwordCleared: true,
        user: { tenantId: workspace.tenantId },
      });
      expect(response.body).not.toHaveProperty("twoFactorRequired");

      // The password, the 2FA enrolment and the session the earlier holder had are all gone…
      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({
          subdomain: workspace.subdomain,
          email: workspace.ownerEmail,
          password: TEST_PASSWORD,
        })
        .expect(401);
      await request(app.getHttpServer())
        .post("/api/auth/refresh")
        .send({ refreshToken: workspace.refreshToken })
        .expect(401);
      expect(await prisma.twoFactorAuth.count({ where: { userId: workspace.ownerId } })).toBe(0);

      // …the new session is not, and the address now counts as confirmed.
      await request(app.getHttpServer())
        .post("/api/auth/refresh")
        .send({ refreshToken: response.body.refreshToken })
        .expect(200);
      const owner = await prisma.user.findUniqueOrThrow({ where: { id: workspace.ownerId } });
      expect(owner.emailVerifiedAt).not.toBeNull();
      expect(owner.hasPassword).toBe(false);

      // And the next Google sign-in goes straight in.
      const again = await ssoSignIn({ token: clerkToken(workspace.ownerEmail) }).expect(200);
      expect(again.body.user.tenantId).toBe(workspace.tenantId);
    });

    it("can be left alone for a workspace of the person's own", async () => {
      const choice = await ssoSignIn({ token: clerkToken(workspace.ownerEmail) }).expect(200);
      const created = await request(app.getHttpServer())
        .post("/api/workspace")
        .send({
          name: "Mine",
          subdomain: "really-mine",
          ownerName: "Real Owner",
          ownerEmail: workspace.ownerEmail,
          ssoToken: choice.body.signup.signupToken,
        })
        .expect(201);
      expect(created.body.session.user.tenantId).toBe(created.body.tenant.id);
    });
  });

  it("says on the sign-up answer that the address's account was turned off", async () => {
    const workspace = await verifiedWorkspace("turned-off");
    await prisma.user.update({ where: { id: workspace.ownerId }, data: { status: "DISABLED" } });

    const response = await ssoSignIn({ token: clerkToken(workspace.ownerEmail) }).expect(200);
    expect(response.body).toMatchObject({
      status: "signup-required",
      known: { reason: "disabled", workspace: "turned-off" },
    });
  });

  it("never skips two-factor: the challenge finishes on POST /auth/login/2fa", async () => {
    const workspace = await verifiedWorkspace("sso-2fa");
    const auth = { Authorization: `Bearer ${workspace.accessToken}` };
    const setup = await request(app.getHttpServer())
      .post("/api/auth/2fa/setup")
      .set(auth)
      .send({ password: TEST_PASSWORD })
      .expect(200);
    const secret = base32Decode(setup.body.secret);
    await request(app.getHttpServer())
      .post("/api/auth/2fa/confirm")
      .set(auth)
      .send({ code: hotp(secret, totpStep()) })
      .expect(200);

    const challenge = await ssoSignIn({ token: clerkToken(workspace.ownerEmail) }).expect(200);
    expect(challenge.body).toMatchObject({
      twoFactorRequired: true,
      challengeToken: expect.any(String),
    });
    expect(challenge.body).not.toHaveProperty("accessToken");

    await request(app.getHttpServer())
      .post("/api/auth/login/2fa")
      .send({ challengeToken: challenge.body.challengeToken, code: "000000" })
      .expect(401);
    // The code after the one used to confirm: replay protection refuses that one.
    const session = await request(app.getHttpServer())
      .post("/api/auth/login/2fa")
      .send({ challengeToken: challenge.body.challengeToken, code: hotp(secret, totpStep() + 1) })
      .expect(200);
    expect(session.body.user.tenantId).toBe(workspace.tenantId);
  });

  describe("an address with accounts in several workspaces", () => {
    const email = "consultant@example.com";
    let tenants: Record<string, string>;

    beforeEach(async () => {
      tenants = {};
      for (const subdomain of ["client-one", "client-two", "client-gone"]) {
        const created = await request(app.getHttpServer())
          .post("/api/workspace")
          .send({
            name: subdomain,
            subdomain,
            ownerName: "Consultant",
            ownerEmail: email,
            ownerPassword: TEST_PASSWORD,
          })
          .expect(201);
        tenants[subdomain] = created.body.tenant.id;
      }
      await prisma.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
      await prisma.tenant.update({
        where: { id: tenants["client-gone"] },
        data: { status: "CANCELLED" },
      });
    });

    it("lists the live ones and signs in to the one picked", async () => {
      const choice = await ssoSignIn({ token: clerkToken(email) }).expect(200);
      expect(choice.body).toMatchObject({
        status: "choose-workspace",
        selectionToken: expect.any(String),
      });
      expect(choice.body.workspaces).toEqual([
        { subdomain: "client-one", name: "client-one" },
        { subdomain: "client-two", name: "client-two" },
      ]);
      expect(choice.body).not.toHaveProperty("accessToken");

      const session = await request(app.getHttpServer())
        .post("/api/auth/sso/select")
        .send({ selectionToken: choice.body.selectionToken, subdomain: "client-two" })
        .expect(200);
      expect(session.body.user.tenantId).toBe(tenants["client-two"]);

      for (const subdomain of ["client-gone", "somebody-else"]) {
        await request(app.getHttpServer())
          .post("/api/auth/sso/select")
          .send({ selectionToken: choice.body.selectionToken, subdomain })
          .expect(401);
      }
    });

    it("goes straight to the workspace the page named", async () => {
      const session = await ssoSignIn({ token: clerkToken(email), subdomain: "client-one" }).expect(
        200,
      );
      expect(session.body.user.tenantId).toBe(tenants["client-one"]);
    });

    it("treats a blank workspace field as not named", async () => {
      const response = await ssoSignIn({ token: clerkToken(email), subdomain: "" }).expect(200);
      expect(response.body.status).toBe("choose-workspace");
    });
  });

  describe("signing up through Google or Microsoft", () => {
    async function signupToken(email: string): Promise<string> {
      const response = await ssoSignIn({ token: clerkToken(email, { name: "Ravi Verma" }) }).expect(
        200,
      );
      expect(response.body).toMatchObject({ status: "signup-required", email, name: "Ravi Verma" });
      return response.body.signupToken;
    }

    const workspaceBody = {
      name: "Verma Traders",
      subdomain: "verma-traders",
      ownerName: "Ravi Verma",
      ownerEmail: "ravi@verma.example",
    };

    it("creates the workspace with no password, a verified owner, and a session", async () => {
      const ssoToken = await signupToken("ravi@verma.example");

      const created = await request(app.getHttpServer())
        .post("/api/workspace")
        .send({ ...workspaceBody, ownerEmail: "Ravi@Verma.example", ssoToken })
        .expect(201);
      expect(created.body.owner).toMatchObject({ email: "ravi@verma.example", role: "OWNER" });
      expect(JSON.stringify(created.body)).not.toContain("passwordHash");

      const me = await request(app.getHttpServer())
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${created.body.session.accessToken}`)
        .expect(200);
      expect(me.body.tenantId).toBe(created.body.tenant.id);

      const owner = await prisma.user.findUniqueOrThrow({ where: { id: created.body.owner.id } });
      expect(owner.emailVerifiedAt).not.toBeNull();

      // And the next Google sign-in finds it.
      const again = await ssoSignIn({ token: clerkToken("ravi@verma.example") }).expect(200);
      expect(again.body.user.tenantId).toBe(created.body.tenant.id);
    });

    it("is spent by the workspace it creates", async () => {
      const ssoToken = await signupToken("ravi@verma.example");
      await request(app.getHttpServer())
        .post("/api/workspace")
        .send({ ...workspaceBody, ssoToken })
        .expect(201);

      const again = await request(app.getHttpServer())
        .post("/api/workspace")
        .send({ ...workspaceBody, subdomain: "verma-traders-two", ssoToken })
        .expect(409);
      expect(again.body.message).toMatch(/already uses this address/);
      expect(
        await prisma.tenant.findUnique({ where: { subdomain: "verma-traders-two" } }),
      ).toBeNull();
    });

    it("leaves an owner with no password, who sets a first one without a current one", async () => {
      const ssoToken = await signupToken("ravi@verma.example");
      const created = await request(app.getHttpServer())
        .post("/api/workspace")
        .send({ ...workspaceBody, ssoToken })
        .expect(201);
      const auth = { Authorization: `Bearer ${created.body.session.accessToken}` };

      const security = await request(app.getHttpServer())
        .get("/api/auth/security")
        .set(auth)
        .expect(200);
      expect(security.body.hasPassword).toBe(false);

      // Everything that asks for the current password says why it cannot, rather than
      // calling a password nobody was given "not correct".
      const setup = await request(app.getHttpServer())
        .post("/api/auth/2fa/setup")
        .set(auth)
        .send({ password: "anything-at-all-123" })
        .expect(400);
      expect(setup.body.message).toMatch(/no password yet/);
      await request(app.getHttpServer())
        .post("/api/auth/change-password")
        .set(auth)
        .send({ currentPassword: "anything-at-all-123", newPassword: TEST_PASSWORD })
        .expect(400);

      await request(app.getHttpServer())
        .post("/api/auth/password/set")
        .set(auth)
        .send({ newPassword: "short" })
        .expect(400);
      await request(app.getHttpServer())
        .post("/api/auth/password/set")
        .set(auth)
        .send({ newPassword: TEST_PASSWORD })
        .expect(204);

      // The session carries on, the password signs in, and 2FA can be turned on with it.
      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ subdomain: "verma-traders", email: "ravi@verma.example", password: TEST_PASSWORD })
        .expect(200);
      await request(app.getHttpServer())
        .post("/api/auth/2fa/setup")
        .set(auth)
        .send({ password: TEST_PASSWORD })
        .expect(200);

      // Once only: from here on it is change-password, which asks for the current one.
      await request(app.getHttpServer())
        .post("/api/auth/password/set")
        .set(auth)
        .send({ newPassword: `${TEST_PASSWORD}-again` })
        .expect(409);
    });

    it("sets a first password only soon after signing in", async () => {
      const ssoToken = await signupToken("ravi@verma.example");
      const created = await request(app.getHttpServer())
        .post("/api/workspace")
        .send({ ...workspaceBody, ssoToken })
        .expect(201);
      await prisma.user.update({
        where: { id: created.body.owner.id },
        data: { lastLoginAt: new Date(Date.now() - 2 * 60 * 60_000) },
      });

      const refused = await request(app.getHttpServer())
        .post("/api/auth/password/set")
        .set("Authorization", `Bearer ${created.body.session.accessToken}`)
        .send({ newPassword: TEST_PASSWORD })
        .expect(401);
      expect(refused.body.message).toMatch(/sign in again/);
    });

    it("refuses the token for another address, beside a password, or forged — and creates nothing", async () => {
      const ssoToken = await signupToken("ravi@verma.example");

      await request(app.getHttpServer())
        .post("/api/workspace")
        .send({ ...workspaceBody, ownerEmail: "someone-else@verma.example", ssoToken })
        .expect(400);
      await request(app.getHttpServer())
        .post("/api/workspace")
        .send({ ...workspaceBody, ssoToken, ownerPassword: TEST_PASSWORD })
        .expect(400);
      await request(app.getHttpServer())
        .post("/api/workspace")
        .send({ ...workspaceBody, ssoToken: `${ssoToken}x` })
        .expect(400);

      expect(await prisma.tenant.findUnique({ where: { subdomain: "verma-traders" } })).toBeNull();
    });

    it("still needs a password when there is no token, and returns no session for one", async () => {
      await request(app.getHttpServer()).post("/api/workspace").send(workspaceBody).expect(400);

      const created = await request(app.getHttpServer())
        .post("/api/workspace")
        .send({ ...workspaceBody, ownerPassword: TEST_PASSWORD })
        .expect(201);
      expect(created.body).not.toHaveProperty("session");
    });
  });
});
