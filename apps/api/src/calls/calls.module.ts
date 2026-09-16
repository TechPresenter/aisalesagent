import { Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ProvidersModule } from "../providers/providers.module";
import { CallsController } from "./calls.controller";
import { CallsService } from "./calls.service";
import { DialerService } from "./dialer.service";

@Module({
  imports: [CreditsModule, ProvidersModule, NotificationsModule],
  controllers: [CallsController],
  providers: [CallsService, DialerService],
  exports: [CallsService, DialerService],
})
export class CallsModule {}
