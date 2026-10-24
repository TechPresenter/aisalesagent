import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Prisma, type CallSettings } from "@prisma/client";
import { normalisePhone } from "../leads/leads.dedupe";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import { scopedCreate } from "../prisma/tenant-scoped";
import type { UpdateCallSettingsDto } from "./dto/call-settings.dto";

/**
 * Feature List §14 — Settings → Call Settings.
 *
 * These are the rules the dialer and the calling gates read before every call
 * (`calling-rules.ts`): the window, the retry policy, the compliance flags and the switch
 * that lets any of it ring a real phone. They were reachable only by editing the database
 * until this module existed.
 *
 * A workspace has no row until something asks for one, and the row is then created at the
 * schema's defaults — which are deliberately the cautious ones: calling off, consent and
 * a recording announcement required.
 *
 * `blockedNumbers` is the one field not read from the row. It is this screen's own
 * entries on the suppression list (source SETTINGS), read from and written to that table,
 * so the number a manager blocks here is the same list the gates and the lead import
 * check. Everything else on that list stays out of this field: opt-outs from calls and
 * imported files are the people's decisions, and a lead's do-not-call mark belongs to
 * the lead. Neither shows up here, and replacing this list never removes one. A number
 * can be on the list for several reasons at once (one row per source), so blocking a
 * number here that a lead already marks, and unblocking it later, leaves the lead's mark
 * where it was.
 */
@Injectable()
export class CallSettingsService {
  private readonly logger = new Logger(CallSettingsService.name);

  constructor(private readonly tenantPrisma: TenantPrismaFactory) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  async get(): Promise<CallSettings> {
    return this.withBlockedNumbers(await this.row());
  }

  async update(dto: UpdateCallSettingsDto): Promise<CallSettings> {
    const { blockedNumbers, ...fields } = dto;
    const current = await this.row();

    // The window is a pair, so it is checked as a pair — against whichever half this
    // request is not changing. Field-level validation cannot see the other one.
    const start = dto.callWindowStart ?? current.callWindowStart;
    const end = dto.callWindowEnd ?? current.callWindowEnd;
    if (end <= start) {
      throw new BadRequestException("The calling window has to end after it starts.");
    }

    if (dto.callDays && dto.callDays.length === 0 && (dto.callingEnabled ?? current.callingEnabled)) {
      throw new BadRequestException("Pick at least one day, or switch AI calling off.");
    }

    // Normalised up front, so a typo fails the whole save before anything is written.
    const blocked = blockedNumbers === undefined ? undefined : normaliseBlocked(blockedNumbers);

    const updated = await this.db.callSettings.update({
      where: { id: current.id },
      data: { ...fields },
    });

    if (blocked) await this.replaceBlockedNumbers(current.id, blocked);

    // Worth a line in the log: this is the switch between "nothing dials" and "this
    // workspace can ring strangers".
    if (dto.callingEnabled !== undefined && dto.callingEnabled !== current.callingEnabled) {
      this.logger.log(
        `AI calling ${dto.callingEnabled ? "enabled" : "disabled"} for tenant ${this.tenantPrisma.context.tenantId}`,
      );
    }

    return this.withBlockedNumbers(updated);
  }

  private async row(): Promise<CallSettings> {
    const existing = await this.db.callSettings.findFirst();
    if (existing) return existing;

    return this.db.callSettings.create({
      data: scopedCreate<Prisma.CallSettingsUncheckedCreateInput>({}),
    });
  }

  private async withBlockedNumbers(settings: CallSettings): Promise<CallSettings> {
    const rows = await this.db.suppression.findMany({
      where: { source: "SETTINGS" },
      // Numbers saved together share a timestamp, so the tie-break is the number itself:
      // the list reads the same on every load rather than reshuffling.
      orderBy: [{ createdAt: "asc" }, { phone: "asc" }],
      select: { phone: true },
    });
    return { ...settings, blockedNumbers: rows.map((row) => row.phone) };
  }

  /**
   * Makes this screen's blocked numbers exactly `phones`: entries no longer listed are
   * removed, new ones added. Only SETTINGS rows are read or touched. A number already on
   * the list for another reason gets a SETTINGS row beside the one it has, so taking it
   * off this list later leaves that other reason standing.
   *
   * The same list is mirrored into the settings row's old `blocked_numbers` column, which
   * nothing here reads: it is for the previous release, should a rollback bring it back
   * (see the note on the column in schema.prisma).
   */
  private async replaceBlockedNumbers(settingsId: string, phones: string[]): Promise<void> {
    const wanted = new Set(phones);
    const existing = await this.db.suppression.findMany({
      where: { source: "SETTINGS" },
      select: { id: true, phone: true },
    });
    const removed = existing.filter((row) => !wanted.has(row.phone)).map((row) => row.id);
    const createdById = this.tenantPrisma.context.userId;

    await this.db.$transaction(async (tx) => {
      if (removed.length > 0) {
        await tx.suppression.deleteMany({ where: { id: { in: removed } } });
      }
      if (wanted.size > 0) {
        await tx.suppression.createMany({
          data: [...wanted].map((phone) =>
            scopedCreate<Prisma.SuppressionCreateManyInput>({
              phone,
              source: "SETTINGS",
              reason: "Blocked number in call settings",
              createdById,
            }),
          ),
          skipDuplicates: true,
        });
      }
      // updateMany, not update: inside a transaction only filterable writes are safe on
      // the scoped client (see LeadsService).
      await tx.callSettings.updateMany({
        where: { id: settingsId },
        data: { blockedNumbers: [...wanted] },
      });
    });
  }
}

/**
 * Blocked numbers are stored the way lead numbers are, so a block matches a lead by
 * equality. An entry that is not a phone number at all is refused rather than kept: a
 * block list that quietly holds "98765 4321O" blocks nobody.
 */
function normaliseBlocked(entries: string[]): string[] {
  const phones: string[] = [];
  const invalid: string[] = [];
  for (const entry of entries) {
    if (!entry.trim()) continue;
    const { value } = normalisePhone(entry);
    if (value) phones.push(value);
    else invalid.push(entry.trim());
  }
  if (invalid.length > 0) {
    const shown = invalid.slice(0, 5).join(", ");
    throw new BadRequestException(
      `Not a phone number: ${shown}${invalid.length > 5 ? ` and ${invalid.length - 5} more` : ""}.`,
    );
  }
  return [...new Set(phones)];
}
