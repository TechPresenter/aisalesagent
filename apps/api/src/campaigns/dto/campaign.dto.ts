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
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from "class-validator";
import { CampaignLeadState, CampaignStatus, CampaignType } from "@prisma/client";
import { IsIanaTimezone } from "../../common/iana-timezone";
import { LeadFiltersDto } from "../../leads/dto/lead.dto";

/** Minutes from midnight — 0 is 00:00, 1439 is 23:59. */
const MINUTES_IN_DAY = 1439;

/** The most leads one "add everything matching" request may queue. */
export const MAX_LEADS_PER_ADD = 10_000;

export const CALL_WINDOW_ORDER_MESSAGE = "The calling window must end after it starts.";
export const DATE_ORDER_MESSAGE = "The end date must be after the start date.";

/** A number, or a date string as milliseconds; anything else is left to other validators. */
function comparable(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const time = Date.parse(value);
    return Number.isNaN(time) ? undefined : time;
  }
  return undefined;
}

/**
 * The field must be later than `property` in the same request: a calling window that ends
 * before it starts never fires, and a campaign that ends before it starts never runs.
 * Both are silent at the time they are saved and only noticed when nothing has happened.
 *
 * Only a request that carries both halves can be judged here. A PATCH that changes one
 * end is checked against the stored other end by CampaignsService.
 */
function IsLaterThan(property: string, validationOptions?: ValidationOptions): PropertyDecorator {
  return (object, propertyName) =>
    registerDecorator({
      name: "isLaterThan",
      target: object.constructor,
      propertyName: propertyName as string,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const other = (args.object as Record<string, unknown>)[args.constraints[0] as string];
          const end = comparable(value);
          const start = comparable(other);
          if (end === undefined || start === undefined) return true;
          return end > start;
        },
      },
    });
}

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

  /** Left empty with an agent named, the agent's script is copied in (CampaignsService). */
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
  @IsLaterThan("startDate", { message: DATE_ORDER_MESSAGE })
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
  @IsLaterThan("callWindowStart", { message: CALL_WINDOW_ORDER_MESSAGE })
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

  /** Omitted or null: the workspace's calling timezone, followed if it changes later. */
  @IsOptional()
  @IsIanaTimezone()
  timezone?: string | null;

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
 * Omitting a field leaves it as it is. `null` clears the ones that may be empty — the
 * agent, the script, the dates, the daily limit, the calling window and the timezone —
 * and an empty limit, window or timezone means the workspace's own call settings apply.
 * (`@IsOptional` lets null through every rule below; CampaignsService ignores a null sent
 * for a field that cannot be empty, such as the name.)
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
  name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsEnum(CampaignType)
  type?: CampaignType | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  targetAudience?: string | null;

  @IsOptional()
  @IsUUID()
  aiAgentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  callScript?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  aiInstructions?: string | null;

  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @IsOptional()
  @IsDateString()
  @IsLaterThan("startDate", { message: DATE_ORDER_MESSAGE })
  endDate?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  dailyCallLimit?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MINUTES_IN_DAY)
  callWindowStart?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MINUTES_IN_DAY)
  @IsLaterThan("callWindowStart", { message: CALL_WINDOW_ORDER_MESSAGE })
  callWindowEnd?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  callDays?: number[] | null;

  @IsOptional()
  @IsIanaTimezone()
  timezone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  language?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxAttempts?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(10080)
  retryDelayMinutes?: number | null;
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

/**
 * Adding leads to a campaign, either explicitly or by the filter the user is looking at.
 *
 * The filter is the Leads list's own (search, status, source, city, score band, owner,
 * age), so "add all matching" adds exactly the rows that list was showing.
 */
export class AddCampaignLeadsDto extends LeadFiltersDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID(undefined, { each: true })
  leadIds?: string[];

  /**
   * Add every lead matching the filter instead of an id list. Capped server-side at
   * MAX_LEADS_PER_ADD, because "add all" against a 200k-row workspace is a request to
   * queue 200k calls.
   */
  @IsOptional()
  @IsBoolean()
  allMatchingFilter?: boolean;
}

/** `GET /campaigns/:id/leads` — the leads a campaign holds, with where each one stands. */
export class ListCampaignLeadsDto {
  /** Matched against the lead's name, phone and city. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsEnum(CampaignLeadState, { each: true })
  @Transform(({ value }) => (typeof value === "string" ? value.split(",").filter(Boolean) : value))
  state?: CampaignLeadState[];

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
