import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";
import { LeadSource, LeadStatus } from "@prisma/client";

/**
 * Why a workspace may contact a lead, as a short code stored on the lead and on the
 * import that created it.
 *
 * Which grounds are acceptable for calling a business contact in India is counsel's call,
 * not the code's, so the list is kept short and conservative and lives in one constant:
 * narrowing it is a one-line change, and widening it should come with the wording the
 * web app shows beside each code.
 *
 *   CONSENT — the person agreed to be contacted (a form, a call, an event).
 *   EXISTING_RELATIONSHIP — an existing customer, or someone who enquired first.
 *   LEGITIMATE_INTEREST — business contact details published for business enquiries.
 */
export const LAWFUL_BASES = ["CONSENT", "EXISTING_RELATIONSHIP", "LEGITIMATE_INTEREST"] as const;
export type LawfulBasis = (typeof LAWFUL_BASES)[number];

/**
 * The most rows one import may carry. The web app splits a bigger file into batches of
 * this size or less, so the cap bounds the work one request does — the duplicate check,
 * the inserts and the timeline rows all run inside one transaction — rather than the size
 * of a list a workspace can bring.
 */
export const MAX_IMPORT_ROWS = 10_000;

/** Characters, not bytes. The body parser's byte limit on this route is the outer bound. */
export const MAX_IMPORT_CSV_LENGTH = 4_000_000;

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

  /** Ignored when false for a number already on the suppression list: it stays do-not-call. */
  @IsOptional()
  @IsBoolean()
  doNotCall?: boolean;

  @IsOptional()
  @IsIn(LAWFUL_BASES)
  lawfulBasis?: LawfulBasis;

  /** When the person agreed to be contacted, as an ISO 8601 date or date-time. */
  @IsOptional()
  @IsISO8601({ strict: true })
  consentCapturedAt?: string;
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

  /**
   * Marking a lead do-not-call also puts its number on the suppression list. Clearing it
   * takes off the workspace's own mark, and is refused (409) while the number is held for
   * a reason that is not the lead's to give up: the person opted out on a call, an
   * imported list said so, or a manager blocked it in Settings.
   */
  @IsOptional()
  @IsBoolean()
  doNotCall?: boolean;

  /** Null clears it. */
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsIn(LAWFUL_BASES)
  lawfulBasis?: LawfulBasis | null;

  /** Null clears it. */
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsISO8601({ strict: true })
  consentCapturedAt?: string | null;
}

/**
 * The filters `GET /leads` and `GET /leads/export` share, so an export holds exactly the
 * rows the list was showing — never a near miss because the two parsed a filter apart.
 */
export class LeadFiltersDto {
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
}

/** Query string for `GET /leads` — the shared filters plus paging. */
export class ListLeadsDto extends LeadFiltersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  // Capped so a client cannot ask for the whole table in one request and stall the pool.
  // The whole table is what /leads/export is for, and it streams.
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
  @MaxLength(MAX_IMPORT_CSV_LENGTH, {
    message: `The file is too large to import in one go. Split it into files of at most ${MAX_IMPORT_ROWS.toLocaleString("en-IN")} rows.`,
  })
  csv!: string;

  /**
   * {targetField: csvHeader}, e.g. {"name": "Company", "phone": "Mobile"}. Columns with no
   * mapping are preserved into custom_fields rather than discarded. Besides name, phone
   * and city, `doNotCall` and `consentCapturedAt` may be mapped; a column headed "DND" or
   * "Do not call" is picked up without being mapped.
   */
  @IsObject()
  mapping!: Record<string, string>;

  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  /** Preview mode: run the whole pipeline and report, but write nothing. */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  /**
   * The uploader's statement that the workspace may lawfully contact everyone in the file.
   * Required, and required to be true, for anything but a dry run.
   */
  @IsOptional()
  @IsBoolean()
  attestation?: boolean;

  /** Required for anything but a dry run; recorded on the batch and on every lead it adds. */
  @IsOptional()
  @IsIn(LAWFUL_BASES)
  lawfulBasis?: LawfulBasis;

  /**
   * SHA-256, in hex, of the file the uploader picked, hashed by the browser before it
   * split the file into requests. Sent with every request of the upload and recorded on
   * each one's ImportBatch beside the hash of the request's own CSV, which is all the
   * server can compute itself. Optional, so a client that sends whole files need not.
   */
  @IsOptional()
  @Matches(/^[0-9a-fA-F]{64}$/, { message: "fileSha256 must be a SHA-256 digest in hex." })
  fileSha256?: string;

  /**
   * One id for the whole upload, chosen by the browser (a UUID will do) and sent with every
   * request of it, so the batches of one file can be found together.
   */
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/, {
    message: "uploadId must be 8 to 64 letters, digits, hyphens or underscores.",
  })
  uploadId?: string;
}
