/**
 * Copies Settings → Calls blocked numbers from the old `call_settings.blocked_numbers`
 * column onto the suppression list, and names the entries it cannot copy.
 *
 * The migration that created the suppression list (20261014070624) did this once, as it
 * ran. Two things can put numbers in the old column after that moment:
 *
 *   - the deploy window: migrations run during the build (scripts/vercel-build.mjs), and
 *     the release before keeps serving — and saving Settings to the old column — until
 *     the new one is promoted;
 *   - a rollback: the old release comes back and saves there again.
 *
 * So run this once the new release is live, and again after any roll-forward. It is safe
 * to run any number of times: it adds the SETTINGS rows that are missing and never removes
 * one. A number taken off the list under the old release during either window therefore
 * stays blocked — the safe side to err on — until someone removes it in Settings again.
 * The current release mirrors every Settings save into the old column, so nothing it
 * removed comes back from there.
 *
 * It also lists, per workspace, old entries that are not phone numbers by the rules lead
 * numbers are stored under (src/leads/leads.dedupe.ts) — short codes, typos — and so were
 * never copied. The old list matched those by digit suffix; now they block nothing. The
 * workspaces concerned should be told.
 *
 *   DATABASE_URL=… node apps/api/scripts/backfill-suppressions.mjs            # copy, then report
 *   DATABASE_URL=… node apps/api/scripts/backfill-suppressions.mjs --dry-run  # report only
 *
 * Use the direct connection (DATABASE_URL_UNPOOLED on Neon) if the pooled one refuses.
 */
import prismaClient from "@prisma/client";

const { PrismaClient } = prismaClient;
const dryRun = process.argv.includes("--dry-run");

// The migration's normalisation: normalisePhone in SQL, plus the one rescued spelling (a
// landline written with +91), so a copied entry is stored exactly as a lead's number is.
// Blank entries are dropped up front only so the report below does not list them.
const NORMALISED = `
  WITH raw AS (
      SELECT cs."tenant_id",
             entry,
             regexp_replace(regexp_replace(entry, '[^0-9]', '', 'g'), '^0+', '') AS digits
      FROM "call_settings" cs
      CROSS JOIN LATERAL unnest(cs."blocked_numbers") AS entry
      WHERE btrim(entry) <> ''
  ),
  normalised AS (
      SELECT "tenant_id",
             entry,
             CASE
                 WHEN digits ~ '^[6-9][0-9]{9}$' THEN '91' || digits
                 WHEN digits ~ '^91[6-9][0-9]{9}$' THEN digits
                 WHEN length(digits) = 12 AND digits LIKE '91%' THEN
                     CASE
                         WHEN length(regexp_replace(substr(digits, 3), '^0+', '')) >= 8
                             THEN regexp_replace(substr(digits, 3), '^0+', '')
                         ELSE NULL
                     END
                 WHEN length(digits) BETWEEN 8 AND 15 THEN digits
                 ELSE NULL
             END AS phone
      FROM raw
  )`;

const MISSING = `
  SELECT DISTINCT n."tenant_id", n.phone
  FROM normalised n
  WHERE n.phone IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM "suppressions" s
        WHERE s."tenant_id" = n."tenant_id" AND s.phone = n.phone AND s.source = 'SETTINGS'
    )`;

const prisma = new PrismaClient();

try {
  const [{ count: missing }] = await prisma.$queryRawUnsafe(
    `${NORMALISED} SELECT count(*)::int AS count FROM (${MISSING}) AS m`,
  );

  if (dryRun) {
    console.log(`${missing} blocked number(s) in the old column are not on the suppression list yet.`);
  } else {
    const copied = await prisma.$executeRawUnsafe(
      `${NORMALISED}
       INSERT INTO "suppressions" ("id", "tenant_id", "phone", "source", "reason")
       SELECT gen_random_uuid()::text, m."tenant_id", m.phone, 'SETTINGS', 'Blocked number in call settings'
       FROM (${MISSING}) AS m
       ON CONFLICT ("tenant_id", "phone", "source") DO NOTHING`,
    );
    console.log(`Copied ${copied} blocked number(s) onto the suppression list.`);
  }

  const skipped = await prisma.$queryRawUnsafe(
    `${NORMALISED}
     SELECT t."subdomain", n.entry
     FROM normalised n
     JOIN "tenants" t ON t."id" = n."tenant_id"
     WHERE n.phone IS NULL
     ORDER BY t."subdomain", n.entry`,
  );

  if (skipped.length === 0) {
    console.log("Every entry in the old column is a phone number; nothing was left behind.");
  } else {
    console.log(
      skipped.length === 1
        ? "\n1 old entry is not a phone number, so it blocks nothing now:"
        : `\n${skipped.length} old entries are not phone numbers, so they block nothing now:`,
    );
    let current = null;
    for (const row of skipped) {
      if (row.subdomain !== current) {
        current = row.subdomain;
        console.log(`  ${current}`);
      }
      console.log(`    ${row.entry}`);
    }
  }
} finally {
  await prisma.$disconnect();
}
