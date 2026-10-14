import { INestApplication } from "@nestjs/common";
import * as argon2 from "argon2";
import request from "supertest";
import type { Role } from "@appsgain/shared";
import { MailService } from "../src/mail/mail.service";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  createTestApp,
  createWorkspace,
  resetDatabase,
  TEST_PASSWORD,
  type TestWorkspace,
} from "./helpers";

/**
 * Team invitations end to end, the way Settings → Team drives them: invite, pass the link
 * on, accept, and the new member is on the list with the role they were invited to.
 *
 * The link in the response is the whole point when email is not configured — LIVE has no
 * mail provider yet, so the person inviting copies it from the dialog — so these tests
 * take the token from that link exactly as the person would, rather than from the
 * database.
 */
describe("Team invitations", () => {
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
    alpha = await createWorkspace(app, "invite-alpha");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** A second member of the workspace with the given role, signed in. */
  async function member(
    role: Role,
    workspace: TestWorkspace = alpha,
  ): Promise<{ id: string; accessToken: string }> {
    const email = `${role.toLowerCase()}@${workspace.subdomain}.test`;
    const user = await prisma.user.create({
      data: {
        tenantId: workspace.tenantId,
        email,
        name: `A ${role.toLowerCase()}`,
        role,
        passwordHash: await argon2.hash(TEST_PASSWORD, { type: argon2.argon2id }),
      },
    });
    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ subdomain: workspace.subdomain, email, password: TEST_PASSWORD })
      .expect(200);
    return { id: user.id, accessToken: login.body.accessToken };
  }

  function invite(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post("/api/users/invitations").set(as(token)).send(body);
  }

  /** The token in an acceptance link, read the way the accept-invite page reads it. */
  function tokenOf(link: string): string {
    const token = new URL(link).searchParams.get("token");
    if (!token) throw new Error(`No token in ${link}`);
    return token;
  }

  const preview = (token: string) =>
    request(app.getHttpServer()).post("/api/auth/invitations/preview").send({ token });

  const accept = (token: string, name = "Neha Verma") =>
    request(app.getHttpServer())
      .post("/api/auth/invitations/accept")
      .send({ token, name, password: TEST_PASSWORD });

  it("invites, accepts, and lists the new member with the invited role", async () => {
    const sent = await invite(alpha.accessToken, {
      email: "Neha.Verma@Example.com",
      name: "Neha",
      role: "MANAGER",
    }).expect(201);

    expect(sent.body).toMatchObject({
      invitation: {
        email: "neha.verma@example.com",
        name: "Neha",
        role: "MANAGER",
        status: "PENDING",
        invitedBy: { id: alpha.ownerId },
      },
      link: expect.stringContaining("/accept-invite?token="),
      // The test environment writes mail to the log, which counts as sent.
      emailSent: true,
    });
    expect(sent.body).not.toHaveProperty("emailError");

    const pending = await request(app.getHttpServer())
      .get("/api/users/invitations")
      .set(as(alpha.accessToken))
      .expect(200);
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0]).toMatchObject({ id: sent.body.invitation.id, status: "PENDING" });
    // The list never carries a usable link: only the response to invite or resend does.
    expect(JSON.stringify(pending.body)).not.toContain("inv_");

    const token = tokenOf(sent.body.link);
    const shown = await preview(token).expect(200);
    expect(shown.body).toMatchObject({
      email: "neha.verma@example.com",
      role: "MANAGER",
      workspace: { subdomain: alpha.subdomain },
    });

    const signedIn = await accept(token).expect(200);
    expect(signedIn.body.user).toMatchObject({
      tenantId: alpha.tenantId,
      role: "MANAGER",
      email: "neha.verma@example.com",
    });
    expect(signedIn.body.accessToken).toEqual(expect.any(String));

    const members = await request(app.getHttpServer())
      .get("/api/users")
      .set(as(alpha.accessToken))
      .expect(200);
    expect(members.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: "neha.verma@example.com",
          name: "Neha Verma",
          role: "MANAGER",
          status: "ACTIVE",
        }),
      ]),
    );

    // Accepted: off the pending list, and the link is spent.
    const after = await request(app.getHttpServer())
      .get("/api/users/invitations")
      .set(as(alpha.accessToken))
      .expect(200);
    expect(after.body).toHaveLength(0);
    await accept(token, "Someone Else").expect(404);

    // And the new member can sign in with the password they chose.
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({
        subdomain: alpha.subdomain,
        email: "neha.verma@example.com",
        password: TEST_PASSWORD,
      })
      .expect(200);
  });

  it("still returns the link, with the reason, when the email could not be sent", async () => {
    jest
      .spyOn(app.get(MailService), "send")
      .mockResolvedValue({ ok: false, reason: "Email is not configured on this server." });

    const sent = await invite(alpha.accessToken, {
      email: "nomail@example.com",
      role: "AGENT",
    }).expect(201);
    expect(sent.body).toMatchObject({
      emailSent: false,
      emailError: "Email is not configured on this server.",
      link: expect.stringContaining("/accept-invite?token="),
    });

    // The undelivered invitation is a real one: the copied link works.
    await accept(tokenOf(sent.body.link)).expect(200);
  });

  describe("the role ceiling", () => {
    it("lets an ADMIN invite at or below their own role, never above it", async () => {
      const admin = await member("ADMIN");

      await invite(admin.accessToken, { email: "peer@example.com", role: "ADMIN" }).expect(201);
      await invite(admin.accessToken, { email: "agent@example.com", role: "AGENT" }).expect(201);

      const refused = await invite(admin.accessToken, {
        email: "boss@example.com",
        role: "OWNER",
      }).expect(403);
      expect(refused.body.message).toMatch(/above your own/);

      const listed = await request(app.getHttpServer())
        .get("/api/users/invitations")
        .set(as(admin.accessToken))
        .expect(200);
      expect(listed.body.map((row: { email: string }) => row.email).sort()).toEqual([
        "agent@example.com",
        "peer@example.com",
      ]);
    });

    it("never invites anyone as SUPER_ADMIN, not even the owner", async () => {
      await invite(alpha.accessToken, {
        email: "platform@example.com",
        role: "SUPER_ADMIN",
      }).expect(400);
      expect(await prisma.invitation.count()).toBe(0);
    });

    it("refuses a role without team.manage, while still showing it the pending list", async () => {
      await invite(alpha.accessToken, { email: "pending@example.com", role: "AGENT" }).expect(201);

      for (const role of ["MANAGER", "AGENT", "VIEWER"] as const) {
        const someone = await member(role);
        await invite(someone.accessToken, {
          email: `from-${role.toLowerCase()}@example.com`,
          role: "VIEWER",
        }).expect(403);
        await request(app.getHttpServer())
          .get("/api/users/invitations")
          .set(as(someone.accessToken))
          .expect(200);
      }
      expect(await prisma.invitation.count()).toBe(1);
    });

    it("lets an ADMIN revoke but not resend an invitation to a role above theirs", async () => {
      const ownerInvite = await invite(alpha.accessToken, {
        email: "co-owner@example.com",
        role: "OWNER",
      }).expect(201);
      const admin = await member("ADMIN");
      const id = ownerInvite.body.invitation.id;

      await request(app.getHttpServer())
        .post(`/api/users/invitations/${id}/resend`)
        .set(as(admin.accessToken))
        .expect(403);
      // The owner's link was not replaced by the refused attempt.
      await preview(tokenOf(ownerInvite.body.link)).expect(200);

      // Withdrawing an invitation hands nobody anything, so it is not rank-limited.
      await request(app.getHttpServer())
        .delete(`/api/users/invitations/${id}`)
        .set(as(admin.accessToken))
        .expect(204);
      await preview(tokenOf(ownerInvite.body.link)).expect(404);
    });
  });

  describe("addresses that are already in the workspace", () => {
    it("answers 409 for an existing member, whatever the case of the address", async () => {
      const response = await invite(alpha.accessToken, {
        email: alpha.ownerEmail.toUpperCase(),
        role: "AGENT",
      }).expect(409);
      expect(response.body.message).toMatch(/already a member/);
    });

    it("answers 409 for a deactivated member, pointing at reactivation instead", async () => {
      const agent = await member("AGENT");
      await request(app.getHttpServer())
        .delete(`/api/users/${agent.id}`)
        .set(as(alpha.accessToken))
        .expect(200);

      const response = await invite(alpha.accessToken, {
        email: "agent@invite-alpha.test",
        role: "AGENT",
      }).expect(409);
      expect(response.body.message).toMatch(/deactivated/);
      expect(await prisma.invitation.count()).toBe(0);
    });
  });

  describe("links", () => {
    it("resend issues a fresh link and the old one stops working", async () => {
      const first = await invite(alpha.accessToken, {
        email: "resend@example.com",
        role: "AGENT",
      }).expect(201);
      const oldToken = tokenOf(first.body.link);

      const resent = await request(app.getHttpServer())
        .post(`/api/users/invitations/${first.body.invitation.id}/resend`)
        .set(as(alpha.accessToken))
        .expect(201);
      expect(resent.body.invitation.id).toBe(first.body.invitation.id);
      const newToken = tokenOf(resent.body.link);
      expect(newToken).not.toBe(oldToken);

      await preview(oldToken).expect(404);
      await accept(oldToken).expect(404);
      await accept(newToken).expect(200);
    });

    it("inviting the same address again replaces the earlier link", async () => {
      const first = await invite(alpha.accessToken, {
        email: "twice@example.com",
        role: "VIEWER",
      }).expect(201);
      const second = await invite(alpha.accessToken, {
        email: "twice@example.com",
        role: "AGENT",
      }).expect(201);

      expect(second.body.invitation.id).toBe(first.body.invitation.id);
      await preview(tokenOf(first.body.link)).expect(404);
      const signedIn = await accept(tokenOf(second.body.link)).expect(200);
      expect(signedIn.body.user.role).toBe("AGENT");
    });

    it("revoke makes the link fail and takes it off the list", async () => {
      const sent = await invite(alpha.accessToken, {
        email: "revoked@example.com",
        role: "AGENT",
      }).expect(201);
      const id = sent.body.invitation.id;

      await request(app.getHttpServer())
        .delete(`/api/users/invitations/${id}`)
        .set(as(alpha.accessToken))
        .expect(204);

      await preview(tokenOf(sent.body.link)).expect(404);
      await accept(tokenOf(sent.body.link)).expect(404);
      const listed = await request(app.getHttpServer())
        .get("/api/users/invitations")
        .set(as(alpha.accessToken))
        .expect(200);
      expect(listed.body).toHaveLength(0);

      // A revoked invitation is closed: it cannot be revived by resending it.
      await request(app.getHttpServer())
        .post(`/api/users/invitations/${id}/resend`)
        .set(as(alpha.accessToken))
        .expect(404);
    });

    it("lists an expired invitation as EXPIRED, refuses its link, and resend revives it", async () => {
      const sent = await invite(alpha.accessToken, {
        email: "late@example.com",
        role: "AGENT",
      }).expect(201);
      const id = sent.body.invitation.id;
      await prisma.invitation.update({
        where: { id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });

      const listed = await request(app.getHttpServer())
        .get("/api/users/invitations")
        .set(as(alpha.accessToken))
        .expect(200);
      expect(listed.body).toEqual([expect.objectContaining({ id, status: "EXPIRED" })]);
      await accept(tokenOf(sent.body.link)).expect(404);

      const resent = await request(app.getHttpServer())
        .post(`/api/users/invitations/${id}/resend`)
        .set(as(alpha.accessToken))
        .expect(201);
      expect(resent.body.invitation.status).toBe("PENDING");
      expect(new Date(resent.body.invitation.expiresAt).getTime()).toBeGreaterThan(Date.now());
      await accept(tokenOf(resent.body.link)).expect(200);
    });
  });

  it("keeps each workspace's invitations to itself", async () => {
    const beta = await createWorkspace(app, "invite-beta");
    const sent = await invite(alpha.accessToken, {
      email: "private@example.com",
      role: "AGENT",
    }).expect(201);
    const id = sent.body.invitation.id;

    const listed = await request(app.getHttpServer())
      .get("/api/users/invitations")
      .set(as(beta.accessToken))
      .expect(200);
    expect(listed.body).toHaveLength(0);

    await request(app.getHttpServer())
      .post(`/api/users/invitations/${id}/resend`)
      .set(as(beta.accessToken))
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/users/invitations/${id}`)
      .set(as(beta.accessToken))
      .expect(404);

    // Untouched by either attempt: alpha's link still works.
    await preview(tokenOf(sent.body.link)).expect(200);
  });
});
