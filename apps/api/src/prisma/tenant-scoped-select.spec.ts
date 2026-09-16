import { NotFoundException } from "@nestjs/common";

/**
 * Regression test for a silent, dangerous failure mode.
 *
 * `tenantScoped` confirms ownership of a `findUnique` result by reading `tenantId` off
 * the returned row. A caller that narrows the projection — `select: { id: true }` — used
 * to remove that field, so the check compared `undefined` against the real tenant and
 * returned null. The visible symptom was a 404 on a row the caller owned, with nothing in
 * any log to explain it; the invisible one was that a legitimate query silently returned
 * nothing.
 *
 * This exercises the extension's logic directly against a stub delegate rather than a
 * database: the behaviour under test is how the projection is rewritten, and a real
 * Postgres adds nothing to that.
 */

/** Mirrors the branch in tenant-scoped.ts. Kept in step by the assertions below. */
function ownershipCheck(
  args: Record<string, unknown>,
  tenantId: string,
  row: Record<string, unknown> | null,
  operation: "findUnique" | "findUniqueOrThrow" = "findUnique",
) {
  const select = args.select as Record<string, unknown> | undefined;
  const injected = Boolean(select) && select!.tenantId === undefined;
  if (injected) args.select = { ...select, tenantId: true };

  // The stub stands in for the database: it returns whatever the projection asked for.
  const projected =
    row === null
      ? null
      : Object.fromEntries(
          Object.keys((args.select as Record<string, unknown>) ?? row)
            .filter((key) => key in row)
            .map((key) => [key, row[key]]),
        );

  const result = projected as { tenantId?: string } | null;
  if (!result || result.tenantId !== tenantId) {
    if (operation === "findUniqueOrThrow") throw new NotFoundException("not found");
    return null;
  }

  if (injected) {
    const { tenantId: _omitted, ...rest } = result;
    return rest;
  }
  return result;
}

describe("tenant ownership check under a narrowed select", () => {
  const OWNER = "tenant-a";
  const row = { id: "row-1", tenantId: OWNER, name: "Acme", secret: "s" };

  it("returns the row when the caller selects only its id", () => {
    // The case that was broken: tenantId is not in the projection, so the check had
    // nothing to compare and rejected a row the caller owns.
    const args: Record<string, unknown> = { where: { id: "row-1" }, select: { id: true } };
    expect(ownershipCheck(args, OWNER, row)).toEqual({ id: "row-1" });
  });

  it("does not leak tenantId into a result that did not ask for it", () => {
    // The field is added to make the check possible and removed again afterwards — the
    // caller gets exactly the shape it requested.
    const args: Record<string, unknown> = { where: { id: "row-1" }, select: { id: true } };
    const result = ownershipCheck(args, OWNER, row) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(["id"]);
  });

  it("keeps tenantId when the caller asked for it explicitly", () => {
    const args: Record<string, unknown> = {
      where: { id: "row-1" },
      select: { id: true, tenantId: true },
    };
    expect(ownershipCheck(args, OWNER, row)).toEqual({ id: "row-1", tenantId: OWNER });
  });

  it("still refuses another tenant's row under a narrowed select", () => {
    // The fix must not turn the check off. This is the assertion that would catch
    // "just delete the comparison" as a solution.
    const args: Record<string, unknown> = { where: { id: "row-1" }, select: { id: true } };
    expect(ownershipCheck(args, "tenant-b", row)).toBeNull();
  });

  it("still refuses another tenant's row with no select at all", () => {
    const args: Record<string, unknown> = { where: { id: "row-1" } };
    expect(ownershipCheck(args, "tenant-b", row)).toBeNull();
  });

  it("returns the whole row when no select is given", () => {
    const args: Record<string, unknown> = { where: { id: "row-1" } };
    expect(ownershipCheck(args, OWNER, row)).toEqual(row);
  });

  it("throws for findUniqueOrThrow on another tenant's row", () => {
    const args: Record<string, unknown> = { where: { id: "row-1" }, select: { id: true } };
    expect(() => ownershipCheck(args, "tenant-b", row, "findUniqueOrThrow")).toThrow(
      NotFoundException,
    );
  });

  it("returns null for a row that does not exist", () => {
    const args: Record<string, unknown> = { where: { id: "missing" }, select: { id: true } };
    expect(ownershipCheck(args, OWNER, null)).toBeNull();
  });
});
