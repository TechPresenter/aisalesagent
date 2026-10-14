import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../auth/decorators";
import { logOnly } from "../common/all-exceptions.filter";
import { PrismaService } from "../prisma/prisma.service";

/**
 * How long readiness waits for the database. A load balancer or uptime monitor reads a
 * probe that has not answered as "unknown", not "down", so a probe that hangs for as long
 * as the driver's own connect timeout hides exactly the outage it exists to report.
 */
export const READINESS_TIMEOUT_MS = 3_000;

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness — the process is up. No dependencies touched, so it stays fast. */
  @Public()
  @Get()
  live(): { status: string; uptime: number } {
    return { status: "ok", uptime: Math.round(process.uptime()) };
  }

  /**
   * Readiness — the process can actually serve, which means the database answers.
   *
   * A database that is down is a 503, not a 200 with "down" in the body: monitors and
   * load balancers judge a probe by its status code, and a 200 told them all was well
   * while every real request failed. The body keeps its shape either way, so a check
   * matching on `"database":"up"` works too.
   *
   * Logged but not sent to Sentry: an outage is the uptime monitor's to report, and the
   * requests failing meanwhile are reported with their own errors.
   */
  @Public()
  @Get("ready")
  async ready(): Promise<{ status: string; database: string }> {
    if (await this.databaseAnswers()) return { status: "ok", database: "up" };
    throw logOnly(new ServiceUnavailableException({ status: "degraded", database: "down" }));
  }

  private async databaseAnswers(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), READINESS_TIMEOUT_MS);
    });
    const query = this.prisma.$queryRaw`SELECT 1`.then(
      () => true,
      () => false,
    );

    try {
      return await Promise.race([query, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }
}
