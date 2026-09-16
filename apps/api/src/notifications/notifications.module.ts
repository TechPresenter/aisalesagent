import { Module } from "@nestjs/common";
import { NotificationPreferencesController } from "./notification-preferences.controller";
import { NotificationPreferencesService } from "./notification-preferences.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Module({
  controllers: [NotificationsController, NotificationPreferencesController],
  providers: [NotificationsService, NotificationPreferencesService],
  // Exported so the services that do the work — calls, leads, credits — can raise a
  // notice about what they just did.
  exports: [NotificationsService, NotificationPreferencesService],
})
export class NotificationsModule {}
