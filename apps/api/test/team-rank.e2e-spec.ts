import { INestApplication } from "@nestjs/common";
import * as argon2 from "argon2";
import request from "supertest";
import type { Role } from "@appsgain/shared";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  createTestApp,
  createWorkspace,
  resetDatabase,
  TEST_PASSWORD,
  type TestWorkspace,
} from "./helpers";

/**
 * Managing teammates, end to end: who may change whom, and what a change does to the
 * target's sessions. The unit tests cover every field; these prove the rules hold through
 * the real guards, the scoped client's transaction and the refresh endpoint.
 */
describe("Team rank rules", () => {
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
    alpha = await createWorkspace(app, "rank-alpha");
  });

  interface Member {
    id: string;
    accessToken: string;
    refreshToken: string;
  }

  /** A second member of the workspace with the given role, signed in. */
  async function member(role: Role): Promise<Member> {
    const email = `${role.toLowerCase()}@rank-alpha.test`;
    const user = await prisma.user.create({
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
    return {
      id: user.id,
      accessToken: login.body.accessToken,
      refreshToken: login.body.refreshToken,
    };
  }

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  const refresh = (refreshToken: string) =>
    request(app.getHttpServer()).post("/api/auth/refresh").send({ refreshToken });

  it("refuses an ADMIN who tries to disable, deactivate, demote or edit the OWNER", async () => {
    const admin = await member("ADMIN");
    const before = await prisma.user.findUniqueOrThrow({ where: { id: alpha.ownerId } });

    for (const body of [
      { status: "DISABLED" },
      { role: "AGENT" },
      { name: "Someone Else" },
      { phone: "+919876500099" },
    ]) {
      await request(app.getHttpServer())
        .patch(`/api/users/${alpha.ownerId}`)
        .set(as(admin.accessToken))
        .send(body)
        .expect(403);
    }

    await request(app.getHttpServer())
      .delete(`/api/users/${alpha.ownerId}`)
      .set(as(admin.accessToken))
      .expect(403);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: alpha.ownerId } });
    expect(after).toMatchObject({
      role: "OWNER",
      status: "ACTIVE",
      name: before.name,
      phone: before.phone,
    });

    // And the owner is still signed in: nothing about the refused attempts touched them.
    await refresh(alpha.refreshToken).expect(200);
  });

  it("lets an ADMIN deactivate a MANAGER, which ends the manager's sessions", async () => {
    const admin = await member("ADMIN");
    const manager = await member("MANAGER");

    await request(app.getHttpServer())
      .delete(`/api/users/${manager.id}`)
      .set(as(admin.accessToken))
      .expect(200);

    await refresh(manager.refreshToken).expect(401);

    const sessions = await prisma.refreshToken.findMany({ where: { userId: manager.id } });
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);

    // The admin's own sessions are untouched.
    await refresh(admin.refreshToken).expect(200);
  });

  it("ends a member's sessions on a demotion, but not on a promotion", async () => {
    const manager = await member("MANAGER");
    const agent = await member("AGENT");

    await request(app.getHttpServer())
      .patch(`/api/users/${manager.id}`)
      .set(as(alpha.accessToken))
      .send({ role: "AGENT" })
      .expect(200);
    await refresh(manager.refreshToken).expect(401);

    await request(app.getHttpServer())
      .patch(`/api/users/${agent.id}`)
      .set(as(alpha.accessToken))
      .send({ role: "MANAGER" })
      .expect(200);
    const refreshed = await refresh(agent.refreshToken).expect(200);

    // Refresh re-reads the role, so the promotion arrives without signing in again.
    const me = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set(as(refreshed.body.accessToken))
      .expect(200);
    expect(me.body.role).toBe("MANAGER");
  });
});
