import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { assertTenantScopeCoverage, tenantScoped, type TenantScopedClient } from "./tenant-scoped";

/**
 * The unscoped client. Injecting this gives a caller access to every tenant's rows, so
 * it is reserved for the four places that legitimately need it:
 *
 *   1. Authentication — resolving a login or an API key before a tenant is known.
 *   2. `POST /workspace` — creating the tenant that scope would be relative to.
 *   3. Test setup and teardown.
 *   4. The integrations worker's sweep for due webhook retries and follow-ups across all
 *      workspaces, which hands each row to a tenant-scoped client before acting on it.
 *
 * Everything else asks for `forTenant(tenantId)` and gets a client that cannot see out
 * of its own workspace. Feature code should reach for TenantPrisma (see
 * tenant-prisma.provider.ts), which resolves that automatically from the request.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.connectWithRetry();
    // Fails the boot rather than the first request if a model was added to the schema
    // without deciding whether it is tenant-scoped.
    assertTenantScopeCoverage(this);
    this.logger.log("Connected to PostgreSQL");
  }

  /**
   * Connects, tolerating a database that is not accepting connections yet.
   *
   * Without this the API's fate is decided by start-up order: a database that is thirty
   * seconds behind the API kills it outright, and in watch mode nothing restarts it — so
   * the next hour is spent debugging endpoints that are simply not being served. The
   * retry window is deliberately short enough that a genuinely absent database still
   * fails the boot with the real error rather than hanging forever.
   */
  private async connectWithRetry(attempts = 12, delayMs = 2_500): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.$connect();
        if (attempt > 1) this.logger.log(`Database reachable after ${attempt} attempts`);
        return;
      } catch (error) {
        const [message] = error instanceof Error ? error.message.split(/\r?\n/) : [String(error)];
        if (attempt >= attempts) {
          this.logger.error(`Could not reach the database after ${attempts} attempts`);
          throw error;
        }
        if (attempt === 1) {
          this.logger.warn(
            `Database is not accepting connections yet (${message}); retrying for ` +
              `${Math.round((attempts * delayMs) / 1000)}s`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** A client confined to one workspace. See tenant-scoped.ts for what it enforces. */
  forTenant(tenantId: string): TenantScopedClient {
    return tenantScoped(this, tenantId);
  }
}
