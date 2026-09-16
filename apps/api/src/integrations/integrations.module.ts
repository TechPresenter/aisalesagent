import { Module } from "@nestjs/common";
import { IntegrationEventsService } from "./integration-events.service";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";
import { IntegrationsWorker } from "./integrations.worker";
import { NotificationEmailService } from "./notification-email.service";
import { OAuthService } from "./oauth.service";
import { WebhookDeliveryService } from "./webhooks/webhook-delivery.service";
import { WebhooksController } from "./webhooks/webhooks.controller";
import { WebhooksService } from "./webhooks/webhooks.service";

/**
 * TRD §11 — third-party integrations, outbound webhooks, and the event dispatch both run on.
 *
 * Exports only what other modules emit into: the event service (leads, calls, credits,
 * calendar) and the notification email sender. Everything else is reached over HTTP.
 */
@Module({
  controllers: [IntegrationsController, WebhooksController],
  providers: [
    IntegrationsService,
    WebhooksService,
    WebhookDeliveryService,
    IntegrationEventsService,
    OAuthService,
    NotificationEmailService,
    IntegrationsWorker,
  ],
  exports: [IntegrationEventsService, NotificationEmailService],
})
export class IntegrationsModule {}
