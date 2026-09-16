import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { Transform, Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";
import { CallOutcome, Sentiment } from "@prisma/client";
import { RequirePermissions } from "../auth/decorators";
import { TranscriptsService } from "./transcripts.service";

class ListTranscriptsDto {
  /** Matched against the utterances themselves, the AI summary, and the company name. */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @IsOptional()
  @IsUUID()
  agentId?: string;

  @IsOptional()
  @IsEnum(CallOutcome, { each: true })
  @Transform(({ value }) => (typeof value === "string" ? value.split(",").filter(Boolean) : value))
  outcome?: CallOutcome[];

  @IsOptional()
  @IsEnum(Sentiment, { each: true })
  @Transform(({ value }) => (typeof value === "string" ? value.split(",").filter(Boolean) : value))
  sentiment?: Sentiment[];

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

/**
 * Feature List §7 — Transcripts.
 *
 * Read-only throughout: a transcript is produced by the calling pipeline, never authored
 * here. Segments are their own endpoint so a list of transcripts can carry summaries
 * without dragging every utterance of every call along with it.
 */
@Controller("transcripts")
export class TranscriptsController {
  constructor(private readonly transcripts: TranscriptsService) {}

  @Get()
  @RequirePermissions("transcripts.view")
  list(@Query() query: ListTranscriptsDto) {
    return this.transcripts.list(query);
  }

  @Get("stats")
  @RequirePermissions("transcripts.view")
  stats() {
    return this.transcripts.stats();
  }

  @Get(":id")
  @RequirePermissions("transcripts.view")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.transcripts.findOne(id);
  }

  @Get(":id/segments")
  @RequirePermissions("transcripts.view")
  segments(@Param("id", ParseUUIDPipe) id: string) {
    return this.transcripts.segments(id);
  }

  /**
   * Plain text, for copy and download.
   *
   * Rendered server-side rather than assembled in the browser so that the copied text
   * and the downloaded file are the same bytes — two formatters would drift.
   */
  @Get(":id/text")
  @RequirePermissions("transcripts.view")
  @Header("Content-Type", "text/plain; charset=utf-8")
  text(@Param("id", ParseUUIDPipe) id: string) {
    return this.transcripts.asText(id);
  }
}
