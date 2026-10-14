import { NotFoundException } from "@nestjs/common";

/**
 * What assertInTenant needs from a model: a findFirst that can be asked for one row's id.
 * Every delegate on the tenant-scoped client (`this.db.campaign`, `this.db.user`, ...)
 * satisfies it.
 */
export interface IdLookup {
  findFirst(args: {
    where: { id: string };
    select: { id: true };
  }): PromiseLike<{ id: string } | null>;
}

/**
 * Confirms that an id taken from a request body names a row in the caller's workspace,
 * and answers 404 when it does not.
 *
 * The scoped client keeps every *query* inside one tenant, but it cannot stop a *write*
 * from storing a foreign key that points elsewhere: `campaignId` on a note is just a
 * column, and the database's foreign key only asks whether the campaign exists, not whose
 * it is. Stored, such an id leaks the other way on every read — the note's
 * `include: { campaign }` follows the relation without a tenant filter and shows the
 * other workspace's campaign name. So every foreign id a client supplies is looked up
 * here, through the scoped delegate, before it is written.
 *
 * Pass the delegate of the tenant-scoped client, never PrismaService's: an unscoped
 * delegate finds every tenant's rows and turns this check into a formality.
 *
 * 404 rather than 403, as everywhere else: "that campaign is not yours" would confirm the
 * id exists in another workspace. A missing id (undefined or null) passes, so callers can
 * hand over optional fields as they arrive — null is how an update clears a link, and
 * there is nothing to check.
 */
export async function assertInTenant(
  model: IdLookup,
  id: string | null | undefined,
  noun: string,
): Promise<void> {
  if (id === undefined || id === null) return;

  const row = await model.findFirst({ where: { id }, select: { id: true } });
  if (!row) throw new NotFoundException(`That ${noun} does not exist in this workspace.`);
}
