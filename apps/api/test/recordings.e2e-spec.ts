import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  RecordingsRetention,
  type RecordingObjectStore,
} from "../src/recordings/recordings-retention";
import {
  createLead,
  createTestApp,
  createWorkspace,
  resetDatabase,
  type TestWorkspace,
} from "./helpers";

/**
 * Feature List §8 — Recordings, against Postgres.
 *
 * Two things are under test. The signed audio link: who can mint one, where it points,
 * and that the route it points at answers honestly (403 for a bad link, a real 501 for a
 * good one while no audio is stored). And the retention sweep, which is the only code in
 * the product that deletes call data on its own, so it is tested for what it keeps as
 * much as for what it deletes.
 */

const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);
const API_ORIGIN = "https://api.recordings-e2e.test";

describe("Recordings", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let alpha: TestWorkspace;
  let beta: TestWorkspace;
  let alphaLeadId: string;
  let betaLeadId: string;
  let savedApiUrl: string | undefined;

  beforeAll(async () => {
    savedApiUrl = process.env.API_PUBLIC_URL;
    process.env.API_PUBLIC_URL = `${API_ORIGIN}/`;
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    if (savedApiUrl === undefined) delete process.env.API_PUBLIC_URL;
    else process.env.API_PUBLIC_URL = savedApiUrl;
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    alpha = await createWorkspace(app, "alpha-recordings");
    beta = await createWorkspace(app, "beta-recordings");
    alphaLeadId = (await createLead(app, alpha, { name: "Alpha Dental" })).id;
    betaLeadId = (await createLead(app, beta, { name: "Beta Path Lab" })).id;
  });

  const authed = (workspace: TestWorkspace) => ({
    Authorization: `Bearer ${workspace.accessToken}`,
  });

  /**
   * A finished call with a recording, written behind the API's back the way the post-call
   * pipeline would, with the dates a retention test needs.
   */
  async function seedCall(
    workspace: TestWorkspace,
    leadId: string,
    options: {
      recordingCreatedAt?: Date;
      expiresAt?: Date | null;
      transcriptCreatedAt?: Date;
      segments?: number;
      recording?: boolean;
    } = {},
  ): Promise<{ callId: string; recordingId: string | null; transcriptId: string | null }> {
    const call = await prisma.call.create({
      data: {
        tenantId: workspace.tenantId,
        leadId,
        phone: "+919876500001",
        status: "COMPLETED",
        startedAt: new Date(),
        durationSeconds: 42,
      },
    });

    let recordingId: string | null = null;
    if (options.recording ?? true) {
      const recording = await prisma.recording.create({
        data: {
          tenantId: workspace.tenantId,
          callId: call.id,
          storageKey: `https://telephony.example/recordings/${call.id}.mp3`,
          storageBucket: "provider",
          sizeBytes: BigInt(4096),
          durationSeconds: 42,
          expiresAt: options.expiresAt ?? null,
          ...(options.recordingCreatedAt ? { createdAt: options.recordingCreatedAt } : {}),
        },
      });
      recordingId = recording.id;
    }

    let transcriptId: string | null = null;
    if (options.transcriptCreatedAt) {
      const transcript = await prisma.transcript.create({
        data: {
          tenantId: workspace.tenantId,
          callId: call.id,
          createdAt: options.transcriptCreatedAt,
          segments: {
            create: Array.from({ length: options.segments ?? 2 }, (_, sequence) => ({
              tenantId: workspace.tenantId,
              sequence,
              speaker: sequence % 2 === 0 ? "AI_AGENT" : "LEAD",
              speakerLabel: sequence % 2 === 0 ? "Agent" : "Lead",
              text: `Utterance ${sequence}`,
              startMs: sequence * 1000,
              endMs: sequence * 1000 + 900,
            })),
          },
        },
      });
      transcriptId = transcript.id;
    }

    return { callId: call.id, recordingId, transcriptId };
  }

  async function setRetention(
    workspace: TestWorkspace,
    days: { recording?: number | null; transcript?: number | null },
  ): Promise<void> {
    const data = {
      recordingRetentionDays: days.recording ?? null,
      transcriptRetentionDays: days.transcript ?? null,
    };
    // Unscoped client in test setup, where tenantId is a plain unique key.
    await prisma.tenantSettings.upsert({
      where: { tenantId: workspace.tenantId },
      update: data,
      create: { tenantId: workspace.tenantId, ...data },
    });
  }

  describe("signed audio links", () => {
    it("mints an absolute link on the API origin, which answers HTTP 501 until audio is stored", async () => {
      const { recordingId } = await seedCall(alpha, alphaLeadId);

      const minted = await request(app.getHttpServer())
        .get(`/api/recordings/${recordingId}/url`)
        .set(authed(alpha))
        .expect(200);

      const link = new URL(minted.body.url);
      expect(link.origin).toBe(API_ORIGIN);
      expect(link.pathname).toBe(`/api/recordings/${recordingId}/audio`);

      // No Authorization header: the signature is the credential.
      const audio = await request(app.getHttpServer())
        .get(`${link.pathname}${link.search}`)
        .expect(501);
      expect(audio.body.statusCode).toBe(501);
      expect(audio.body.message).toMatch(/not stored/i);
    });

    it("refuses a tampered, expired or unsigned link with 403", async () => {
      const { recordingId } = await seedCall(alpha, alphaLeadId);
      const minted = await request(app.getHttpServer())
        .get(`/api/recordings/${recordingId}/url`)
        .set(authed(alpha))
        .expect(200);
      const link = new URL(minted.body.url);
      const expires = link.searchParams.get("expires")!;
      const signature = link.searchParams.get("signature")!;
      const audioPath = `/api/recordings/${recordingId}/audio`;

      const tampered = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
      await request(app.getHttpServer())
        .get(audioPath)
        .query({ expires, signature: tampered })
        .expect(403);

      // Extending the expiry invalidates the signature that covered the old one.
      await request(app.getHttpServer())
        .get(audioPath)
        .query({ expires: Number(expires) + 3600, signature })
        .expect(403);

      await request(app.getHttpServer())
        .get(audioPath)
        .query({ expires: Math.floor(Date.now() / 1000) - 60, signature })
        .expect(403);

      await request(app.getHttpServer()).get(audioPath).expect(403);
    });

    it("will not sign, show or delete another workspace's recording", async () => {
      const { recordingId } = await seedCall(alpha, alphaLeadId);

      await request(app.getHttpServer())
        .get(`/api/recordings/${recordingId}/url`)
        .set(authed(beta))
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/recordings/${recordingId}`)
        .set(authed(beta))
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/api/recordings/${recordingId}`)
        .set(authed(beta))
        .expect(404);

      expect(await prisma.recording.count({ where: { id: recordingId! } })).toBe(1);
    });
  });

  describe("deleting and expiry", () => {
    it("deletes a recording at its owner's request", async () => {
      const { recordingId, callId } = await seedCall(alpha, alphaLeadId);

      await request(app.getHttpServer())
        .delete(`/api/recordings/${recordingId}`)
        .set(authed(alpha))
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/recordings/${recordingId}`)
        .set(authed(alpha))
        .expect(404);
      expect(await prisma.recording.count({ where: { id: recordingId! } })).toBe(0);
      // The call it belonged to stays; only the recording goes.
      expect(await prisma.call.count({ where: { id: callId } })).toBe(1);
    });

    it("hides a recording whose expiry has passed, even before the sweep deletes it", async () => {
      const { recordingId: expired } = await seedCall(alpha, alphaLeadId, {
        expiresAt: daysAgo(1),
      });
      const { recordingId: live } = await seedCall(alpha, alphaLeadId, {
        expiresAt: new Date(Date.now() + 3 * DAY),
      });

      const list = await request(app.getHttpServer())
        .get("/api/recordings")
        .set(authed(alpha))
        .expect(200);
      expect(list.body.data.map((row: { id: string }) => row.id)).toEqual([live]);
      expect(list.body.total).toBe(1);

      const stats = await request(app.getHttpServer())
        .get("/api/recordings/stats")
        .set(authed(alpha))
        .expect(200);
      expect(stats.body.total).toBe(1);
      expect(stats.body.expiringSoon).toBe(1);

      await request(app.getHttpServer())
        .get(`/api/recordings/${expired}/url`)
        .set(authed(alpha))
        .expect(404);
    });
  });

  describe("retention sweep", () => {
    it("deletes what retention no longer allows, in every workspace, and keeps everything else", async () => {
      // Alpha: no settings chosen, so 180 days for both.
      const alphaExpired = await seedCall(alpha, alphaLeadId, { expiresAt: daysAgo(1) });
      const alphaOld = await seedCall(alpha, alphaLeadId, {
        recordingCreatedAt: daysAgo(181),
        transcriptCreatedAt: daysAgo(181),
        segments: 3,
      });
      const alphaYoung = await seedCall(alpha, alphaLeadId, {
        recordingCreatedAt: daysAgo(170),
        expiresAt: new Date(Date.now() + DAY),
        transcriptCreatedAt: daysAgo(170),
      });

      // Beta keeps recordings 30 days and transcripts 10.
      await setRetention(beta, { recording: 30, transcript: 10 });
      const betaOld = await seedCall(beta, betaLeadId, {
        recordingCreatedAt: daysAgo(31),
        transcriptCreatedAt: daysAgo(11),
      });
      const betaYoung = await seedCall(beta, betaLeadId, {
        recordingCreatedAt: daysAgo(29),
        transcriptCreatedAt: daysAgo(9),
      });

      const result = await app.get(RecordingsRetention).sweep({ batchSize: 1 });

      expect(result).toEqual({
        recordingsDeleted: 3,
        recordingsKept: 0,
        transcriptsDeleted: 2,
        segmentsDeleted: 5,
        complete: true,
      });

      const recordings = await prisma.recording.findMany({ select: { id: true } });
      expect(recordings.map((r) => r.id).sort()).toEqual(
        [alphaYoung.recordingId, betaYoung.recordingId].sort(),
      );
      const transcripts = await prisma.transcript.findMany({ select: { id: true } });
      expect(transcripts.map((t) => t.id).sort()).toEqual(
        [alphaYoung.transcriptId, betaYoung.transcriptId].sort(),
      );
      expect(
        await prisma.transcriptSegment.count({
          where: { transcriptId: { in: [alphaOld.transcriptId!, betaOld.transcriptId!] } },
        }),
      ).toBe(0);
      expect(await prisma.transcriptSegment.count()).toBe(4);

      // Calls survive their recordings and transcripts.
      expect(
        await prisma.call.count({
          where: { id: { in: [alphaExpired.callId, alphaOld.callId, betaOld.callId] } },
        }),
      ).toBe(3);

      // A second run finds nothing left to do.
      expect(await app.get(RecordingsRetention).sweep()).toMatchObject({
        recordingsDeleted: 0,
        transcriptsDeleted: 0,
        complete: true,
      });
    });

    it("deletes stored audio before the row, and keeps the row when that fails", async () => {
      const gone = await seedCall(alpha, alphaLeadId, { recordingCreatedAt: daysAgo(200) });
      const stuck = await seedCall(alpha, alphaLeadId, { recordingCreatedAt: daysAgo(201) });
      const stuckKey = `https://telephony.example/recordings/${stuck.callId}.mp3`;

      const seenRowsAtDelete: number[] = [];
      const store: RecordingObjectStore = {
        deleteObject: jest.fn(async ({ key }: { bucket: string; key: string }) => {
          seenRowsAtDelete.push(await prisma.recording.count());
          if (key === stuckKey) throw new Error("bucket unavailable");
        }),
      };

      const result = await new RecordingsRetention(prisma, store).sweep({ batchSize: 1 });

      expect(result).toMatchObject({ recordingsDeleted: 1, recordingsKept: 1, complete: true });
      // Both rows still existed when the store was asked to delete the first object.
      expect(seenRowsAtDelete[0]).toBe(2);
      const left = await prisma.recording.findMany({ select: { id: true } });
      expect(left.map((r) => r.id)).toEqual([stuck.recordingId]);
      expect(gone.recordingId).not.toBe(stuck.recordingId);
    });
  });
});
