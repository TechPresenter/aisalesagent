import {
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { CronController, bearerMatches } from "./cron.controller";
import type { IntegrationsWorker, WorkerPass } from "./integrations.worker";

/**
 * The cron route is public to the user-token guards, so the shared secret is its only
 * lock. These tests are about that lock: no secret configured means off, not open, and
 * only the exact bearer value runs the worker.
 */

const SECRET = "cron-secret-for-tests-0123456789abcdef";

function controller(secret: string | undefined, pass: WorkerPass = { ran: true, retried: 2, announced: 1 }) {
  const tick = jest.fn().mockResolvedValue(pass);
  const worker = { tick } as unknown as IntegrationsWorker;
  const config = { get: () => secret } as unknown as ConfigService;
  return { cron: new CronController(worker, config), tick };
}

describe("bearerMatches", () => {
  it("accepts exactly `Bearer <secret>`", () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["the bare secret", SECRET],
    ["a different secret", "Bearer not-the-secret"],
    ["a prefix of the secret", `Bearer ${SECRET.slice(0, 10)}`],
    ["the secret with extra characters", `Bearer ${SECRET}x`],
  ])("rejects %s", (_label, header) => {
    expect(bearerMatches(header, SECRET)).toBe(false);
  });

  it("never matches when no secret is configured", () => {
    expect(bearerMatches("Bearer ", "")).toBe(false);
  });
});

describe("CronController", () => {
  it("is switched off, not open, when CRON_SECRET is missing", async () => {
    const { cron, tick } = controller(undefined);
    await expect(cron.integrations(`Bearer ${SECRET}`)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(tick).not.toHaveBeenCalled();
  });

  it("refuses a caller without the secret", async () => {
    const { cron, tick } = controller(SECRET);
    await expect(cron.integrations("Bearer guess")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tick).not.toHaveBeenCalled();
  });

  it("runs one worker pass for the scheduler and reports it", async () => {
    const { cron, tick } = controller(SECRET);
    await expect(cron.integrations(`Bearer ${SECRET}`)).resolves.toEqual({ ran: true, retried: 2, announced: 1 });
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("answers 500 when the pass failed, so the cron log shows it", async () => {
    const { cron } = controller(SECRET, { ran: true, retried: 0, announced: 0, error: "database unreachable" });
    await expect(cron.integrations(`Bearer ${SECRET}`)).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
