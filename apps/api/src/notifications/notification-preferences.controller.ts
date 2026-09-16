import { Body, Controller, Get, Patch } from "@nestjs/common";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  ValidateNested,
} from "class-validator";
import {
  NotificationChannel,
  NotificationFrequency,
  NotificationType,
} from "@prisma/client";
import { CurrentUser } from "../auth/decorators";
import type { TenantContext } from "../prisma/tenant-prisma.provider";
import {
  NotificationPreferencesService,
  type NotificationPreferenceView,
} from "./notification-preferences.service";

class PreferenceDto {
  @IsEnum(NotificationType)
  type!: NotificationType;

  @IsArray()
  @ArrayMaxSize(5)
  @IsEnum(NotificationChannel, { each: true })
  channels!: NotificationChannel[];

  @IsOptional()
  @IsEnum(NotificationFrequency)
  frequency: NotificationFrequency = NotificationFrequency.INSTANT;
}

class UpdatePreferencesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PreferenceDto)
  preferences!: PreferenceDto[];
}

/**
 * A person's own notification preferences. No permission decorator: these are the
 * caller's own settings, and the user id comes from the token rather than the body, so
 * there is nobody else's to read or write.
 */
@Controller("notification-preferences")
export class NotificationPreferencesController {
  constructor(private readonly preferences: NotificationPreferencesService) {}

  @Get()
  list(@CurrentUser() user: TenantContext): Promise<NotificationPreferenceView[]> {
    return this.preferences.list(user.userId);
  }

  @Patch()
  update(
    @Body() dto: UpdatePreferencesDto,
    @CurrentUser() user: TenantContext,
  ): Promise<NotificationPreferenceView[]> {
    return this.preferences.update(user.userId, dto.preferences);
  }
}
