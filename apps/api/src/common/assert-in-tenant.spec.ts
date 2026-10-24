import { NotFoundException } from "@nestjs/common";
import { assertInTenant, type IdLookup } from "./assert-in-tenant";

/**
 * The helper is only as good as the delegate it is given — the tenant filter comes from
 * the scoped client (the e2e suite covers that end to end). What is checked here is the
 * helper's own contract: it asks for the id alone, 404s on nothing, and treats a missing
 * id as nothing to check.
 */
function delegate(found: boolean) {
  const findFirst = jest.fn().mockResolvedValue(found ? { id: "row-1" } : null);
  return { model: { findFirst } as IdLookup, findFirst };
}

describe("assertInTenant", () => {
  it("passes when the scoped lookup finds the row, selecting only its id", async () => {
    const { model, findFirst } = delegate(true);

    await expect(assertInTenant(model, "row-1", "campaign")).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledWith({ where: { id: "row-1" }, select: { id: true } });
  });

  it("answers 404 with a message naming the kind of thing, not whose it is", async () => {
    const { model } = delegate(false);

    const failure = assertInTenant(model, "someone-elses", "campaign");
    await expect(failure).rejects.toBeInstanceOf(NotFoundException);
    await expect(failure).rejects.toThrow("That campaign does not exist in this workspace.");
  });

  it.each([undefined, null])("does not look anything up for %p", async (id) => {
    const { model, findFirst } = delegate(false);

    await expect(assertInTenant(model, id, "team member")).resolves.toBeUndefined();
    expect(findFirst).not.toHaveBeenCalled();
  });
});
