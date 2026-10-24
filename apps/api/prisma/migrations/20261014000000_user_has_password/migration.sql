-- AlterTable
-- An owner who signs up with Google or Microsoft has no password of their own until they
-- set one. Every account that exists already was created with a password, hence the
-- default, which also keeps this migration safe to run under the previous release.
ALTER TABLE "users" ADD COLUMN     "has_password" BOOLEAN NOT NULL DEFAULT true;
