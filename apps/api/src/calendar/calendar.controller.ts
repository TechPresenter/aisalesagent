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
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
import { CalendarEventType } from "@prisma/client";
import { RequirePermissions } from "../auth/decorators";
import { CalendarService } from "./calendar.service";

class ListEventsDto {
  /** The visible window. Required — a calendar without one is a full table scan. */
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.split(",").filter(Boolean) : value))
  @IsEnum(CalendarEventType, { each: true })
  type?: CalendarEventType[];

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;
}

class CreateEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;

  @IsOptional()
  @IsEnum(CalendarEventType)
  type?: CalendarEventType;

  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;

  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsUUID()
  campaignId?: string;
}

class UpdateEventDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;

  @IsOptional()
  @IsEnum(CalendarEventType)
  type?: CalendarEventType;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;

  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string | null;
}

/** Feature List §11 — Calendar. */
@Controller("calendar")
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get("events")
  @RequirePermissions("calendar.view")
  list(@Query() query: ListEventsDto) {
    return this.calendar.list(query);
  }

  @Get("stats")
  @RequirePermissions("calendar.view")
  stats() {
    return this.calendar.stats();
  }

  @Get("events/:id")
  @RequirePermissions("calendar.view")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.calendar.findOne(id);
  }

  @Post("events")
  @RequirePermissions("calendar.manage")
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateEventDto) {
    return this.calendar.create(dto);
  }

  @Patch("events/:id")
  @RequirePermissions("calendar.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateEventDto) {
    return this.calendar.update(id, dto);
  }

  @Delete("events/:id")
  @RequirePermissions("calendar.manage")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.calendar.remove(id);
  }
}
