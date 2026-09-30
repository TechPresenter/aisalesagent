import {
  Controller,
  Get,
  Headers,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, timingSafeEqual } from "node:crypto";
import { Public } from "../auth/decorators";
import { IntegrationsWorker, type WorkerPass } from "./integrations.worker";

/**
 * Runs the integrations worker on request, for hosts where no timer can (Vercel).
 *
 * Vercel Cron calls GET /api/internal/cron/integrations every minute on production
 * deployments and sends `Authorization: Bearer <CRON_SECRET>`. DEV, QA and UAT have no
 * Vercel Cron, so a scheduled GitHub Actions workflow calls the same route there.
 *
 * `@Public()` only takes the route out of the user-token guards, because no user is
 * involved; the shared secret is the credential. Without CRON_SECRET the route is off.
 */
@Controller("internal/cron")
export class CronController {
  constructor(
    private readonly worker: IntegrationsWorker,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get("integrations")
  async integrations(@Headers("authorization") authorization: string | undefined): Promise<WorkerPass> {
    const secret = this.config.get<string>("CRON_SECRET");
    if (!secret) throw new ServiceUnavailableException("CRON_SECRET is not configured on this server");
    if (!bearerMatches(authorization, secret)) throw new UnauthorizedException();

    const pass = await this.worker.tick();
    // A 500 is what makes a failed pass show up as failed in the Vercel cron log.
    if (pass.error) throw new InternalServerErrorException(`Worker pass failed: ${pass.error}`);
    return pass;
  }
}

/**
 * Whether an Authorization header carries exactly `Bearer <secret>`.
 *
 * Both sides are hashed first: timingSafeEqual needs equal-length inputs, and comparing
 * digests keeps the time taken from depending on how much of the secret was guessed.
 */
export function bearerMatches(header: string | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const presented = createHash("sha256").update(header).digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(presented, expected);
}
