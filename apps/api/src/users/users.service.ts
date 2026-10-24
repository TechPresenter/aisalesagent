import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, UserStatus } from "@prisma/client";
import { hasAtLeastRole, ROLE_RANK, type Role } from "@appsgain/shared";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";

/**
 * Everything about a workspace member that is safe to hand to a client.
 *
 * Written as an explicit select rather than "the row minus a few fields", because the
 * difference matters: `passwordHash`, `mfaSecret` and the reset-token columns live on the
 * same model, and a select-by-omission silently starts leaking any column added later.
 */
const MEMBER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  phone: true,
  avatarUrl: true,
  language: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type WorkspaceMember = Prisma.UserGetPayload<{ select: typeof MEMBER_SELECT }>;

@Injectable()
export class UsersService {
  constructor(private readonly tenantPrisma: TenantPrismaFactory) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  async list(query: { search?: string; role?: Role[]; status?: UserStatus[] } = {}) {
    const where: Prisma.UserWhereInput = {};
    if (query.role?.length) where.role = { in: query.role };
    if (query.status?.length) where.status = { in: query.status };
    if (query.search) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
      ];
    }

    return this.db.user.findMany({
      where,
      orderBy: [{ name: "asc" }],
      select: MEMBER_SELECT,
    });
  }

  async findOne(id: string): Promise<WorkspaceMember> {
    const user = await this.db.user.findUnique({ where: { id }, select: MEMBER_SELECT });
    if (!user) throw new NotFoundException("That person is not a member of this workspace.");
    return user;
  }

  /**
   * Changes a member's role, status or details.
   *
   * Three rules, all about not letting a workspace lock itself out or let someone act
   * past their own authority:
   *
   *  - Nobody may change anything about someone ranked above them — role, status, name
   *    or phone — nor grant a role above their own. Checking rank only on role changes
   *    left an ADMIN free to disable the OWNER, which is a takeover by other means: the
   *    one person who could undo it can no longer sign in. Equals may still manage each
   *    other, so two ADMINs are not stuck waiting on the OWNER for routine changes.
   *  - The last active OWNER cannot be demoted or disabled. There must always be someone
   *    who can administer the workspace, and discovering otherwise is a support ticket
   *    nobody can resolve from inside the product.
   *  - Disabling or demoting someone ends their sessions. Refresh re-reads the account,
   *    so a disabled member was already refused there, but a demoted one would simply
   *    refresh into a new session at the lower role and keep every device they were
   *    signed in on. Revoking makes either change mean signed out everywhere at the next
   *    refresh, so they come back, if at all, by signing in under the new terms. The
   *    access token they already hold lives out its 15 minutes, as jwt.strategy.ts
   *    explains.
   */
  async update(
    id: string,
    input: { role?: Role; status?: UserStatus; name?: string; phone?: string },
    actor: { userId: string; role: Role },
  ): Promise<WorkspaceMember> {
    const target = await this.db.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException("That person is not a member of this workspace.");

    const targetRank = ROLE_RANK[target.role as Role];
    if (targetRank > ROLE_RANK[actor.role]) {
      throw new ForbiddenException("You cannot change someone ranked above you.");
    }
    if (input.role !== undefined && !hasAtLeastRole(actor.role, input.role)) {
      throw new ForbiddenException("You cannot grant a role above your own.");
    }

    const beingDisabled = input.status === "DISABLED";
    const losingLastOwner =
      target.role === "OWNER" &&
      ((input.role !== undefined && input.role !== "OWNER") || beingDisabled);

    if (losingLastOwner) {
      const owners = await this.db.user.count({ where: { role: "OWNER", status: "ACTIVE" } });
      if (owners <= 1) {
        throw new BadRequestException(
          "This is the workspace's last owner. Promote someone else first.",
        );
      }
    }

    if (beingDisabled && target.id === actor.userId) {
      throw new BadRequestException("You cannot disable your own account.");
    }

    // Any status other than ACTIVE is refused at sign-in and refresh alike, so it ends
    // sessions just as DISABLED does.
    const losingAccess = input.status !== undefined && input.status !== "ACTIVE";
    const demoted = input.role !== undefined && ROLE_RANK[input.role] < targetRank;

    // One transaction, so the change and the sign-out land together: a member is never
    // left demoted with their old sessions still able to refresh.
    //
    // updateMany and findFirst rather than update, on purpose. The scoped client checks
    // a single-row update's ownership with a read on the *outer* client, and inside an
    // interactive transaction that read waits for a connection the transaction is
    // holding. With a pool of one connection — the PGlite dev and test databases', and a
    // common serverless setting — it waits until the transaction times out. The
    // filterable operations take their tenant filter in the where clause instead and run
    // on the transaction's own connection.
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id },
        data: {
          role: input.role,
          status: input.status,
          name: input.name?.trim(),
          phone: input.phone,
        },
      });
      if (count === 0) {
        throw new NotFoundException("That person is not a member of this workspace.");
      }

      if (losingAccess || demoted) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      return tx.user.findFirstOrThrow({ where: { id }, select: MEMBER_SELECT });
    });
  }

  /** Disables rather than deletes: calls, notes and follow-ups still name the actor. */
  async deactivate(id: string, actor: { userId: string; role: Role }): Promise<WorkspaceMember> {
    return this.update(id, { status: "DISABLED" }, actor);
  }

  async byIds(ids: string[]): Promise<Map<string, WorkspaceMember>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.user.findMany({
      where: { id: { in: ids } },
      select: MEMBER_SELECT,
    });
    return new Map(rows.map((row) => [row.id, row]));
  }
}
