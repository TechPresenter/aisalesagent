import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotImplementedException,
  Param,
  ParseUUIDPipe,
  Query,
} from "@nestjs/common";
import { Type } from "class-transformer";
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";
import { Public, RequirePermissions } from "../auth/decorators";
import { logOnly } from "../common/all-exceptions.filter";
import { RecordingsService } from "./recordings.service";

class ListRecordingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

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

/** Feature List §8 — Recordings. */
@Controller("recordings")
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  @Get()
  @RequirePermissions("recordings.view")
  list(@Query() query: ListRecordingsDto) {
    return this.recordings.list(query);
  }

  @Get("stats")
  @RequirePermissions("recordings.view")
  stats() {
    return this.recordings.stats();
  }

  @Get(":id")
  @RequirePermissions("recordings.view")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.recordings.findOne(id);
  }

  /**
   * Mints a short-lived link to the audio.
   *
   * `recordings.download` rather than `.view`: seeing that a call was recorded and being
   * able to take the audio away are different privileges, and a workspace should be able
   * to grant the first without the second.
   */
  @Get(":id/url")
  @RequirePermissions("recordings.download")
  signedUrl(@Param("id", ParseUUIDPipe) id: string) {
    return this.recordings.signedUrl(id);
  }

  /**
   * The audio itself, reached by signature rather than by bearer token.
   *
   * `@Public()` because an <audio> element cannot attach an Authorization header — which
   * is exactly why the signed URL exists. The signature is the credential here: it names
   * one recording, expires in minutes, and cannot be edited to point elsewhere without
   * invalidating itself.
   *
   * Streaming the bytes belongs to an object store, and none is built yet, so this
   * refuses rather than pretending — with a real 501 status, not a 200 whose body says
   * 501. A player or a download treats any 200 as the audio, and would render this as a
   * silent recording or save it as a broken file.
   */
  @Get(":id/audio")
  @Public()
  audio(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("expires") expires: string,
    @Query("signature") signature: string,
  ): never {
    if (!this.recordings.verifySignature(id, Number(expires), signature ?? "")) {
      throw new ForbiddenException("This link is invalid or has expired.");
    }

    // A known gap rather than a fault, so it is logged but not sent to Sentry.
    throw logOnly(
      new NotImplementedException(
        "Recording audio is not stored by this app yet, so it cannot be played or downloaded.",
      ),
    );
  }

  @Delete(":id")
  @RequirePermissions("recordings.delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.recordings.remove(id);
  }
}
