import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { PLATFORM_EVENT_KEYS } from "../events/event-types";

/**
 * The switches an integration has beyond its credentials. Each is optional, because the
 * screen saves the one someone flipped, and not every integration has every switch — the
 * service ignores the ones that do not apply to the provider.
 */
export class IntegrationSettingsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(PLATFORM_EVENT_KEYS, { each: true })
  events?: string[];

  @IsOptional()
  @IsBoolean()
  syncLeads?: boolean;

  @IsOptional()
  @IsBoolean()
  syncCalendar?: boolean;
}

/**
 * POST /integrations/:provider/connect.
 *
 * `credentials` is a plain object whose keys depend on the provider, so its contents are
 * checked against the catalogue in the service rather than here — the one place that knows
 * Twilio wants an account SID and HubSpot wants a token.
 */
export class ConnectIntegrationDto {
  @IsObject()
  credentials!: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => IntegrationSettingsDto)
  settings?: IntegrationSettingsDto;
}

export class CreateWebhookDto {
  @IsString()
  @MaxLength(2000)
  url!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsIn(PLATFORM_EVENT_KEYS, { each: true })
  events!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsIn(PLATFORM_EVENT_KEYS, { each: true })
  events?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}
