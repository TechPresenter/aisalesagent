import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Prisma, type CallSettings } from "@prisma/client";
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
 */
@Injectable()
export class CallSettingsService {
  private readonly logger = new Logger(CallSettingsService.name);

  constructor(private readonly tenantPrisma: TenantPrismaFactory) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  async get(): Promise<CallSettings> {
    const existing = await this.db.callSettings.findFirst();
    if (existing) return existing;

    return this.db.callSettings.create({
      data: scopedCreate<Prisma.CallSettingsUncheckedCreateInput>({}),
    });
  }

  async update(dto: UpdateCallSettingsDto): Promise<CallSettings> {
    const current = await this.get();

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

    const updated = await this.db.callSettings.update({
      where: { id: current.id },
      data: { ...dto },
    });

    // Worth a line in the log: this is the switch between "nothing dials" and "this
    // workspace can ring strangers".
    if (dto.callingEnabled !== undefined && dto.callingEnabled !== current.callingEnabled) {
      this.logger.log(
        `AI calling ${dto.callingEnabled ? "enabled" : "disabled"} for tenant ${this.tenantPrisma.context.tenantId}`,
      );
    }

    return updated;
  }
}
