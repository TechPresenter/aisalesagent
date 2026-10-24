-- The do-not-call list, the import attestation record, and the consent fields on leads.
--
-- Everything here is additive, so the release before this one keeps working while the
-- new one deploys: new columns are nullable, new tables are unused by the old code, and
-- call_settings.blocked_numbers is copied rather than dropped (see the note on it in
-- schema.prisma). The release that ships with this migration keeps writing that column
-- too, so an instant rollback reads the list as it was left; scripts/backfill-suppressions.mjs
-- copies across anything the old release saved there meanwhile.

-- CreateEnum
CREATE TYPE "SuppressionSource" AS ENUM ('OUTCOME', 'MANUAL', 'IMPORT', 'LEAD_DELETE', 'SETTINGS');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "consent_captured_at" TIMESTAMP(3),
ADD COLUMN     "import_batch_id" TEXT,
ADD COLUMN     "lawful_basis" TEXT;

-- CreateTable
CREATE TABLE "suppressions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "source" "SuppressionSource" NOT NULL,
    "reason" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "user_email" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "csv_sha256" TEXT NOT NULL,
    "file_sha256" TEXT,
    "upload_id" TEXT,
    "row_count" INTEGER NOT NULL,
    "imported_count" INTEGER NOT NULL DEFAULT 0,
    "source" "LeadSource" NOT NULL,
    "lawful_basis" TEXT NOT NULL,
    "attestation_version" TEXT NOT NULL,
    "summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppressions_tenant_id_idx" ON "suppressions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppressions_tenant_id_phone_source_key" ON "suppressions"("tenant_id", "phone", "source");

-- CreateIndex
CREATE INDEX "import_batches_tenant_id_created_at_idx" ON "import_batches"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "import_batches_tenant_id_upload_id_idx" ON "import_batches"("tenant_id", "upload_id");

-- CreateIndex
CREATE INDEX "leads_import_batch_id_idx" ON "leads"("import_batch_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: move each workspace's blocked numbers into the suppression list, as SETTINGS rows:
-- the Settings screen lists and edits those, and only those.
--
-- The CASE below is normalisePhone (src/leads/leads.dedupe.ts) in SQL, so a migrated
-- entry is stored exactly as a lead's number is and matches it by equality: digits only,
-- the domestic trunk 0 dropped, a bare Indian mobile given its 91. One spelling is
-- rescued rather than refused: 91 followed by a number that is not a mobile is a
-- landline written with its country code. normalisePhone refuses that spelling, so no
-- lead holds it; the same landline typed domestically ("022 2345 6789") is stored without
-- the 91, and that is the form kept here so the two match.
--
-- An entry that still does not survive (a short code, a typo) is left behind in the old
-- column rather than guessed at. scripts/backfill-suppressions.mjs lists those per
-- workspace, so they can be raised with the workspace instead of vanishing quietly.
WITH raw AS (
    SELECT cs."tenant_id",
           regexp_replace(regexp_replace(entry, '[^0-9]', '', 'g'), '^0+', '') AS digits
    FROM "call_settings" cs
    CROSS JOIN LATERAL unnest(cs."blocked_numbers") AS entry
),
normalised AS (
    SELECT "tenant_id",
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
)
INSERT INTO "suppressions" ("id", "tenant_id", "phone", "source", "reason")
SELECT gen_random_uuid()::text, "tenant_id", phone, 'SETTINGS', 'Blocked number in call settings'
FROM (SELECT DISTINCT "tenant_id", phone FROM normalised WHERE phone IS NOT NULL) AS distinct_numbers
ON CONFLICT ("tenant_id", "phone", "source") DO NOTHING;

-- Data: a lead already marked do-not-call gets its own MANUAL row now, so the mark
-- survives the lead being deleted from here on, as it will for every new one. A number
-- that is also on the Settings list gets both rows: each is taken back separately.
INSERT INTO "suppressions" ("id", "tenant_id", "phone", "source", "reason")
SELECT gen_random_uuid()::text, "tenant_id", "phone", 'MANUAL', 'Lead marked do not call'
FROM (SELECT DISTINCT "tenant_id", "phone" FROM "leads" WHERE "do_not_call" = true) AS marked
ON CONFLICT ("tenant_id", "phone", "source") DO NOTHING;
