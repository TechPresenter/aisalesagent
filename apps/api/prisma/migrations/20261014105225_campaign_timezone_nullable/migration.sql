-- A campaign's timezone becomes optional, and empty means "the workspace's calling
-- timezone" (call_settings.timezone).
--
-- The column used to default to 'Asia/Kolkata', so every campaign carried a zone and the
-- calling gate's fallback to the workspace's own zone could never run. New campaigns now
-- leave it empty unless someone picks one.
--
-- Existing rows keep the zone they have. Nothing records whether a person chose it or the
-- default filled it in, and clearing it would move the calling hours of a campaign that
-- is dialling today.
--
-- Rolling back to the release before this one needs one statement first. That release's
-- client declares the column required and refuses to read a row where it is empty, so
-- fill the empty ones with the zone they were following:
--
--   UPDATE "campaigns" c SET "timezone" = COALESCE(
--     (SELECT s."timezone" FROM "call_settings" s WHERE s."tenant_id" = c."tenant_id"),
--     'Asia/Kolkata')
--   WHERE c."timezone" IS NULL;

-- AlterTable
ALTER TABLE "campaigns" ALTER COLUMN "timezone" DROP NOT NULL,
ALTER COLUMN "timezone" DROP DEFAULT;
