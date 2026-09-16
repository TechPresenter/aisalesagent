import { Role as PrismaRole } from "@prisma/client";
import { ROLES, type Role as SharedRole } from "@appsgain/shared";

/**
 * A compile-time bridge between the Prisma `Role` enum and the ROLES list in
 * @appsgain/shared. Neither can generate the other — one is owned by the database
 * migration, the other by the shared contract — so this file is what makes drift a build
 * failure instead of a runtime surprise where a token carries a role the database has
 * never heard of.
 *
 * Add a role in one place only and `npm run typecheck` fails here until it is added in
 * both.
 */

/** Fails if Prisma gains a role that @appsgain/shared does not have. */
const _prismaRolesExistInShared: Record<PrismaRole, SharedRole> = {
  SUPER_ADMIN: "SUPER_ADMIN",
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  AGENT: "AGENT",
  VIEWER: "VIEWER",
};

/** Fails if @appsgain/shared gains a role that Prisma does not have. */
const _sharedRolesExistInPrisma: Record<SharedRole, PrismaRole> = {
  SUPER_ADMIN: PrismaRole.SUPER_ADMIN,
  OWNER: PrismaRole.OWNER,
  ADMIN: PrismaRole.ADMIN,
  MANAGER: PrismaRole.MANAGER,
  AGENT: PrismaRole.AGENT,
  VIEWER: PrismaRole.VIEWER,
};

void _prismaRolesExistInShared;
void _sharedRolesExistInPrisma;

/** Runtime narrowing for a role that arrived as a string (from a JWT, say). */
export function isRole(value: unknown): value is SharedRole {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
