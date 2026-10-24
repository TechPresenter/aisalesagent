import { ServiceUnavailableException } from "@nestjs/common";
import { isLogOnly } from "../common/all-exceptions.filter";
import type { PrismaService } from "../prisma/prisma.service";
import { HealthController, READINESS_TIMEOUT_MS } from "./health.controller";

function controllerWith(query: () => Promise<unknown>): HealthController {
  const prisma = { $queryRaw: jest.fn(() => query()) } as unknown as PrismaService;
  return new HealthController(prisma);
}

describe("HealthController", () => {
  afterEach(() => jest.useRealTimers());

  it("answers liveness without touching the database", () => {
    const query = jest.fn();
    expect(controllerWith(query).live()).toMatchObject({ status: "ok" });
    expect(query).not.toHaveBeenCalled();
  });

  it("is ready when the database answers", async () => {
    await expect(controllerWith(() => Promise.resolve([{ "?column?": 1 }])).ready()).resolves.toEqual({
      status: "ok",
      database: "up",
    });
  });

  it("answers 503, with the same body shape, when the database refuses", async () => {
    const answer = controllerWith(() => Promise.reject(new Error("Can't reach database server"))).ready();

    await expect(answer).rejects.toBeInstanceOf(ServiceUnavailableException);
    await answer.catch((error: ServiceUnavailableException) => {
      expect(error.getStatus()).toBe(503);
      expect(error.getResponse()).toEqual({ status: "degraded", database: "down" });
      // Logged, not sent to Sentry: an outage is the uptime monitor's to report.
      expect(isLogOnly(error)).toBe(true);
    });
  });

  it("gives up on a database that does not answer within the timeout", async () => {
    jest.useFakeTimers();
    const answer = controllerWith(() => new Promise(() => undefined)).ready();
    const settled = jest.fn();
    answer.then(settled, settled);

    await jest.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    await expect(answer).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(READINESS_TIMEOUT_MS).toBe(3_000);
  });
});
