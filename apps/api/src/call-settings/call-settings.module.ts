import { Module } from "@nestjs/common";
import { CallSettingsController } from "./call-settings.controller";
import { CallSettingsService } from "./call-settings.service";

@Module({
  controllers: [CallSettingsController],
  providers: [CallSettingsService],
  exports: [CallSettingsService],
})
export class CallSettingsModule {}
