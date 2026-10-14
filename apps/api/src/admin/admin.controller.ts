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
  Req,
  UseGuards,
} from "@nestjs/common";
import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from "class-validator";
import { TENANT_STATUSES, type JwtAccessPayload, type TenantStatus } from "@appsgain/shared";
import type { Request } from "express";
import { sessionContext } from "../auth/auth.service";
import { AllowCrossTenant } from "../auth/decorators";
import { AdminService, type OperatorContext, type OperatorGrantOperation } from "./admin.service";
import { OperatorGuard } from "./operator.guard";

const trimmed = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

class ListTenantsQueryDto {
  @IsOptional()
  @IsIn(TENANT_STATUSES)
  status?: TenantStatus;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

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

/** Suspending or closing a workspace says why, for the audit row and whoever reads it next. */
class RequiredReasonDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

class OptionalReasonDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

const OPERATOR_GRANT_OPERATIONS: OperatorGrantOperation[] = ["MANUAL_ADJUSTMENT", "PURCHASE", "PLAN_GRANT"];

class OperatorGrantDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  amount!: number;

  /** Required: a grant nobody can explain later is the kind this console exists to prevent. */
  @Transform(trimmed)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note!: string;

  /** The payment or invoice this pays for. Optional, but a grant with one is applied once. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$/, {
    message: "reference must be 1–120 letters, digits or . _ : / # -",
  })
  reference?: string;

  @IsOptional()
  @IsIn(OPERATOR_GRANT_OPERATIONS)
  operation?: OperatorGrantOperation;
}

/**
 * TRD §8 — the /admin group: the platform operator's console, and the only routes in the
 * API that act on a workspace other than the caller's.
 *
 * Three layers keep it that way. @AllowCrossTenant lets TenantGuard accept a :tenantId
 * that is not the token's — for a SUPER_ADMIN only, writing an audit row in that
 * workspace as it does. OperatorGuard then refuses anyone who is not a SUPER_ADMIN right
 * now, by token and by database, which covers the routes that name no other workspace.
 * And AdminService refuses to act on the operator's own workspace at all.
 *
 * SUPER_ADMIN holds no workspace permissions, so none of these routes declares one; the
 * check is the role, made explicitly. Creating the first SUPER_ADMIN is not an endpoint:
 * it is scripts/create-super-admin.ts, run against the database by someone who has it.
 */
@Controller("admin")
@AllowCrossTenant()
@UseGuards(OperatorGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("tenants")
  list(@Query() query: ListTenantsQueryDto, @Req() request: Request) {
    return this.admin.listTenants(
      {
        status: query.status,
        search: query.search,
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 25,
      },
      operatorFrom(request),
    );
  }

  @Post("tenants/:tenantId/suspend")
  @HttpCode(HttpStatus.OK)
  suspend(
    @Param("tenantId", new ParseUUIDPipe()) tenantId: string,
    @Body() dto: RequiredReasonDto,
    @Req() request: Request,
  ) {
    return this.admin.suspend(tenantId, dto.reason, operatorFrom(request));
  }

  @Post("tenants/:tenantId/reactivate")
  @HttpCode(HttpStatus.OK)
  reactivate(
    @Param("tenantId", new ParseUUIDPipe()) tenantId: string,
    @Body() dto: OptionalReasonDto,
    @Req() request: Request,
  ) {
    return this.admin.reactivate(tenantId, dto.reason, operatorFrom(request));
  }

  @Post("tenants/:tenantId/cancel")
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param("tenantId", new ParseUUIDPipe()) tenantId: string,
    @Body() dto: RequiredReasonDto,
    @Req() request: Request,
  ) {
    return this.admin.cancel(tenantId, dto.reason, operatorFrom(request));
  }

  @Post("tenants/:tenantId/credits")
  @HttpCode(HttpStatus.CREATED)
  grantCredits(
    @Param("tenantId", new ParseUUIDPipe()) tenantId: string,
    @Body() dto: OperatorGrantDto,
    @Req() request: Request,
  ) {
    return this.admin.grantCredits(
      tenantId,
      { amount: dto.amount, note: dto.note, reference: dto.reference, operation: dto.operation },
      operatorFrom(request),
    );
  }
}

/** The operator, from the principal OperatorGuard has just confirmed. */
function operatorFrom(request: Request): OperatorContext {
  const user = (request as Request & { user: JwtAccessPayload }).user;
  const { ipAddress, userAgent } = sessionContext(request);
  return {
    userId: user.sub,
    email: user.email,
    tenantId: user.tenantId,
    ipAddress: ipAddress ?? null,
    userAgent: userAgent ?? null,
  };
}
