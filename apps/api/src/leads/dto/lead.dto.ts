import { Transform, Type } from "class-transformer";
import {
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { LeadSource, LeadStatus } from "@prisma/client";

export class CreateLeadDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(32)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;

  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;
}

/** PATCH — every field optional, and `name`/`phone` may not be blanked to empty strings. */
export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;

  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;
}

/** Query string for `GET /leads` — search, filters and paging. */
export class ListLeadsDto {
  /** Matched against name, phone and city. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsEnum(LeadStatus, { each: true })
  @Transform(({ value }) => (typeof value === "string" ? value.split(",").filter(Boolean) : value))
  status?: LeadStatus[];

  @IsOptional()
  @IsEnum(LeadSource, { each: true })
  @Transform(({ value }) => (typeof value === "string" ? value.split(",").filter(Boolean) : value))
  source?: LeadSource[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  /**
   * Score band, matching the colour bands on the score pill: high 75-100, medium 50-74,
   * low 0-49. Sent as a band rather than a min/max pair because the UI offers bands, and
   * an API that took raw bounds would let the two drift out of step.
   */
  @IsOptional()
  @IsIn(["high", "medium", "low"])
  scoreBand?: "high" | "medium" | "low";

  /** Assigned owner. "unassigned" selects leads with no owner at all. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ownerId?: string;

  /** Created within the last N days. Capped so the index stays useful. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  createdWithinDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  // Capped so a client cannot ask for the whole table in one request and stall the pool.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

/**
 * `POST /leads/import`. The CSV arrives as text rather than multipart: the mapping UI has
 * already parsed and previewed the file in the browser to show the user their columns, so
 * re-uploading the bytes for the server to parse a second time buys nothing.
 */
export class ImportLeadsDto {
  @IsString()
  @MinLength(1)
  csv!: string;

  /**
   * {targetField: csvHeader}, e.g. {"name": "Clinic Name", "phone": "Mobile"}. Columns
   * with no mapping are preserved into custom_fields rather than discarded.
   */
  @IsObject()
  mapping!: Record<string, string>;

  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  /** Preview mode: run the whole pipeline and report, but write nothing. */
  @IsOptional()
  dryRun?: boolean;
}
