import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { RequirePermissions } from "../../auth/decorators";
import { CreateWebhookDto, UpdateWebhookDto } from "../dto/integrations.dto";
import { WebhooksService } from "./webhooks.service";

/**
 * TRD §8 — `/webhooks`. Every route is `webhooks.manage`: an endpoint receives lead names
 * and phone numbers, so creating one is a data-export decision, and reading the delivery
 * log shows those same payloads.
 */
@Controller("webhooks")
@RequirePermissions("webhooks.manage")
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  list() {
    return this.webhooks.list();
  }

  @Post()
  create(@Body() dto: CreateWebhookDto) {
    return this.webhooks.create(dto);
  }

  @Patch(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateWebhookDto) {
    return this.webhooks.update(id, dto);
  }

  @Post(":id/rotate-secret")
  rotateSecret(@Param("id", ParseUUIDPipe) id: string) {
    return this.webhooks.rotateSecret(id);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.webhooks.remove(id);
  }

  @Post(":id/test")
  test(@Param("id", ParseUUIDPipe) id: string) {
    return this.webhooks.test(id);
  }

  @Get(":id/deliveries")
  deliveries(@Param("id", ParseUUIDPipe) id: string, @Query("limit") limit?: string) {
    const parsed = Number(limit);
    return this.webhooks.deliveryLog(id, Number.isFinite(parsed) && parsed > 0 ? parsed : 25);
  }

  @Post("deliveries/:deliveryId/redeliver")
  redeliver(@Param("deliveryId", ParseUUIDPipe) deliveryId: string) {
    return this.webhooks.redeliver(deliveryId);
  }
}
