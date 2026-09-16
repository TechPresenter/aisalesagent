import {
  Body,
  Controller,
  Delete,
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
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { FollowUpChannel, FollowUpStatus, Priority } from "@prisma/client";
import { RequirePermissions } from "../auth/decorators";
import { FollowUpsService, type DerivedFollowUpStatus } from "./followups.service";

const DERIVED_STATUSES = ["PENDING", "TODAY", "OVERDUE", "COMPLETED", "CANCELLED"] as const;

const csv = () =>
  Transform(({ value }) => (typeof value === "string" ? value.split(",").filter(Boolean) : value));

class ListFollowUpsDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  /**
   * Accepts the derived states as well as the stored ones, because those are what the
   * queue is actually organised by. The service turns them back into a date range.
   */
  @IsOptional()
  @csv()
  @IsIn(DERIVED_STATUSES, { each: true })
  status?: DerivedFollowUpStatus[];

  @IsOptional()
  @csv()
  @IsEnum(FollowUpChannel, { each: true })
  channel?: FollowUpChannel[];

  @IsOptional()
  @csv()
  @IsEnum(Priority, { each: true })
  priority?: Priority[];

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsIn(["today", "tomorrow", "week", "past"])
  dueWithin?: "today" | "tomorrow" | "week" | "past";

  @IsOptional()
  @IsIn(["dueAt", "priority", "createdAt"])
  sort?: "dueAt" | "priority" | "createdAt";

  @IsOptional()
  @IsIn(["asc", "desc"])
  direction?: "asc" | "desc";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

class CreateFollowUpDto {
  @IsUUID()
  leadId!: string;

  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @IsOptional()
  @IsUUID()
  callId?: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsDateString()
  dueAt!: string;

  @IsOptional()
  @IsEnum(FollowUpChannel)
  channel?: FollowUpChannel;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  notes?: string;

  @IsOptional()
  @IsDateString()
  remindAt?: string;
}

class UpdateFollowUpDto {
  @IsOptional()
  @IsDateString()
  dueAt?: string;

  /** Null clears the assignee — distinct from omitting the field, which leaves it alone. */
  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;

  @IsOptional()
  @IsEnum(FollowUpChannel)
  channel?: FollowUpChannel;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  notes?: string;

  @IsOptional()
  @IsDateString()
  remindAt?: string | null;

  /**
   * Only the stored states are writable. TODAY and OVERDUE are readings of the clock, so
   * accepting them here would mean storing a claim that stops being true at midnight.
   */
  @IsOptional()
  @IsEnum(FollowUpStatus)
  status?: FollowUpStatus;
}

class CompleteManyDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsUUID("4", { each: true })
  ids!: string[];
}

/** Feature List §10 — Follow-ups & Tasks. */
@Controller("follow-ups")
export class FollowUpsController {
  constructor(private readonly followUps: FollowUpsService) {}

  @Get()
  @RequirePermissions("followups.view")
  list(@Query() query: ListFollowUpsDto) {
    return this.followUps.list(query);
  }

  @Get("stats")
  @RequirePermissions("followups.view")
  stats() {
    return this.followUps.stats();
  }

  @Get(":id")
  @RequirePermissions("followups.view")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.followUps.findOne(id);
  }

  @Post()
  @RequirePermissions("followups.manage")
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateFollowUpDto) {
    return this.followUps.create(dto);
  }

  /** Declared before `:id` so "complete" is not swallowed by the parameterised route. */
  @Post("complete")
  @RequirePermissions("followups.manage")
  @HttpCode(HttpStatus.OK)
  completeMany(@Body() dto: CompleteManyDto) {
    return this.followUps.completeMany(dto.ids);
  }

  @Patch(":id")
  @RequirePermissions("followups.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateFollowUpDto) {
    return this.followUps.update(id, dto);
  }

  @Delete(":id")
  @RequirePermissions("followups.manage")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.followUps.remove(id);
  }
}
