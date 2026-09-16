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
  IsBoolean,
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
import { NoteType, Sentiment } from "@prisma/client";
import type { Role } from "@appsgain/shared";
import { CurrentUser, RequirePermissions } from "../auth/decorators";
import type { TenantContext } from "../prisma/tenant-prisma.provider";
import { NotesService } from "./notes.service";

class CreateNoteDto {
  @IsUUID()
  leadId!: string;

  @IsOptional()
  @IsUUID()
  callId?: string;

  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  content!: string;

  @IsOptional()
  @IsEnum(NoteType)
  type?: NoteType;

  @IsOptional()
  @IsEnum(Sentiment)
  sentiment?: Sentiment;
}

class UpdateNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  content?: string;

  @IsOptional()
  @IsEnum(NoteType)
  type?: NoteType;

  @IsOptional()
  @IsEnum(Sentiment)
  sentiment?: Sentiment;
}

class ListNotesDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @IsOptional()
  @IsUUID()
  authorId?: string;

  @IsOptional()
  @IsEnum(NoteType, { each: true })
  @Transform(({ value }) => (typeof value === "string" ? value.split(",").filter(Boolean) : value))
  type?: NoteType[];

  @IsOptional()
  @IsEnum(Sentiment, { each: true })
  @Transform(({ value }) => (typeof value === "string" ? value.split(",").filter(Boolean) : value))
  sentiment?: Sentiment[];

  @IsOptional()
  @Transform(({ value }) => (value === "true" ? true : value === "false" ? false : value))
  @IsBoolean()
  aiOnly?: boolean;

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

/** Feature List §9 — Sales Notes. */
@Controller("notes")
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  @RequirePermissions("notes.view")
  list(@Query() query: ListNotesDto) {
    return this.notes.list(query);
  }

  @Get("stats")
  @RequirePermissions("notes.view")
  stats() {
    return this.notes.stats();
  }

  @Get(":id")
  @RequirePermissions("notes.view")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.notes.findOne(id);
  }

  @Post()
  @RequirePermissions("notes.create")
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateNoteDto) {
    return this.notes.create(dto);
  }

  /**
   * The actor is passed down rather than re-read in the service, because the rule here
   * is about *who* is editing: an AI draft is fair game, a colleague's note is not.
   */
  @Patch(":id")
  @RequirePermissions("notes.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoteDto,
    @CurrentUser() user: TenantContext,
  ) {
    return this.notes.update(id, dto, { userId: user.userId, role: user.role as Role });
  }

  @Delete(":id")
  @RequirePermissions("notes.edit")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: TenantContext,
  ): Promise<void> {
    await this.notes.remove(id, { userId: user.userId, role: user.role as Role });
  }
}
