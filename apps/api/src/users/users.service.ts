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
   * Two rules, both about not letting a workspace lock itself out or let someone promote
   * themselves past their own authority:
   *
   *  - Nobody may grant a role above their own, or change the role of someone ranked
   *    above them. Otherwise an ADMIN could make themselves OWNER through a second
   *    account, and the hierarchy would be decorative.
   *  - The last active OWNER cannot be demoted or disabled. There must always be someone
   *    who can administer the workspace, and discovering otherwise is a support ticket
   *    nobody can resolve from inside the product.
   */
  async update(
    id: string,
    input: { role?: Role; status?: UserStatus; name?: string; phone?: string },
    actor: { userId: string; role: Role },
  ): Promise<WorkspaceMember> {
    const target = await this.db.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException("That person is not a member of this workspace.");

    if (input.role !== undefined) {
      if (!hasAtLeastRole(actor.role, input.role)) {
        throw new ForbiddenException("You cannot grant a role above your own.");
      }
      if (ROLE_RANK[target.role as Role] > ROLE_RANK[actor.role]) {
        throw new ForbiddenException("You cannot change the role of someone above you.");
      }
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

    return this.db.user.update({
      where: { id },
      data: {
        role: input.role,
        status: input.status,
        name: input.name?.trim(),
        phone: input.phone,
      },
      select: MEMBER_SELECT,
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
