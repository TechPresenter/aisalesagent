/**
 * Vercel's "Ignored Build Step" for both projects (apps/web and apps/api vercel.json).
 *
 * Only the four environment branches deploy: develop → DEV, qa → QA, uat → UAT and
 * main → LIVE. Any other branch would build a preview with no environment of its own —
 * and the API build runs database migrations — so it is skipped.
 *
 * Vercel's convention: exit 0 skips the build, exit 1 builds.
 */

const ENVIRONMENT_BRANCHES = new Set(["develop", "qa", "uat", "main"]);

const branch = process.env.VERCEL_GIT_COMMIT_REF ?? "";

if (!branch) {
  console.log("No Git branch (a CLI deployment): building.");
  process.exit(1);
}

if (ENVIRONMENT_BRANCHES.has(branch)) {
  console.log(`"${branch}" is an environment branch: building.`);
  process.exit(1);
}

console.log(`"${branch}" is not one of ${[...ENVIRONMENT_BRANCHES].join(", ")}: skipping.`);
process.exit(0);
