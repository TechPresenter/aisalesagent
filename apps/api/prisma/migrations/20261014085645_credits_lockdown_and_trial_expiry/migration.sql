-- Trial expiry on the workspace, and a guarantee that a credit grant is applied once.
--
-- Additive, so the release before this one keeps working while this one deploys: the new
-- column is nullable and the old code never reads it, and no row the old code writes can
-- break the new index (it only ever wrote grants without a reference).

-- AlterTable
-- Null means the trial does not expire, which is what every existing workspace keeps.
ALTER TABLE "tenants" ADD COLUMN     "trial_ends_at" TIMESTAMP(3);

-- CreateIndex
-- One grant per reference per workspace: the trial grant (reference "trial", the tenant's
-- own id), an operator grant made against a payment or invoice reference, and later a
-- verified payment webhook. A retried request or a second click then fails on the
-- constraint instead of crediting twice; the check cannot race, because the database
-- makes it.
--
-- Partial, not a plain unique on the three columns: a charge for a call references the
-- lead, and so does its refund, and a lead is called more than once. Those rows repeat a
-- reference by design and are left out. Rows with no reference are never constrained
-- (NULLs are distinct in a unique index), which covers every grant written before this.
--
-- Prisma cannot declare a partial index in schema.prisma, and it leaves one it did not
-- create alone when diffing, so a later `migrate dev` keeps this rather than dropping it.
CREATE UNIQUE INDEX "credit_transactions_grant_reference_key"
    ON "credit_transactions" ("tenant_id", "reference_type", "reference_id")
    WHERE "type" = 'CREDIT' AND "operation" IN ('PURCHASE', 'PLAN_GRANT', 'MANUAL_ADJUSTMENT');
