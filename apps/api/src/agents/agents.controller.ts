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
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { RequirePermissions } from "../auth/decorators";
import { AgentsService } from "./agents.service";

/** Languages the calling pipeline can be asked for. Kept as a list so an unsupported
 *  locale is refused at the edge rather than discovered at dial time. */
const LANGUAGES = [
  "hi-IN",
  "en-IN",
  "en-US",
  "en-GB",
  "mr-IN",
  "gu-IN",
  "ta-IN",
  "te-IN",
  "kn-IN",
  "bn-IN",
  "pa-IN",
] as const;

class QualificationQuestionDto {
  @IsString()
  @MaxLength(64)
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  question!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  captures?: string;

  @IsBoolean()
  required!: boolean;
}

class ObjectionResponseDto {
  @IsString()
  @MaxLength(64)
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  objection!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2_000)
  response!: string;
}

class AgentBodyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string;

  @IsOptional()
  @IsIn(LANGUAGES)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  accent?: string;

  @IsOptional()
  @IsIn(["female", "male", "neutral"])
  gender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  voiceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  personality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8_000)
  systemPrompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  openingMessage?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => QualificationQuestionDto)
  @ArrayMaxSize(30)
  qualificationQuestions?: QualificationQuestionDto[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ObjectionResponseDto)
  @ArrayMaxSize(50)
  objectionHandling?: ObjectionResponseDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  closingInstructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  knowledgeBase?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class CreateAgentDto extends AgentBodyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  declare name: string;
}

class ListAgentsDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => (value === "true" ? true : value === "false" ? false : value))
  @IsBoolean()
  activeOnly?: boolean;

  @IsOptional()
  @IsIn(LANGUAGES)
  language?: string;
}

/**
 * Feature List §12 — AI Agents.
 *
 * `agents.view` reads them; `agents.manage` writes. Writing an agent's script changes what
 * the product says to a prospect on the workspace's behalf, which is why it sits with the
 * managers rather than with everyone who can place a call.
 */
@Controller("agents")
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  @RequirePermissions("agents.view")
  list(@Query() query: ListAgentsDto) {
    return this.agents.list(query);
  }

  @Get("stats")
  @RequirePermissions("agents.view")
  stats() {
    return this.agents.stats();
  }

  /** Calls and interested outcomes per agent, for Analytics. Before `:id` deliberately. */
  @Get("performance")
  @RequirePermissions("agents.view")
  performance() {
    return this.agents.performance();
  }

  @Get(":id")
  @RequirePermissions("agents.view")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.agents.findOne(id);
  }

  @Post()
  @RequirePermissions("agents.manage")
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateAgentDto) {
    return this.agents.create(dto);
  }

  @Post(":id/duplicate")
  @RequirePermissions("agents.manage")
  @HttpCode(HttpStatus.CREATED)
  duplicate(@Param("id", ParseUUIDPipe) id: string) {
    return this.agents.duplicate(id);
  }

  @Patch(":id")
  @RequirePermissions("agents.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AgentBodyDto) {
    return this.agents.update(id, dto);
  }

  @Delete(":id")
  @RequirePermissions("agents.manage")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.agents.remove(id);
  }
}

export { LANGUAGES };
