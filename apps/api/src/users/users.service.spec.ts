import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Role } from "@appsgain/shared";
import type { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import { UsersService } from "./users.service";

/**
 * The rank rules for managing a teammate. The questions are who may touch whom, and what
 * a change does to the target's sessions; tenant scoping and the HTTP layer are the e2e
 * suite's business (test/team-rank.e2e-spec.ts).
 */

type Target = { id: string; role: Role; status: "ACTIVE" | "INVITED" | "DISABLED" };

function service(target: Target, options: { activeOwners?: number } = {}) {
  const user = {
    findUnique: jest.fn().mockResolvedValue({ ...target, tenantId: "tenant-1" }),
    count: jest.fn().mockResolvedValue(options.activeOwners ?? 2),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findFirstOrThrow: jest.fn().mockResolvedValue(target),
  };
  const refreshToken = { updateMany: jest.fn().mockResolvedValue({ count: 2 }) };
  const client = {
    user,
    refreshToken,
    // The callback receives the same delegates: what matters here is what is written,
    // not that Prisma really opened a transaction.
    $transaction: jest.fn().mockImplementation((work: (tx: unknown) => unknown) => work(client)),
  };
  const factory = { client } as unknown as TenantPrismaFactory;
  return { users: new UsersService(factory), user, refreshToken, client };
}

const ADMIN = { userId: "admin-1", role: "ADMIN" as Role };
const OWNER = { userId: "owner-1", role: "OWNER" as Role };

describe("UsersService.update — rank", () => {
  const owner: Target = { id: "owner-2", role: "OWNER", status: "ACTIVE" };

  it.each([
    ["disable", { status: "DISABLED" as const }],
    ["reactivate", { status: "ACTIVE" as const }],
    ["rename", { name: "Not The Owner" }],
    ["change the phone of", { phone: "+919876500000" }],
    ["demote", { role: "AGENT" as Role }],
  ])("refuses an ADMIN who tries to %s an OWNER, writing nothing", async (_verb, input) => {
    const { users, user, refreshToken } = service(owner);

    await expect(users.update(owner.id, input, ADMIN)).rejects.toBeInstanceOf(ForbiddenException);
    expect(user.updateMany).not.toHaveBeenCalled();
    expect(refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an ADMIN deactivating an OWNER (DELETE /users/:id)", async () => {
    const { users, user } = service(owner);

    await expect(users.deactivate(owner.id, ADMIN)).rejects.toBeInstanceOf(ForbiddenException);
    expect(user.updateMany).not.toHaveBeenCalled();
  });

  it("lets equals manage each other", async () => {
    const { users, user } = service({ id: "admin-2", role: "ADMIN", status: "ACTIVE" });

    await users.update("admin-2", { name: "Second Admin" }, ADMIN);
    expect(user.updateMany).toHaveBeenCalled();
  });

  it("still refuses to grant a role above the actor's own", async () => {
    const { users } = service({ id: "agent-1", role: "AGENT", status: "ACTIVE" });

    await expect(users.update("agent-1", { role: "OWNER" }, ADMIN)).rejects.toThrow(
      "You cannot grant a role above your own.",
    );
  });

  it("still protects the last active owner", async () => {
    const { users } = service(owner, { activeOwners: 1 });

    await expect(users.update(owner.id, { status: "DISABLED" }, OWNER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe("UsersService.update — sessions", () => {
  const manager: Target = { id: "manager-1", role: "MANAGER", status: "ACTIVE" };

  const revokedFor = (refreshToken: { updateMany: jest.Mock }) =>
    expect(refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: manager.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });

  it("revokes the member's refresh tokens when they are disabled, in the same transaction", async () => {
    const { users, user, refreshToken, client } = service(manager);

    await users.deactivate(manager.id, ADMIN);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(user.updateMany).toHaveBeenCalledWith({
      where: { id: manager.id },
      data: expect.objectContaining({ status: "DISABLED" }),
    });
    revokedFor(refreshToken);
  });

  it("revokes them when the member is demoted", async () => {
    const { users, refreshToken } = service(manager);

    await users.update(manager.id, { role: "AGENT" }, ADMIN);
    revokedFor(refreshToken);
  });

  it.each([
    ["a promotion", { role: "ADMIN" as Role }],
    ["the same role again", { role: "MANAGER" as Role }],
    ["a reactivation", { status: "ACTIVE" as const }],
    ["a rename", { name: "Renamed" }],
  ])("leaves sessions alone on %s", async (_change, input) => {
    const { users, user, refreshToken } = service(manager);

    await users.update(manager.id, input, ADMIN);
    expect(user.updateMany).toHaveBeenCalled();
    expect(refreshToken.updateMany).not.toHaveBeenCalled();
  });
});
