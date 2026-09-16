import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { CreditsController } from "./credits.controller";
import { CreditsService } from "./credits.service";

@Module({
  imports: [NotificationsModule],
  controllers: [CreditsController],
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
