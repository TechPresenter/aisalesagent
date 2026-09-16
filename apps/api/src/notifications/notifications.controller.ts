import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { Transform, Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, Max, Min } from "class-validator";
import { CurrentUser } from "../auth/decorators";
import type { TenantContext } from "../prisma/tenant-prisma.provider";
import { NotificationsService, type NotificationView } from "./notifications.service";

class ListNotificationsDto {
  @IsOptional()
  @Transform(({ value }) => (value === "true" ? true : value === "false" ? false : value))
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

/**
 * The bell. No permission decorator anywhere here: these are the caller's own notices,
 * addressed by the user id on their token, so there is nobody else's list to read.
 */
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Query() query: ListNotificationsDto,
    @CurrentUser() user: TenantContext,
  ): Promise<NotificationView[]> {
    return this.notifications.list(user.userId, {
      unreadOnly: query.unreadOnly,
      limit: query.limit,
    });
  }

  /** Its own endpoint because the header asks for this on a timer and nothing else. */
  @Get("unread-count")
  async unreadCount(@CurrentUser() user: TenantContext): Promise<{ count: number }> {
    return { count: await this.notifications.unreadCount(user.userId) };
  }

  @Patch(":id/read")
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: TenantContext,
  ): Promise<void> {
    await this.notifications.markRead(user.userId, id);
  }

  @Post("read-all")
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser() user: TenantContext): Promise<{ updated: number }> {
    return this.notifications.markAllRead(user.userId);
  }
}
