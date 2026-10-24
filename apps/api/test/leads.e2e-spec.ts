import { INestApplication } from "@nestjs/common";
import type { Prisma, Role } from "@prisma/client";
import * as argon2 from "argon2";
import { createHash } from "node:crypto";
import request from "supertest";
import { importAttestationVersion } from "../src/leads/leads.service";
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
 * Lead data rules that live in the API rather than the screen: the import pipeline, the
 * do-not-call list, what erasing a lead removes, and who may export the book.
 *
 * Every case drives the real HTTP routes, and reads the database directly only to check
 * what a response cannot show — a suppression row, a redacted webhook payload, the
 * attestation record.
 */
describe("Leads", () => {
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
    alpha = await createWorkspace(app, "leads-alpha");
  });

  const authed = (workspace: { accessToken: string }) => ({
    Authorization: `Bearer ${workspace.accessToken}`,
  });

  const csv = (rows: string[][]) => rows.map((cells) => cells.join(",")).join("\n");

  const MAPPING = { name: "name", phone: "phone", city: "city" };

  const importFile = (body: Record<string, unknown>, workspace: { accessToken: string } = alpha) =>
    request(app.getHttpServer()).post("/api/leads/import").set(authed(workspace)).send(body);

  /** A commit with everything the API requires of one. */
  const commit = (file: string, extra: Record<string, unknown> = {}) =>
    importFile({
      csv: file,
      mapping: MAPPING,
      dryRun: false,
      attestation: true,
      lawfulBasis: "EXISTING_RELATIONSHIP",
      ...extra,
    });

  /** A second member of the workspace with the given role, signed in. */
  async function member(role: Role): Promise<{ accessToken: string; id: string }> {
    const email = `${role.toLowerCase()}@leads-alpha.test`;
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
    return { accessToken: login.body.accessToken, id: user.id };
  }

  describe("adding a lead", () => {
    it("creates it with a CREATED activity, and refuses a bad or duplicate number", async () => {
      const lead = await createLead(app, alpha, { name: "Apex Dental", phone: "+91 98765 43210" });
      expect(lead.phone).toBe("919876543210");

      const activity = await request(app.getHttpServer())
        .get(`/api/leads/${lead.id}/activity`)
        .set(authed(alpha))
        .expect(200);
      expect(activity.body.map((row: { type: string }) => row.type)).toEqual(["CREATED"]);

      await request(app.getHttpServer())
        .post("/api/leads")
        .set(authed(alpha))
        .send({ name: "Not A Number", phone: "12" })
        .expect(400);

      await request(app.getHttpServer())
        .post("/api/leads")
        .set(authed(alpha))
        .send({ name: "Same Number", phone: "09876543210" })
        .expect(400);
    });

    it("records the lawful basis and the consent date, and refuses a date in the future", async () => {
      const created = await request(app.getHttpServer())
        .post("/api/leads")
        .set(authed(alpha))
        .send({
          name: "Consenting Clinic",
          phone: "9876500011",
          lawfulBasis: "CONSENT",
          consentCapturedAt: "2026-03-14",
        })
        .expect(201);
      expect(created.body.lawfulBasis).toBe("CONSENT");
      expect(created.body.consentCapturedAt).toBe("2026-03-14T00:00:00.000Z");

      await request(app.getHttpServer())
        .post("/api/leads")
        .set(authed(alpha))
        .send({ name: "Tomorrow's Consent", phone: "9876500012", consentCapturedAt: "2999-01-01" })
        .expect(400);

      await request(app.getHttpServer())
        .post("/api/leads")
        .set(authed(alpha))
        .send({ name: "Made-up Basis", phone: "9876500013", lawfulBasis: "WE_FELT_LIKE_IT" })
        .expect(400);
    });
  });

  describe("importing a CSV", () => {
    it("previews duplicates, known numbers, suppressed numbers and bad rows, and writes nothing", async () => {
      await createLead(app, alpha, { name: "Known", phone: "9876500001" });
      await request(app.getHttpServer())
        .patch("/api/call-settings")
        .set(authed(alpha))
        .send({ blockedNumbers: ["9876500009"] })
        .expect(200);

      const file = csv([
        ["name", "phone", "city"],
        ["Fresh", "9876500002", "Patna"],
        ["Fresh Again", "09876500002", "Patna"],
        ["Known Again", "+91 98765 00001", "Gaya"],
        ["Blocked", "9876500009", "Gaya"],
        ["", "9876500003", "Gaya"],
        ["Bad Number", "abc", "Gaya"],
      ]);

      const response = await importFile({ csv: file, mapping: MAPPING, dryRun: true }).expect(200);

      expect(response.body).toMatchObject({
        imported: 0,
        dryRun: true,
        batchId: null,
        doNotCall: 0,
      });
      expect(
        response.body.duplicatesInFile.map((row: { sourceRow: number }) => row.sourceRow),
      ).toEqual([2]);
      expect(
        response.body.duplicatesInDatabase.map((row: { sourceRow: number }) => row.sourceRow),
      ).toEqual([3]);
      expect(response.body.suppressed.map((row: { sourceRow: number }) => row.sourceRow)).toEqual([
        4,
      ]);
      expect(response.body.rejected.map((row: { sourceRow: number }) => row.sourceRow)).toEqual([
        5, 6,
      ]);

      expect(await prisma.lead.count({ where: { tenantId: alpha.tenantId } })).toBe(1);
      expect(await prisma.importBatch.count()).toBe(0);
    });

    it("refuses a commit without the attestation or a lawful basis", async () => {
      const file = csv([
        ["name", "phone"],
        ["Fresh", "9876500002"],
      ]);

      const unattested = await importFile({
        csv: file,
        mapping: MAPPING,
        dryRun: false,
        lawfulBasis: "CONSENT",
      }).expect(400);
      expect(unattested.body.message).toMatch(/lawfully contact/);

      await importFile({
        csv: file,
        mapping: MAPPING,
        attestation: false,
        lawfulBasis: "CONSENT",
      }).expect(400);

      const baseless = await importFile({ csv: file, mapping: MAPPING, attestation: true }).expect(
        400,
      );
      expect(baseless.body.message).toMatch(/basis/);

      await importFile({
        csv: file,
        mapping: MAPPING,
        attestation: true,
        lawfulBasis: "BECAUSE",
      }).expect(400);

      expect(await prisma.lead.count({ where: { tenantId: alpha.tenantId } })).toBe(0);
    });

    it("commits leads, one IMPORTED activity each and an attested batch, then sees them all as known", async () => {
      const file = csv([
        ["name", "phone", "city", "Speciality"],
        ["Apex Dental", "9876500002", "Patna", "Ortho"],
        ["Health Plus", "8765400003", "Gaya", ""],
        ["Care Point", "7654300004", "", "Paeds"],
      ]);

      const response = await commit(file).set("User-Agent", "leads-e2e").expect(200);
      expect(response.body).toMatchObject({ imported: 3, dryRun: false });
      expect(response.body.batchId).toEqual(expect.any(String));

      const batch = await prisma.importBatch.findUniqueOrThrow({
        where: { id: response.body.batchId },
      });
      expect(batch).toMatchObject({
        tenantId: alpha.tenantId,
        userId: alpha.ownerId,
        userEmail: alpha.ownerEmail,
        userAgent: "leads-e2e",
        csvSha256: createHash("sha256").update(file, "utf8").digest("hex"),
        rowCount: 3,
        importedCount: 3,
        source: "UPLOAD",
        lawfulBasis: "EXISTING_RELATIONSHIP",
        attestationVersion: importAttestationVersion(),
      });
      expect(batch.ipAddress).toBeTruthy();

      const leads = await prisma.lead.findMany({
        where: { tenantId: alpha.tenantId },
        include: { activities: true },
      });
      expect(leads).toHaveLength(3);
      for (const lead of leads) {
        expect(lead.importBatchId).toBe(batch.id);
        expect(lead.lawfulBasis).toBe("EXISTING_RELATIONSHIP");
        expect(lead.activities.map((activity) => activity.type)).toEqual(["IMPORTED"]);
        expect(lead.activities[0].actorId).toBe(alpha.ownerId);
      }
      expect(leads.find((lead) => lead.name === "Apex Dental")?.customFields).toEqual({
        Speciality: "Ortho",
      });

      const again = await commit(file).expect(200);
      expect(again.body.imported).toBe(0);
      expect(again.body.duplicatesInDatabase).toHaveLength(3);
    });

    it("records the uploaded file's own hash and upload id beside each request's", async () => {
      // One file sent as two requests, as the web app sends a big one.
      const fileSha256 = createHash("sha256").update("the file as picked").digest("hex");
      const uploadId = "4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
      const first = csv([
        ["name", "phone"],
        ["Part One", "9876500081"],
      ]);
      const second = csv([
        ["name", "phone"],
        ["Part Two", "9876500082"],
      ]);

      for (const part of [first, second]) {
        await commit(part, { fileSha256: fileSha256.toUpperCase(), uploadId }).expect(200);
      }

      const batches = await prisma.importBatch.findMany({
        where: { tenantId: alpha.tenantId, uploadId },
        orderBy: { createdAt: "asc" },
      });
      expect(batches).toHaveLength(2);
      expect(batches.map((batch) => batch.fileSha256)).toEqual([fileSha256, fileSha256]);
      expect(batches.map((batch) => batch.csvSha256)).toEqual([
        createHash("sha256").update(first, "utf8").digest("hex"),
        createHash("sha256").update(second, "utf8").digest("hex"),
      ]);

      // Optional, but not free text when given.
      await commit(first, { fileSha256: "not-a-hash" }).expect(400);
      await commit(first, { uploadId: "a b" }).expect(400);
      const plain = await commit(
        csv([
          ["name", "phone"],
          ["Whole File", "9876500083"],
        ]),
      ).expect(200);
      const batch = await prisma.importBatch.findUniqueOrThrow({
        where: { id: plain.body.batchId },
      });
      expect(batch).toMatchObject({ fileSha256: null, uploadId: null });
    });

    it("refuses more than 10,000 rows with a message that says what to do", async () => {
      // Shortest rows that still count as records, so the body stays under the default
      // parser limit and this tests the row cap rather than the byte cap.
      const rows = Array.from({ length: 10_001 }, () => "a,1");
      const response = await importFile({
        csv: ["name,phone", ...rows].join("\n"),
        mapping: MAPPING,
        dryRun: true,
      }).expect(400);

      expect(response.body.message).toMatch(/more than 10,000 rows/);
    });

    it("takes a do-not-call column: suppresses the numbers and marks the leads, new and existing", async () => {
      const existing = await createLead(app, alpha, { name: "Already Here", phone: "9876500005" });

      const file = csv([
        ["name", "phone", "DND"],
        ["Opted Out", "9876500006", "yes"],
        ["Callable", "9876500007", "no"],
        ["Already Here", "9876500005", "Y"],
      ]);

      const response = await commit(file).expect(200);
      expect(response.body).toMatchObject({ imported: 2, doNotCall: 2 });
      expect(response.body.duplicatesInDatabase).toHaveLength(1);

      const leads = await prisma.lead.findMany({
        where: { tenantId: alpha.tenantId },
        select: { name: true, doNotCall: true, customFields: true },
        orderBy: { name: "asc" },
      });
      expect(leads.map((lead) => [lead.name, lead.doNotCall])).toEqual([
        ["Already Here", true],
        ["Callable", false],
        ["Opted Out", true],
      ]);
      expect(leads.every((lead) => lead.customFields === null)).toBe(true);

      const suppressions = await prisma.suppression.findMany({
        where: { tenantId: alpha.tenantId },
        orderBy: { phone: "asc" },
      });
      expect(suppressions.map((row) => [row.phone, row.source])).toEqual([
        ["919876500005", "IMPORT"],
        ["919876500006", "IMPORT"],
      ]);

      const timeline = await request(app.getHttpServer())
        .get(`/api/leads/${existing.id}/activity`)
        .set(authed(alpha))
        .expect(200);
      expect(timeline.body[0].summary).toBe("Marked do not call by an imported file");
    });
  });

  describe("the do-not-call list", () => {
    it("records the mark, keeps it after the lead is deleted, and skips the number on re-import", async () => {
      const lead = await createLead(app, alpha, { name: "Asha Verma", phone: "9876500021" });

      const marked = await request(app.getHttpServer())
        .patch(`/api/leads/${lead.id}`)
        .set(authed(alpha))
        .send({ doNotCall: true })
        .expect(200);
      expect(marked.body.doNotCall).toBe(true);

      const timeline = await request(app.getHttpServer())
        .get(`/api/leads/${lead.id}/activity`)
        .set(authed(alpha))
        .expect(200);
      expect(timeline.body[0]).toMatchObject({
        type: "UPDATED",
        summary: "Marked do not call",
        metadata: { field: "doNotCall", from: false, to: true },
      });

      const row = await prisma.suppression.findFirstOrThrow({
        where: { tenantId: alpha.tenantId, phone: "919876500021" },
      });
      expect(row).toMatchObject({ source: "MANUAL", createdById: alpha.ownerId });

      await request(app.getHttpServer())
        .delete(`/api/leads/${lead.id}`)
        .set(authed(alpha))
        .expect(204);
      expect(await prisma.suppression.count({ where: { tenantId: alpha.tenantId } })).toBe(1);

      const reimport = await commit(
        csv([
          ["name", "phone"],
          ["Asha Verma", "+91 98765 00021"],
        ]),
      ).expect(200);
      expect(reimport.body.imported).toBe(0);
      expect(reimport.body.suppressed).toEqual([
        {
          sourceRow: 1,
          reason: "number is on this workspace's do-not-call list",
          value: "919876500021",
        },
      ]);
    });

    it("keeps an erased do-not-call lead's opt-out even when it never had a suppression row", async () => {
      // A lead marked before the suppression list existed, and missed by the migration.
      const lead = await createLead(app, alpha, { name: "Legacy Opt Out", phone: "9876500022" });
      await prisma.lead.update({ where: { id: lead.id }, data: { doNotCall: true } });

      await request(app.getHttpServer())
        .delete(`/api/leads/${lead.id}`)
        .set(authed(alpha))
        .expect(204);

      const row = await prisma.suppression.findFirstOrThrow({
        where: { tenantId: alpha.tenantId, phone: "919876500022" },
      });
      expect(row.source).toBe("LEAD_DELETE");

      // The number comes back do-not-call. The kept mark was the workspace's own, not a
      // reason the person gave, so switching the lead back takes it off as it would have
      // the lead's own mark.
      const back = await request(app.getHttpServer())
        .post("/api/leads")
        .set(authed(alpha))
        .send({ name: "Legacy Opt Out", phone: "9876500022" })
        .expect(201);
      expect(back.body.doNotCall).toBe(true);

      await request(app.getHttpServer())
        .patch(`/api/leads/${back.body.id}`)
        .set(authed(alpha))
        .send({ doNotCall: false })
        .expect(200);
      expect(
        await prisma.suppression.count({
          where: { tenantId: alpha.tenantId, phone: "919876500022" },
        }),
      ).toBe(0);
    });

    it("writes no LEAD_DELETE row when the erased lead's number already has one", async () => {
      const lead = await createLead(app, alpha, { name: "Marked Then Erased", phone: "9876500025" });
      await request(app.getHttpServer())
        .patch(`/api/leads/${lead.id}`)
        .set(authed(alpha))
        .send({ doNotCall: true })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/leads/${lead.id}`)
        .set(authed(alpha))
        .expect(204);

      const rows = await prisma.suppression.findMany({
        where: { tenantId: alpha.tenantId, phone: "919876500025" },
      });
      expect(rows.map((row) => row.source)).toEqual(["MANUAL"]);
    });

    it("answers an empty edit and a repeated mark with the lead, and gives an unbacked mark its row", async () => {
      const lead = await createLead(app, alpha, { name: "Steady", phone: "9876500026" });
      const patch = (body: Record<string, unknown>) =>
        request(app.getHttpServer()).patch(`/api/leads/${lead.id}`).set(authed(alpha)).send(body);

      const empty = await patch({}).expect(200);
      expect(empty.body).toMatchObject({ id: lead.id, doNotCall: false });

      await patch({ doNotCall: true }).expect(200);
      const again = await patch({ doNotCall: true }).expect(200);
      expect(again.body.doNotCall).toBe(true);
      expect(
        await prisma.suppression.count({
          where: { tenantId: alpha.tenantId, phone: "919876500026" },
        }),
      ).toBe(1);

      // A lead marked before the list existed: the flag, and no row behind it.
      const legacy = await createLead(app, alpha, { name: "Legacy", phone: "9876500027" });
      await prisma.lead.update({ where: { id: legacy.id }, data: { doNotCall: true } });
      const remarked = await request(app.getHttpServer())
        .patch(`/api/leads/${legacy.id}`)
        .set(authed(alpha))
        .send({ doNotCall: true })
        .expect(200);
      expect(remarked.body.doNotCall).toBe(true);
      const row = await prisma.suppression.findFirstOrThrow({
        where: { tenantId: alpha.tenantId, phone: "919876500027" },
      });
      expect(row.source).toBe("MANUAL");

      // And the timeline does not claim a change that did not happen.
      const timeline = await request(app.getHttpServer())
        .get(`/api/leads/${legacy.id}/activity`)
        .set(authed(alpha))
        .expect(200);
      expect(timeline.body.map((entry: { type: string }) => entry.type)).toEqual(["CREATED"]);
    });

    it("lets the workspace undo its own mark, but not an opt-out it was given", async () => {
      const mine = await createLead(app, alpha, { name: "Marked By Us", phone: "9876500023" });
      await request(app.getHttpServer())
        .patch(`/api/leads/${mine.id}`)
        .set(authed(alpha))
        .send({ doNotCall: true })
        .expect(200);

      const cleared = await request(app.getHttpServer())
        .patch(`/api/leads/${mine.id}`)
        .set(authed(alpha))
        .send({ doNotCall: false })
        .expect(200);
      expect(cleared.body.doNotCall).toBe(false);
      expect(
        await prisma.suppression.count({
          where: { tenantId: alpha.tenantId, phone: "919876500023" },
        }),
      ).toBe(0);

      await commit(
        csv([
          ["name", "phone", "Do Not Call"],
          ["Their Choice", "9876500024", "yes"],
        ]),
      ).expect(200);
      const theirs = await prisma.lead.findFirstOrThrow({
        where: { tenantId: alpha.tenantId, phone: "919876500024" },
      });

      const refused = await request(app.getHttpServer())
        .patch(`/api/leads/${theirs.id}`)
        .set(authed(alpha))
        .send({ doNotCall: false })
        .expect(409);
      expect(refused.body.message).toMatch(/do-not-call list/);

      const after = await prisma.lead.findUniqueOrThrow({ where: { id: theirs.id } });
      expect(after.doNotCall).toBe(true);
    });

    it("keeps a suppressed number do-not-call when it comes back as a new lead or a new number", async () => {
      await request(app.getHttpServer())
        .patch("/api/call-settings")
        .set(authed(alpha))
        .send({ blockedNumbers: ["9876500031", "9876500032"] })
        .expect(200);

      const readded = await request(app.getHttpServer())
        .post("/api/leads")
        .set(authed(alpha))
        .send({ name: "Back Again", phone: "9876500031", doNotCall: false })
        .expect(201);
      expect(readded.body.doNotCall).toBe(true);

      const lead = await createLead(app, alpha, { name: "Moving", phone: "9876500033" });
      await request(app.getHttpServer())
        .patch(`/api/leads/${lead.id}`)
        .set(authed(alpha))
        .send({ phone: "9876500032", doNotCall: false })
        .expect(409);

      const moved = await request(app.getHttpServer())
        .patch(`/api/leads/${lead.id}`)
        .set(authed(alpha))
        .send({ phone: "9876500032" })
        .expect(200);
      expect(moved.body).toMatchObject({ phone: "919876500032", doNotCall: true });
    });

    it("answers Settings' blocked numbers from the list, normalised, and blocks those numbers at the gate", async () => {
      const saved = await request(app.getHttpServer())
        .patch("/api/call-settings")
        .set(authed(alpha))
        .send({ blockedNumbers: ["+91 98765 00041", "09876500041", "022 2345 6789"] })
        .expect(200);
      expect(saved.body.blockedNumbers).toEqual(["2223456789", "919876500041"]);

      const typo = await request(app.getHttpServer())
        .patch("/api/call-settings")
        .set(authed(alpha))
        .send({ blockedNumbers: ["9876500041", "12345", "not a phone"] })
        .expect(400);
      expect(typo.body.message).toBe("Not a phone number: 12345, not a phone.");

      const blocked = await createLead(app, alpha, { name: "Blocked", phone: "9876500041" });
      const free = await createLead(app, alpha, { name: "Free", phone: "9876500042" });

      const gateFor = async (leadId: string) =>
        (
          await request(app.getHttpServer())
            .get(`/api/calls/gates/${leadId}`)
            .set(authed(alpha))
            .expect(200)
        ).body.reasons as string[];

      expect(await gateFor(blocked.id)).toContain("NUMBER_BLOCKED");
      expect(await gateFor(free.id)).not.toContain("NUMBER_BLOCKED");

      // Replacing the list removes what is no longer on it, and leaves alone an opt-out
      // this screen did not create.
      await commit(
        csv([
          ["name", "phone", "dnd"],
          ["Imported Opt Out", "9876500043", "1"],
        ]),
      ).expect(200);
      const replaced = await request(app.getHttpServer())
        .patch("/api/call-settings")
        .set(authed(alpha))
        .send({ blockedNumbers: ["2223456789"] })
        .expect(200);
      expect(replaced.body.blockedNumbers).toEqual(["2223456789"]);

      const remaining = await prisma.suppression.findMany({
        where: { tenantId: alpha.tenantId },
        orderBy: { phone: "asc" },
      });
      expect(remaining.map((row) => [row.phone, row.source])).toEqual([
        ["2223456789", "SETTINGS"],
        ["919876500043", "IMPORT"],
      ]);
      expect(await gateFor(blocked.id)).not.toContain("NUMBER_BLOCKED");

      // The old list matched by digit suffix, so a number that is not an Indian mobile
      // still does, typed with or without its country code on either side.
      await request(app.getHttpServer())
        .patch("/api/call-settings")
        .set(authed(alpha))
        .send({ blockedNumbers: ["2223456789", "+1 415 555 0100", "020 7946 0018"] })
        .expect(200);
      const domestic = await createLead(app, alpha, { name: "US Office", phone: "415-555-0100" });
      const withCode = await createLead(app, alpha, { name: "UK Office", phone: "+44 20 7946 0018" });
      expect(domestic.phone).toBe("4155550100");
      expect(withCode.phone).toBe("442079460018");
      expect(await gateFor(domestic.id)).toContain("NUMBER_BLOCKED");
      expect(await gateFor(withCode.id)).toContain("NUMBER_BLOCKED");

      // An Indian mobile has one spelling, so it is matched by that alone.
      await request(app.getHttpServer())
        .patch("/api/call-settings")
        .set(authed(alpha))
        .send({ blockedNumbers: ["65430044"] })
        .expect(200);
      const mobile = await createLead(app, alpha, { name: "Mobile", phone: "9865430044" });
      expect(await gateFor(mobile.id)).not.toContain("NUMBER_BLOCKED");
    });

    it("does not let an agent lift a manager's Settings block from the lead", async () => {
      const manager = await member("MANAGER");
      const agent = await member("AGENT");

      await request(app.getHttpServer())
        .patch("/api/call-settings")
        .set(authed(manager))
        .send({ blockedNumbers: ["9876500101"] })
        .expect(200);
      await request(app.getHttpServer())
        .patch("/api/call-settings")
        .set(authed(agent))
        .send({ blockedNumbers: [] })
        .expect(403);

      const added = await request(app.getHttpServer())
        .post("/api/leads")
        .set(authed(agent))
        .send({ name: "Blocked By Manager", phone: "9876500101" })
        .expect(201);
      expect(added.body.doNotCall).toBe(true);

      const refused = await request(app.getHttpServer())
        .patch(`/api/leads/${added.body.id}`)
        .set(authed(agent))
        .send({ doNotCall: false })
        .expect(409);
      expect(refused.body.message).toMatch(/blocked list in Settings/);

      const settings = await request(app.getHttpServer())
        .get("/api/call-settings")
        .set(authed(manager))
        .expect(200);
      expect(settings.body.blockedNumbers).toEqual(["919876500101"]);
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: added.body.id } });
      expect(lead.doNotCall).toBe(true);

      const gate = await request(app.getHttpServer())
        .get(`/api/calls/gates/${added.body.id}`)
        .set(authed(agent))
        .expect(200);
      expect(gate.body.reasons).toEqual(expect.arrayContaining(["NUMBER_BLOCKED", "DO_NOT_CALL"]));
    });

    it("keeps a lead's mark out of the Settings list, and a Settings save never removes it", async () => {
      const lead = await createLead(app, alpha, { name: "Asked Us Not To", phone: "9876500201" });
      await request(app.getHttpServer())
        .patch(`/api/leads/${lead.id}`)
        .set(authed(alpha))
        .send({ doNotCall: true })
        .expect(200);

      const listed = await request(app.getHttpServer())
        .get("/api/call-settings")
        .set(authed(alpha))
        .expect(200);
      expect(listed.body.blockedNumbers).toEqual([]);

      // What a Settings form loaded before the mark would send.
      await request(app.getHttpServer())
        .patch("/api/call-settings")
        .set(authed(alpha))
        .send({ maxAttemptsPerLead: 4, blockedNumbers: [] })
        .expect(200);
      const rows = () =>
        prisma.suppression.findMany({
          where: { tenantId: alpha.tenantId, phone: "919876500201" },
          orderBy: { source: "asc" },
        });
      expect((await rows()).map((row) => row.source)).toEqual(["MANUAL"]);

      // Blocking the same number in Settings adds a reason beside the lead's; unblocking
      // it there takes away only its own.
      const blocked = await request(app.getHttpServer())
        .patch("/api/call-settings")
        .set(authed(alpha))
        .send({ blockedNumbers: ["9876500201"] })
        .expect(200);
      expect(blocked.body.blockedNumbers).toEqual(["919876500201"]);
      expect((await rows()).map((row) => row.source).sort()).toEqual(["MANUAL", "SETTINGS"]);

      await request(app.getHttpServer())
        .patch("/api/call-settings")
        .set(authed(alpha))
        .send({ blockedNumbers: [] })
        .expect(200);
      expect((await rows()).map((row) => row.source)).toEqual(["MANUAL"]);
      const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(after.doNotCall).toBe(true);

      // The old column is kept in step with the list, for a rollback to read.
      const settingsRow = await prisma.callSettings.findFirstOrThrow({
        where: { tenantId: alpha.tenantId },
      });
      expect(settingsRow.blockedNumbers).toEqual([]);
    });

    it("mirrors the Settings list into the old column, normalised, for a rollback to read", async () => {
      await request(app.getHttpServer())
        .patch("/api/call-settings")
        .set(authed(alpha))
        .send({ blockedNumbers: ["+91 98765 00301", "022 2345 6789"] })
        .expect(200);
      const settingsRow = await prisma.callSettings.findFirstOrThrow({
        where: { tenantId: alpha.tenantId },
      });
      expect([...settingsRow.blockedNumbers].sort()).toEqual(["2223456789", "919876500301"]);
    });
  });

  describe("erasing a lead", () => {
    it("removes its notifications and calendar entries and redacts webhook deliveries that carried it", async () => {
      const lead = await createLead(app, alpha, { name: "Asha Verma", phone: "9876500051" });
      const bystander = await createLead(app, alpha, { name: "Bystander", phone: "9876500052" });
      const tenantId = alpha.tenantId;

      const call = await prisma.call.create({
        data: { tenantId, leadId: lead.id, phone: "919876500051", status: "COMPLETED" },
      });
      const followUp = await prisma.followUp.create({
        data: { tenantId, leadId: lead.id, dueAt: new Date(Date.now() + 86_400_000) },
      });

      await prisma.notification.deleteMany({ where: { tenantId } });
      await prisma.notification.createMany({
        data: [
          {
            tenantId,
            type: "NEW_LEAD",
            title: "New lead: Asha Verma",
            body: "-",
            linkPath: `/leads/${lead.id}`,
            resourceType: "lead",
            resourceId: lead.id,
          },
          {
            tenantId,
            type: "CALL_COMPLETED",
            title: "Call finished with Asha Verma",
            body: "-",
            resourceType: "call",
            resourceId: call.id,
          },
          {
            tenantId,
            type: "FOLLOWUP_DUE",
            title: "Call Asha Verma back",
            body: "-",
            linkPath: "/follow-ups",
            resourceType: "followUp",
            resourceId: followUp.id,
          },
          {
            tenantId,
            type: "NEW_LEAD",
            title: "New lead: Bystander",
            body: "-",
            linkPath: `/leads/${bystander.id}`,
            resourceType: "lead",
            resourceId: bystander.id,
          },
        ],
      });

      const start = new Date(Date.now() + 2 * 86_400_000);
      const end = new Date(start.getTime() + 1_800_000);
      await prisma.calendarEvent.createMany({
        data: [
          { tenantId, title: "Demo with Asha Verma", startAt: start, endAt: end, leadId: lead.id },
          {
            tenantId,
            title: "Call Asha back",
            startAt: start,
            endAt: end,
            followUpId: followUp.id,
          },
          {
            tenantId,
            title: "Demo with Bystander",
            startAt: start,
            endAt: end,
            leadId: bystander.id,
          },
        ],
      });

      const hook = await prisma.webhook.create({
        data: {
          tenantId,
          url: "https://hooks.example.com/in",
          secretEncrypted: "x",
          events: ["lead.created"],
        },
      });
      const envelope = (event: string, data: Prisma.InputJsonObject) => ({
        id: `evt_${event}`,
        event,
        createdAt: "2026-10-14T00:00:00.000Z",
        workspaceId: tenantId,
        data,
      });
      const delivered = await prisma.webhookDelivery.create({
        data: {
          tenantId,
          webhookId: hook.id,
          event: "lead.created",
          payload: envelope("lead.created", {
            lead: { id: lead.id, name: "Asha Verma", phone: "919876500051" },
          }),
          status: "SUCCEEDED",
          responseBody: "received Asha Verma",
        },
      });
      const pending = await prisma.webhookDelivery.create({
        data: {
          tenantId,
          webhookId: hook.id,
          event: "call.completed",
          payload: envelope("call.completed", { call: { id: call.id, leadId: lead.id } }),
          status: "FAILED",
          nextAttemptAt: new Date(Date.now() + 60_000),
        },
      });
      const unrelated = await prisma.webhookDelivery.create({
        data: {
          tenantId,
          webhookId: hook.id,
          event: "lead.created",
          payload: envelope("lead.created", { lead: { id: bystander.id, name: "Bystander" } }),
          status: "SUCCEEDED",
          responseBody: "received Bystander",
        },
      });

      await request(app.getHttpServer())
        .delete(`/api/leads/${lead.id}`)
        .set(authed(alpha))
        .expect(204);

      expect(await prisma.lead.findUnique({ where: { id: lead.id } })).toBeNull();
      expect(await prisma.call.findUnique({ where: { id: call.id } })).toBeNull();

      const notifications = await prisma.notification.findMany({ where: { tenantId } });
      expect(notifications.map((row) => row.title)).toEqual(["New lead: Bystander"]);

      const events = await prisma.calendarEvent.findMany({ where: { tenantId } });
      expect(events.map((row) => row.title)).toEqual(["Demo with Bystander"]);

      const afterDelivered = await prisma.webhookDelivery.findUniqueOrThrow({
        where: { id: delivered.id },
      });
      expect(afterDelivered.payload).toEqual({
        id: "evt_lead.created",
        event: "lead.created",
        createdAt: "2026-10-14T00:00:00.000Z",
        workspaceId: tenantId,
        data: { redacted: true, reason: "The lead this event described was erased." },
      });
      expect(afterDelivered.responseBody).toBeNull();
      expect(afterDelivered.status).toBe("SUCCEEDED");

      const afterPending = await prisma.webhookDelivery.findUniqueOrThrow({
        where: { id: pending.id },
      });
      expect(JSON.stringify(afterPending.payload)).not.toContain(lead.id);
      expect(afterPending).toMatchObject({ status: "EXHAUSTED", nextAttemptAt: null });

      const afterUnrelated = await prisma.webhookDelivery.findUniqueOrThrow({
        where: { id: unrelated.id },
      });
      expect(afterUnrelated.payload).toEqual(unrelated.payload);
      expect(afterUnrelated.responseBody).toBe("received Bystander");
    });

    it("404s on a lead that is not there, and on another workspace's", async () => {
      const beta = await createWorkspace(app, "leads-beta");
      const theirs = await createLead(app, beta, { name: "Beta Lead", phone: "9876500061" });

      await request(app.getHttpServer())
        .delete(`/api/leads/${theirs.id}`)
        .set(authed(alpha))
        .expect(404);
      expect(await prisma.lead.findUnique({ where: { id: theirs.id } })).not.toBeNull();
    });
  });

  describe("exporting", () => {
    it("is limited to roles holding leads.export", async () => {
      const viewer = await member("VIEWER");
      const agent = await member("AGENT");
      const manager = await member("MANAGER");

      await request(app.getHttpServer()).get("/api/leads/export").set(authed(viewer)).expect(403);
      await request(app.getHttpServer()).get("/api/leads/export").set(authed(agent)).expect(403);
      await request(app.getHttpServer()).get("/api/leads/export").set(authed(manager)).expect(200);
    });

    it("returns the filtered rows as a CSV download, with formulas defused", async () => {
      await createLead(app, alpha, {
        name: '=HYPERLINK("http://evil.example")',
        phone: "9876500071",
      });
      const interested = await createLead(app, alpha, { name: "Keen, Ltd", phone: "9876500072" });
      await request(app.getHttpServer())
        .patch(`/api/leads/${interested.id}`)
        .set(authed(alpha))
        .send({ status: "INTERESTED", doNotCall: true })
        .expect(200);

      const all = await request(app.getHttpServer())
        .get("/api/leads/export")
        .set(authed(alpha))
        .expect(200);
      expect(all.headers["content-type"]).toMatch(/^text\/csv/);
      expect(all.headers["content-disposition"]).toMatch(
        /^attachment; filename="leads-\d{4}-\d{2}-\d{2}\.csv"$/,
      );

      const lines = all.text
        .replace(/^\uFEFF/, "")
        .trimEnd()
        .split("\r\n");
      expect(all.text.startsWith("\uFEFF")).toBe(true);
      expect(lines[0].split(",").slice(0, 5)).toEqual([
        "id",
        "name",
        "contact_person",
        "job_title",
        "phone",
      ]);
      expect(lines).toHaveLength(3);
      expect(all.text).toContain(`"'=HYPERLINK(""http://evil.example"")"`);

      const filtered = await request(app.getHttpServer())
        .get("/api/leads/export?status=INTERESTED")
        .set(authed(alpha))
        .expect(200);
      const filteredLines = filtered.text.trimEnd().split("\r\n");
      expect(filteredLines).toHaveLength(2);
      expect(filteredLines[1]).toContain('"Keen, Ltd"');
      expect(filteredLines[1]).toContain(",yes,");

      // An export is the whole selection; a page number would be silently ignored.
      await request(app.getHttpServer())
        .get("/api/leads/export?page=2")
        .set(authed(alpha))
        .expect(400);
    });

    it("streams every row, past the size of one batch", async () => {
      const rows = Array.from({ length: 1_500 }, (_, index) => [
        `Lead ${index}`,
        `9${String(700000000 + index).padStart(9, "0")}`,
      ]);
      const imported = await commit(csv([["name", "phone"], ...rows])).expect(200);
      expect(imported.body.imported).toBe(1_500);

      const response = await request(app.getHttpServer())
        .get("/api/leads/export")
        .set(authed(alpha))
        .expect(200);
      const lines = response.text.trimEnd().split("\r\n");
      expect(lines).toHaveLength(1_501);
      const ids = new Set(lines.slice(1).map((line) => line.split(",")[0]));
      expect(ids.size).toBe(1_500);
    }, 120_000);
  });
});
