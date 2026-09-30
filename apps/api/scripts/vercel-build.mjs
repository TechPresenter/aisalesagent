/**
 * Build step for the API's Vercel project (apps/api/vercel.json → buildCommand).
 *
 * Vercel compiles src/main.ts into the function itself. This step makes sure that compile,
 * and the function it produces, find what they need:
 *
 *   1. the environment's settings, checked with the same rules the API applies at startup,
 *      so a missing secret fails the build here instead of every request after it ships;
 *   2. @appsgain/shared, which the API imports from its compiled dist/;
 *   3. the Prisma client, generated on Vercel's own Linux image;
 *   4. the schema of this environment's database, migrated before the new code serves it.
 *
 * Migrations use the direct connection (DATABASE_URL_UNPOOLED from the Neon integration),
 * because `prisma migrate` cannot run through the connection pooler the app itself uses.
 * Set SKIP_DB_MIGRATIONS=1 to build without touching the database.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(apiDir, "..", "..");

function run(label, command, args, options = {}) {
  console.log(`\n▸ ${label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    // npm and npx are .cmd shims on Windows, which only start through a shell.
    shell: process.platform === "win32" && command !== process.execPath,
    ...options,
  });
  if (result.status !== 0) {
    console.error(`\n✖ ${label} failed.`);
    process.exit(result.status ?? 1);
  }
}

// Every Vercel deployment runs the API with NODE_ENV=production, DEV, QA and UAT included.
run(
  "Checking this environment's settings",
  process.execPath,
  [
    "-r",
    "ts-node/register/transpile-only",
    "-e",
    'require("./src/config/env.validation").validateEnv({ ...process.env, NODE_ENV: "production" });',
  ],
  { cwd: apiDir },
);

run("Building @appsgain/shared", "npm", ["run", "build", "--workspace=@appsgain/shared"], { cwd: repoRoot });

run("Generating the Prisma client", "npx", ["prisma", "generate"], { cwd: apiDir });

if (process.env.SKIP_DB_MIGRATIONS === "1") {
  console.log("\nSKIP_DB_MIGRATIONS=1: leaving the database schema as it is.");
} else {
  const migrationUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!migrationUrl) {
    console.error("\n✖ Neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set for this environment.");
    process.exit(1);
  }
  run("Applying database migrations", "npx", ["prisma", "migrate", "deploy"], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: migrationUrl },
  });
}

console.log("\n✔ API build step complete; Vercel now compiles src/main.ts into the function.");
