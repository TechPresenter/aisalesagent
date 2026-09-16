import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { VoicemailBehavior } from "@prisma/client";

/**
 * PATCH /call-settings — every field optional, because the Settings screen saves the
 * section someone edited rather than the whole record.
 *
 * The bounds are not decoration. `maxCallSeconds` caps what one call can cost, the window
 * fields decide when a workspace is allowed to ring a stranger, and `maxAttemptsPerLead`
 * is the difference between persistence and harassment — so each one is checked here
 * rather than trusted from the browser that sent it.
 */
export class UpdateCallSettingsDto {
  // ── what the dialer does ──────────────────────────────────────────────────────────
  @IsOptional()
  @IsBoolean()
  callingEnabled?: boolean;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  defaultAiAgentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  defaultLanguage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(32)
  callerId?: string | null;

  // ── when it may dial ──────────────────────────────────────────────────────────────
  /** Minutes from midnight in `timezone`; 600 is 10:00. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  callWindowStart?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  callWindowEnd?: number;

  /** 0 is Sunday, matching JavaScript's `getDay()` and the campaign's own `callDays`. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  callDays?: number[];

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(100_000)
  maxCallsPerDay?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxAttemptsPerLead?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(10_080)
  retryDelayMinutes?: number;

  // ── how a call is handled ─────────────────────────────────────────────────────────
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  ringTimeoutSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(7200)
  maxCallSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  silenceTimeoutSeconds?: number;

  @IsOptional()
  @IsEnum(VoicemailBehavior)
  voicemailBehavior?: VoicemailBehavior;

  // ── recording and AI ──────────────────────────────────────────────────────────────
  @IsOptional()
  @IsBoolean()
  recordingEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  transcriptionEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  aiAnalysisEnabled?: boolean;

  // ── compliance ────────────────────────────────────────────────────────────────────
  @IsOptional()
  @IsBoolean()
  dncEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  recordingAnnouncement?: boolean;

  @IsOptional()
  @IsBoolean()
  consentRequired?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  blockedNumbers?: string[];

  /** ISO 3166-1 alpha-2, e.g. "IN", "AE". Empty means every country is allowed. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(2, { each: true })
  allowedCountries?: string[];

  // ── credit guards ─────────────────────────────────────────────────────────────────
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  minimumBalanceRequired?: number;

  @IsOptional()
  @IsBoolean()
  stopWhenCreditsLow?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  lowCreditThreshold?: number;
}
