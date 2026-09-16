import { Module } from "@nestjs/common";
import { IntegrationsModule } from "../integrations/integrations.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { CreditsController } from "./credits.controller";
import { CreditsService } from "./credits.service";

@Module({
  imports: [NotificationsModule, IntegrationsModule],
  controllers: [CreditsController],
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
