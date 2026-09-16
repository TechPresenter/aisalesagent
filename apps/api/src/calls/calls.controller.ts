import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  IsUUID,
} from "class-validator";
import { CallOutcome, CallStatus } from "@prisma/client";
import { RequirePermissions } from "../auth/decorators";
import { CallsService, type PlaceCallOutcome } from "./calls.service";
import { DialerService } from "./dialer.service";

class PlaceCallDto {
  @IsUUID()
  leadId!: string;

  @IsOptional()
  @IsUUID()
  campaignId?: string;
}

class ListCallsDto {
  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsUUID()
  agentId?: string;

  @IsOptional()
  @IsEnum(CallStatus, { each: true })
  @Transform(({ value }) => (typeof value === "string" ? value.split(",").filter(Boolean) : value))
  status?: CallStatus[];

  @IsOptional()
  @IsEnum(CallOutcome, { each: true })
  @Transform(({ value }) => (typeof value === "string" ? value.split(",").filter(Boolean) : value))
  outcome?: CallOutcome[];

  /** Matched against the number, the company and the contact. */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsIn(["short", "medium", "long"])
  duration?: "short" | "medium" | "long";

  @IsOptional()
  @Transform(({ value }) => (value === "true" ? true : value === "false" ? false : value))
  @IsBoolean()
  hasRecording?: boolean;

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

class SetOutcomeDto {
  @IsEnum(CallOutcome)
  outcome!: CallOutcome;
}

/**
 * Feature List §5 — AI Calling.
 *
 * `calling.start` is what gates placing a call, separately from `calling.view`. Watching
 * the console and spending the workspace's credits on real phone calls are different
 * privileges.
 */
@Controller("calls")
export class CallsController {
  constructor(
    private readonly calls: CallsService,
    private readonly dialer: DialerService,
  ) {}

  @Get()
  @RequirePermissions("calling.view")
  list(@Query() query: ListCallsDto) {
    return this.calls.list(query);
  }

  /** Call History's KPI strip. Takes the same date range as the table below it. */
  @Get("stats")
  @RequirePermissions("calling.view")
  stats(@Query("from") from?: string, @Query("to") to?: string) {
    return this.calls.historyStats({ from, to });
  }

  /** Calls per outcome — the dashboard's donut. All time unless a range is given. */
  @Get("outcomes")
  @RequirePermissions("calling.view")
  outcomes(@Query("from") from?: string, @Query("to") to?: string) {
    return this.calls.outcomeBreakdown({ from, to });
  }

  /** Calls per hour of the day, last 30 days — the Analytics distribution chart. */
  @Get("by-hour")
  @RequirePermissions("calling.view")
  byHour() {
    return this.calls.hourlyDistribution();
  }

  @Get("overview")
  @RequirePermissions("calling.view")
  overview() {
    return this.calls.overview();
  }

  @Get("active")
  @RequirePermissions("calling.view")
  active() {
    return this.calls.active();
  }

  @Get(":id")
  @RequirePermissions("calling.view")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.calls.findOne(id);
  }

  /**
   * Why a lead will or will not be called, without dialling.
   *
   * A read, so it needs only `calling.view`: explaining the rules is not the same as
   * being allowed to act on them.
   */
  @Get("gates/:leadId")
  @RequirePermissions("calling.view")
  explain(
    @Param("leadId", ParseUUIDPipe) leadId: string,
    @Query("campaignId") campaignId?: string,
  ) {
    return this.calls.explain(leadId, campaignId);
  }

  @Post()
  @RequirePermissions("calling.start")
  @HttpCode(HttpStatus.OK)
  place(@Body() dto: PlaceCallDto): Promise<PlaceCallOutcome> {
    return this.calls.placeCall(dto.leadId, dto.campaignId);
  }

  /** Polls the provider and advances the call. Idempotent; safe to call repeatedly. */
  @Post(":id/sync")
  @RequirePermissions("calling.view")
  @HttpCode(HttpStatus.OK)
  sync(@Param("id", ParseUUIDPipe) id: string) {
    return this.calls.syncStatus(id);
  }

  /**
   * What the next dialer pass would do, without dialling. A read, so `calling.view`.
   */
  @Get("dialer/preview/:campaignId")
  @RequirePermissions("calling.view")
  preview(@Param("campaignId", ParseUUIDPipe) campaignId: string) {
    return this.dialer.preview(campaignId);
  }

  /**
   * Runs one dialer pass over a campaign. `calling.start`, because a pass places real
   * calls and spends real credits — the same privilege as dialling one lead by hand.
   */
  @Post("dialer/run/:campaignId")
  @RequirePermissions("calling.start")
  @HttpCode(HttpStatus.OK)
  runCampaign(@Param("campaignId", ParseUUIDPipe) campaignId: string) {
    return this.dialer.runCampaign(campaignId);
  }

  /** One pass over every active campaign. Intended for a scheduler. */
  @Post("dialer/run")
  @RequirePermissions("calling.start")
  @HttpCode(HttpStatus.OK)
  runAll() {
    return this.dialer.runAll();
  }

  /**
   * Advances every in-flight call. Intended for a scheduler and as the safety net for
   * provider webhooks that never arrive. `calling.view` because it places no calls — it
   * only reconciles ones already made.
   */
  @Post("sync-active")
  @RequirePermissions("calling.view")
  @HttpCode(HttpStatus.OK)
  syncActive() {
    return this.calls.syncActive();
  }

  @Post(":id/hangup")
  @RequirePermissions("calling.manage")
  @HttpCode(HttpStatus.OK)
  hangUp(@Param("id", ParseUUIDPipe) id: string) {
    return this.calls.hangUp(id);
  }

  @Post(":id/outcome")
  @RequirePermissions("calling.manage")
  @HttpCode(HttpStatus.OK)
  setOutcome(@Param("id", ParseUUIDPipe) id: string, @Body() dto: SetOutcomeDto) {
    return this.calls.setOutcome(id, dto.outcome);
  }
}
