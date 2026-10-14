import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { TENANT_ACCESS_TTL_MS, TenantAccessService, refusalFor, type TenantAccess } from "./tenant-access.service";

/**
 * What a workspace may do in each status. The guard applies this to every request, so
 * the table is tested here and the wiring end to end in test/admin.e2e-spec.ts.
 */
describe("refusalFor", () => {
  const now = new Date("2026-10-14T12:00:00.000Z");
  const read = { method: "GET", allowWhenSuspended: false };
  const write = { method: "POST", allowWhenSuspended: false };
  const exempt = { method: "POST", allowWhenSuspended: true };

  const state = (status: TenantAccess["status"], trialEndsAt: Date | null = null): TenantAccess => ({
    status,
    trialEndsAt,
  });

  const codeOf = (error: unknown) => ((error as ForbiddenException).getResponse() as { code?: string }).code;

  it("lets an active workspace, or a trial with time left, do anything", () => {
    expect(refusalFor(state("ACTIVE"), write, now)).toBeNull();
    expect(refusalFor(state("TRIAL"), write, now)).toBeNull();
    expect(refusalFor(state("TRIAL", new Date("2026-10-15T00:00:00Z")), write, now)).toBeNull();
  });

  it("makes a suspended workspace read-only", () => {
    expect(refusalFor(state("SUSPENDED"), read, now)).toBeNull();
    expect(refusalFor(state("SUSPENDED"), { method: "head", allowWhenSuspended: false }, now)).toBeNull();
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const refusal = refusalFor(state("SUSPENDED"), { method, allowWhenSuspended: false }, now);
      expect(refusal).toBeInstanceOf(ForbiddenException);
      expect(codeOf(refusal)).toBe("WORKSPACE_SUSPENDED");
    }
  });

  it("still lets a suspended workspace reach the routes marked for it", () => {
    expect(refusalFor(state("SUSPENDED"), exempt, now)).toBeNull();
  });

  it("treats a trial that has run out like a suspension, with its own reason", () => {
    const ended = state("TRIAL", new Date("2026-10-14T11:59:59Z"));
    expect(refusalFor(ended, read, now)).toBeNull();
    expect(refusalFor(ended, exempt, now)).toBeNull();
    expect(codeOf(refusalFor(ended, write, now))).toBe("TRIAL_ENDED");
  });

  it("ignores trialEndsAt once the workspace is no longer a trial", () => {
    expect(refusalFor(state("ACTIVE", new Date("2020-01-01T00:00:00Z")), write, now)).toBeNull();
  });

  it("refuses a cancelled workspace everything, reads and exempt routes included", () => {
    for (const request of [read, write, exempt]) {
      const refusal = refusalFor(state("CANCELLED"), request, now);
      expect(refusal).toBeInstanceOf(ForbiddenException);
      expect(codeOf(refusal)).toBe("WORKSPACE_CANCELLED");
    }
  });

  it("treats a token for a workspace that no longer exists as no credential at all", () => {
    expect(refusalFor(null, read, now)).toBeInstanceOf(UnauthorizedException);
  });
});

describe("TenantAccessService", () => {
  function serviceWith(rows: Record<string, TenantAccess>) {
    const findUnique = jest.fn(async ({ where }: { where: { id: string } }) => rows[where.id] ?? null);
    const prisma = { tenant: { findUnique } } as unknown as PrismaService;
    return { service: new TenantAccessService(prisma), findUnique };
  }

  it("reads a workspace once per cache window", async () => {
    const { service, findUnique } = serviceWith({ t1: { status: "ACTIVE", trialEndsAt: null } });

    await service.lookup("t1", 1_000);
    await service.lookup("t1", 1_000 + TENANT_ACCESS_TTL_MS - 1);
    expect(findUnique).toHaveBeenCalledTimes(1);

    await service.lookup("t1", 1_000 + TENANT_ACCESS_TTL_MS);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it("reads again straight away once told to forget, so a suspension applies at once", async () => {
    const rows: Record<string, TenantAccess> = { t1: { status: "ACTIVE", trialEndsAt: null } };
    const { service } = serviceWith(rows);

    expect((await service.lookup("t1", 0))?.status).toBe("ACTIVE");
    rows.t1 = { status: "SUSPENDED", trialEndsAt: null };
    expect((await service.lookup("t1", 1))?.status).toBe("ACTIVE");

    service.forget("t1");
    expect((await service.lookup("t1", 2))?.status).toBe("SUSPENDED");
  });

  it("caches a missing workspace too, rather than reading on every request", async () => {
    const { service, findUnique } = serviceWith({});
    expect(await service.lookup("gone", 0)).toBeNull();
    expect(await service.lookup("gone", 1)).toBeNull();
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});
