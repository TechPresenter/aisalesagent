import { Body, Controller, Get, Patch } from "@nestjs/common";
import type { CallSettings } from "@prisma/client";
import { RequirePermissions } from "../auth/decorators";
import { CallSettingsService } from "./call-settings.service";
import { UpdateCallSettingsDto } from "./dto/call-settings.dto";

/** TRD §8 — the workspace's calling rules. One row per workspace, read from the token. */
@Controller("call-settings")
export class CallSettingsController {
  constructor(private readonly settings: CallSettingsService) {}

  /**
   * Reading the rules is `calling.view`: anyone watching the console needs to know the
   * window they are watching, and why a lead was skipped.
   */
  @Get()
  @RequirePermissions("calling.view")
  get(): Promise<CallSettings> {
    return this.settings.get();
  }

  /**
   * Changing them is `calling.manage` — a different privilege, because this is the switch
   * that lets the dialer ring real phones and spend the workspace's credits.
   */
  @Patch()
  @RequirePermissions("calling.manage")
  update(@Body() dto: UpdateCallSettingsDto): Promise<CallSettings> {
    return this.settings.update(dto);
  }
}
