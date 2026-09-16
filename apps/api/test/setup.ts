import { config as loadEnv } from "dotenv";
import { join } from "node:path";

/**
 * Points the integration tests at the second Postgres container (port 5433) before Nest
 * or Prisma read the environment. Tests truncate every table between cases, so running
 * them against the development database would wipe it — hence a separate one, and hence
 * this failing loudly if TEST_DATABASE_URL is missing rather than falling back.
 */
loadEnv({ path: join(__dirname, "../../../.env") });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL is not set. Copy .env.example to .env at the repository root, " +
      "then run `docker-compose up -d postgres-test`.",
  );
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-not-used-anywhere-else";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-not-used-anywhere-else";
// Short enough that an expiry test does not have to wait around for it.
process.env.JWT_ACCESS_TTL ??= "15m";
process.env.JWT_REFRESH_TTL ??= "7d";
