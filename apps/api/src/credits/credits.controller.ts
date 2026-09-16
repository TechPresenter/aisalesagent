import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { RequirePermissions } from "../auth/decorators";
import { CreditsService } from "./credits.service";

class GrantCreditsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

class HistoryQueryDto {
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

/** Feature List §13 — Credits & Usage. */
@Controller("credits")
export class CreditsController {
  constructor(private readonly credits: CreditsService) {}

  @Get()
  @RequirePermissions("credits.view")
  wallet() {
    return this.credits.wallet();
  }

  @Get("history")
  @RequirePermissions("credits.view")
  history(@Query() query: HistoryQueryDto) {
    return this.credits.history(query.page ?? 1, query.pageSize ?? 25);
  }

  @Get("usage")
  @RequirePermissions("credits.view")
  usage() {
    return this.credits.usageByOperation();
  }

  /**
   * Reconciliation is a read, but it is `credits.manage`: it exists to investigate a
   * discrepancy, and knowing that the books do not balance is not something to hand to
   * everyone who can see a balance.
   */
  @Get("reconcile")
  @RequirePermissions("credits.manage")
  reconcile() {
    return this.credits.reconcile();
  }

  /**
   * A manual grant, for support corrections. Not a purchase — a real top-up arrives
   * through a verified payment webhook, never from a client saying it paid.
   */
  @Post("adjust")
  @RequirePermissions("credits.manage")
  @HttpCode(HttpStatus.CREATED)
  adjust(@Body() dto: GrantCreditsDto) {
    return this.credits.grant("MANUAL_ADJUSTMENT", dto.amount, { note: dto.note });
  }
}
