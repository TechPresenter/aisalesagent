import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHmac } from "node:crypto";
import type { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import type { RecordingObjectStore } from "./recordings-retention";
import { RecordingsService } from "./recordings.service";

/**
 * The signed recording link is a bearer credential for call audio, so these tests are
 * about what makes one valid: the right secret, the right recording, an unexpired time —
 * and that the link points at the API rather than at whatever origin happens to open it.
 */

const RECORDING_ID = "6f0c1f8e-2b7a-4c1e-9d55-0d1b8f3a9c21";
const SECRET = "recording-link-secret-for-tests-0123456789";

const ENV_KEYS = ["JWT_ACCESS_SECRET", "API_PUBLIC_URL", "API_PORT"] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.JWT_ACCESS_SECRET = SECRET;
  process.env.API_PUBLIC_URL = "https://api.example.test/";
  delete process.env.API_PORT;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function service(options: { found?: boolean; store?: RecordingObjectStore | null } = {}) {
  const recording = {
    findFirst: jest.fn().mockResolvedValue(
      options.found === false ? null : { id: RECORDING_ID, sizeBytes: BigInt(2048) },
    ),
    delete: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const factory = { client: { recording } } as unknown as TenantPrismaFactory;
  return { recordings: new RecordingsService(factory, options.store ?? null), recording };
}

/** What a forger would compute: the link's HMAC under a key of their choosing. */
function signWith(secret: string, id: string, expires: number): string {
  return createHmac("sha256", secret).update(`${id}.${expires}`).digest("base64url");
}

function linkParts(url: string) {
  const parsed = new URL(url);
  return {
    parsed,
    expires: Number(parsed.searchParams.get("expires")),
    signature: parsed.searchParams.get("signature") ?? "",
  };
}

describe("RecordingsService.signedUrl", () => {
  it("builds an absolute link on the API's public origin", async () => {
    const { recordings } = service();
    const { url, expiresAt } = await recordings.signedUrl(RECORDING_ID);

    const { parsed, expires } = linkParts(url);
    expect(parsed.origin).toBe("https://api.example.test");
    expect(parsed.pathname).toBe(`/api/recordings/${RECORDING_ID}/audio`);
    expect(new Date(expiresAt).getTime()).toBe(expires * 1000);
    // Minutes, not hours: the link is a bearer token for the audio.
    expect(expires * 1000 - Date.now()).toBeLessThanOrEqual(300_000);
  });

  it("falls back to the local API port when API_PUBLIC_URL is not set", async () => {
    delete process.env.API_PUBLIC_URL;
    process.env.API_PORT = "4100";
    const { recordings } = service();

    const { url } = await recordings.signedUrl(RECORDING_ID);
    expect(url.startsWith(`http://localhost:4100/api/recordings/${RECORDING_ID}/audio?`)).toBe(true);
  });

  it("signs a link that verifies", async () => {
    const { recordings } = service();
    const { expires, signature } = linkParts((await recordings.signedUrl(RECORDING_ID)).url);

    expect(recordings.verifySignature(RECORDING_ID, expires, signature)).toBe(true);
  });

  it("looks the recording up through the tenant client, ignoring expired ones", async () => {
    const { recordings, recording } = service();
    await recordings.signedUrl(RECORDING_ID);

    const where = recording.findFirst.mock.calls[0][0].where;
    expect(where.id).toBe(RECORDING_ID);
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }]);
  });

  it("404s on a recording the workspace cannot see", async () => {
    const { recordings } = service({ found: false });
    await expect(recordings.signedUrl(RECORDING_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["missing", undefined],
  ])("refuses to sign when the secret is %s", async (_label, secret) => {
    if (secret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = secret;
    const { recordings } = service();

    await expect(recordings.signedUrl(RECORDING_ID)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe("RecordingsService.verifySignature", () => {
  async function validLink() {
    const { recordings } = service();
    const { expires, signature } = linkParts((await recordings.signedUrl(RECORDING_ID)).url);
    return { recordings, expires, signature };
  }

  it("rejects a tampered signature", async () => {
    const { recordings, expires, signature } = await validLink();
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
    expect(recordings.verifySignature(RECORDING_ID, expires, flipped)).toBe(false);
    expect(recordings.verifySignature(RECORDING_ID, expires, "")).toBe(false);
  });

  it("rejects a link moved to another recording or given a longer life", async () => {
    const { recordings, expires, signature } = await validLink();
    expect(
      recordings.verifySignature("0d5a1b6e-0000-4000-8000-000000000000", expires, signature),
    ).toBe(false);
    expect(recordings.verifySignature(RECORDING_ID, expires + 3600, signature)).toBe(false);
  });

  it("rejects an expired or unreadable expiry", () => {
    const { recordings } = service();
    // Correctly signed, but its time has passed.
    const past = Math.floor(Date.now() / 1000) - 1;
    const signedPast = signWith(SECRET, RECORDING_ID, past);

    expect(recordings.verifySignature(RECORDING_ID, past, signedPast)).toBe(false);
    expect(recordings.verifySignature(RECORDING_ID, Number.NaN, signedPast)).toBe(false);
  });

  it("accepts nothing when the secret is empty, not even a signature made with an empty key", () => {
    const expires = Math.floor(Date.now() / 1000) + 60;
    const emptyKeySignature = signWith("", RECORDING_ID, expires);

    process.env.JWT_ACCESS_SECRET = "";
    const { recordings } = service();
    expect(recordings.verifySignature(RECORDING_ID, expires, emptyKeySignature)).toBe(false);
  });
});

describe("RecordingsService.remove", () => {
  it("deletes the row while no object store is bound", async () => {
    const { recordings, recording } = service();
    await recordings.remove(RECORDING_ID);

    expect(recording.delete).toHaveBeenCalledWith({ where: { id: RECORDING_ID } });
    expect(recording.updateMany).not.toHaveBeenCalled();
  });

  it("marks the row for the retention sweep once a store is bound", async () => {
    const store: RecordingObjectStore = { deleteObject: jest.fn() };
    const { recordings, recording } = service({ store });
    await recordings.remove(RECORDING_ID);

    expect(recording.delete).not.toHaveBeenCalled();
    expect(recording.updateMany).toHaveBeenCalledWith({
      where: { id: RECORDING_ID },
      data: { expiresAt: expect.any(Date) },
    });
    // The sweep deletes the audio; the request never touches storage itself.
    expect(store.deleteObject).not.toHaveBeenCalled();
  });

  it("404s on a recording the workspace cannot see", async () => {
    const { recordings, recording } = service({ found: false });
    await expect(recordings.remove(RECORDING_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(recording.delete).not.toHaveBeenCalled();
  });
});
