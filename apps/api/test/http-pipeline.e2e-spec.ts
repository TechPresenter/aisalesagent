import { INestApplication, Logger } from "@nestjs/common";
import request from "supertest";
import * as errorReporting from "../src/common/error-reporting";
import { LeadsService } from "../src/leads/leads.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, createWorkspace, resetDatabase, type TestWorkspace } from "./helpers";

/**
 * What every request passes through before and after its route: security headers, CORS,
 * body limits, readiness and the error filter. createTestApp applies the same
 * configureHttpPipeline main.ts does, so these answers are the deployed API's.
 */
describe("HTTP pipeline", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let workspace: TestWorkspace;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    // Signing up and logging in are JSON bodies on ordinary routes: if the import route's
    // parser had displaced Nest's own, both would arrive empty and fail here.
    workspace = await createWorkspace(app, "pipeline");
  });

  afterEach(() => jest.restoreAllMocks());

  const authed = () => ({ Authorization: `Bearer ${workspace.accessToken}` });

  /** A dry-run import body of `rows` leads, each row about 95 bytes once in JSON. */
  function importBody(rows: number): Record<string, unknown> {
    const lines = ["name,phone,city,notes"];
    for (let index = 0; index < rows; index += 1) {
      const phone = `9${String(700_000_000 + index).padStart(9, "0")}`;
      lines.push(`Clinic ${index} Multispeciality Hospital,${phone},Patna,referred by the Patna free health camp`);
    }
    return {
      csv: lines.join("\n"),
      mapping: { name: "name", phone: "phone", city: "city" },
      dryRun: true,
    };
  }

  describe("security headers", () => {
    it("answers with an API content policy, anti-framing and nosniff, and does not name Express", async () => {
      const response = await request(app.getHttpServer()).get("/api/health").expect(200);

      expect(response.headers["content-security-policy"]).toBe("default-src 'none';frame-ancestors 'none'");
      expect(response.headers["x-frame-options"]).toBe("DENY");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(response.headers["strict-transport-security"]).toMatch(/max-age=\d+/);
      expect(response.headers["cross-origin-resource-policy"]).toBe("same-origin");
      expect(response.headers).not.toHaveProperty("x-powered-by");
    });

    it("lets another site load a signed recording link, and only that", async () => {
      const response = await request(app.getHttpServer()).get(
        "/api/recordings/00000000-0000-4000-8000-000000000000/audio?expires=1&signature=x",
      );

      expect(response.status).toBe(403);
      expect(response.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    });
  });

  describe("CORS", () => {
    it("lets the browser cache a preflight for two hours", async () => {
      const origin = (process.env.API_CORS_ORIGINS ?? "http://localhost:3000").split(",")[0].trim();
      const response = await request(app.getHttpServer())
        .options("/api/leads")
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "authorization,content-type");

      expect(response.status).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
      expect(response.headers["access-control-max-age"]).toBe("7200");
    });
  });

  describe("body limits", () => {
    it("accepts a 5,000-row import, far over the 100 KB every other route keeps", async () => {
      const body = importBody(5_000);
      expect(JSON.stringify(body).length).toBeGreaterThan(400_000);

      const response = await request(app.getHttpServer())
        .post("/api/leads/import")
        .set(authed())
        .send(body);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ dryRun: true });
    });

    it("still answers 413 above 100 KB anywhere else, with a readable message", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/leads")
        .set(authed())
        .send({ name: "x".repeat(150_000), phone: "9876500001" });

      expect(response.status).toBe(413);
      expect(response.body).toEqual({
        statusCode: 413,
        message: "The request is too large for the server to accept. Send less data in one request.",
        error: "Payload Too Large",
      });

      // And an ordinary body on the same route is still parsed.
      await request(app.getHttpServer())
        .post("/api/leads")
        .set(authed())
        .send({ name: "Pipeline Clinic", phone: "9876500002", city: "Patna" })
        .expect(201);
    });

    it("leaves an import with no credential to the 100 KB parser, so nobody anonymous gets a 4 MB parse", async () => {
      // Under 100 KB: parsed as any route's body would be, then refused by the guard.
      await request(app.getHttpServer()).post("/api/leads/import").send(importBody(10)).expect(401);

      // Over 100 KB, which the import parser would have taken: refused before any route.
      const response = await request(app.getHttpServer()).post("/api/leads/import").send(importBody(5_000));
      expect(response.status).toBe(413);
      expect(response.body.message).toBe(
        "The request is too large for the server to accept. Send less data in one request.",
      );
    });

    it("parses the large body for an API key too, which the guard then checks", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/leads/import")
        .set("X-API-Key", "agk_not-a-real-key")
        .send(importBody(5_000));

      expect(response.status).toBe(401);
    });

    it("answers an import over 4 MB with 413 and what to do about it", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/leads/import")
        .set(authed())
        .send({ ...importBody(10), csv: "name,phone\n" + "a,1\n".repeat(1_100_000) });

      expect(response.status).toBe(413);
      expect(response.body.message).toMatch(/too large to import in one go\. Split it into smaller files/);
    });
  });

  describe("readiness", () => {
    it("answers 503 when the database does not, and logs it without reporting it", async () => {
      jest.spyOn(app.get(PrismaService), "$queryRaw").mockRejectedValue(new Error("Can't reach database server"));
      const logged = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      const reported = jest.spyOn(errorReporting, "reportException");

      const response = await request(app.getHttpServer()).get("/api/health/ready");

      expect(response.status).toBe(503);
      expect(response.body).toEqual({ status: "degraded", database: "down" });
      expect(logged.mock.calls.map((call) => String(call[0]))).toEqual(
        expect.arrayContaining([expect.stringContaining('"route":"/api/health/ready"')]),
      );
      expect(reported).not.toHaveBeenCalled();
    });

    it("answers 200 when it does", async () => {
      await request(app.getHttpServer())
        .get("/api/health/ready")
        .expect(200, { status: "ok", database: "up" });
    });
  });

  describe("unexpected errors", () => {
    it("answers a generic 500 and logs one line naming the route, workspace and user, without the token", async () => {
      jest.spyOn(LeadsService.prototype, "list").mockRejectedValue(new TypeError("Cannot read properties of undefined"));
      const logged = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      const reported = jest.spyOn(errorReporting, "reportException");

      const response = await request(app.getHttpServer())
        .get("/api/leads?search=Priya")
        .set(authed())
        .set("x-vercel-id", "bom1::e2e-1");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ statusCode: 500, message: "Internal server error" });

      const lines = logged.mock.calls.map((call) => String(call[0]));
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({
        status: 500,
        method: "GET",
        route: "/api/leads",
        tenantId: workspace.tenantId,
        userId: workspace.ownerId,
        requestId: "bom1::e2e-1",
        error: "TypeError",
      });
      expect(lines[0]).not.toContain(workspace.accessToken);
      expect(lines[0]).not.toContain("Priya");
      expect(reported).toHaveBeenCalledTimes(1);
      expect(reported).toHaveBeenCalledWith(
        expect.any(TypeError),
        expect.objectContaining({ route: "/api/leads", tenantId: workspace.tenantId }),
      );
    });
  });
});
