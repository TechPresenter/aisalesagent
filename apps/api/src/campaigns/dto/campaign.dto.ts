import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { CampaignStatus, CampaignType } from "@prisma/client";

/** Minutes from midnight — 0 is 00:00, 1439 is 23:59. */
const MINUTES_IN_DAY = 1439;

export class CreateCampaignDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(CampaignType)
  type?: CampaignType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  targetAudience?: string;

  @IsOptional()
  @IsUUID()
  aiAgentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  callScript?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  aiInstructions?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  dailyCallLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MINUTES_IN_DAY)
  callWindowStart?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MINUTES_IN_DAY)
  callWindowEnd?: number;

  /** 0 = Sunday. Empty means every day. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  callDays?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  language?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxAttempts?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(10080)
  retryDelayMinutes?: number;
}

/**
 * PATCH. Written out rather than extending CreateCampaignDto — `extends` cannot widen a
 * required field to optional, and class-validator reads its rules off the class it is
 * handed, so the alternative is a new dependency for very little.
 *
 * `status` is deliberately absent: a campaign moves between DRAFT, ACTIVE, PAUSED
 * and COMPLETED through `POST /campaigns/:id/{activate,pause,resume,complete}`, which
 * validate the transition. Allowing it here would let a client set ACTIVE on a campaign
 * with no agent and no leads, and the dialer would find out at 9am.
 */
export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(CampaignType)
  type?: CampaignType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  targetAudience?: string;

  @IsOptional()
  @IsUUID()
  aiAgentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  callScript?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  aiInstructions?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  dailyCallLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MINUTES_IN_DAY)
  callWindowStart?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MINUTES_IN_DAY)
  callWindowEnd?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  callDays?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  language?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxAttempts?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(10080)
  retryDelayMinutes?: number;
}

export class ListCampaignsDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @IsOptional()
  @IsEnum(CampaignStatus, { each: true })
  @Transform(({ value }) => (typeof value === "string" ? value.split(",").filter(Boolean) : value))
  status?: CampaignStatus[];

  @IsOptional()
  @IsEnum(CampaignType, { each: true })
  @Transform(({ value }) => (typeof value === "string" ? value.split(",").filter(Boolean) : value))
  type?: CampaignType[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

/** Adding leads to a campaign, either explicitly or by the filter the user is looking at. */
export class AddCampaignLeadsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID(undefined, { each: true })
  leadIds?: string[];

  /**
   * Add every lead matching a filter instead of an id list. Capped server-side, because
   * "add all" against a 200k-row workspace is a request to queue 200k calls.
   */
  @IsOptional()
  @IsBoolean()
  allMatchingFilter?: boolean;

  @IsOptional()
  @IsEnum(CampaignStatus, { each: true })
  status?: CampaignStatus[];
}
