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
import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { UserStatus } from "@prisma/client";
import { ROLES, type Role } from "@appsgain/shared";
import { CurrentUser, RequirePermissions } from "../auth/decorators";
import type { TenantContext } from "../prisma/tenant-prisma.provider";
import { InvitationsService } from "./invitations.service";
import { UsersService } from "./users.service";

/** The roles a person can be invited to. SUPER_ADMIN is the platform's, never a workspace's. */
const INVITABLE_ROLES = ROLES.filter((role) => role !== "SUPER_ADMIN");

class InviteMemberDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsIn(INVITABLE_ROLES)
  role!: Role;
}

class ListUsersDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.split(",").filter(Boolean) : value))
  @IsIn(ROLES, { each: true })
  role?: Role[];

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.split(",").filter(Boolean) : value))
  @IsIn(Object.values(UserStatus), { each: true })
  status?: UserStatus[];
}

class UpdateUserDto {
  @IsOptional()
  @IsIn(ROLES)
  role?: Role;

  @IsOptional()
  @IsIn(Object.values(UserStatus))
  status?: UserStatus;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
}

/**
 * TRD §8 — workspace members.
 *
 * Reading the member list is `team.view`, which every role that can assign work holds;
 * changing someone's role or access is `team.manage`, which is a different thing entirely
 * and is granted to far fewer people.
 */
@Controller("users")
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly invitations: InvitationsService,
  ) {}

  @Get()
  @RequirePermissions("team.view")
  list(@Query() query: ListUsersDto) {
    return this.users.list(query);
  }

  // Declared before the ":id" routes: Express matches in order, and "invitations" would
  // otherwise be read as a user id and fail UUID validation.

  @Get("invitations")
  @RequirePermissions("team.view")
  listInvitations() {
    return this.invitations.list();
  }

  /** Feature List §12 — invite by email with a pre-set role. */
  @Post("invitations")
  @RequirePermissions("team.manage")
  invite(@Body() dto: InviteMemberDto, @CurrentUser() actor: TenantContext) {
    return this.invitations.invite(dto, { userId: actor.userId, role: actor.role as Role });
  }

  @Post("invitations/:id/resend")
  @RequirePermissions("team.manage")
  resendInvitation(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() actor: TenantContext) {
    return this.invitations.resend(id, { userId: actor.userId, role: actor.role as Role });
  }

  @Delete("invitations/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions("team.manage")
  async revokeInvitation(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.invitations.revoke(id);
  }

  @Get(":id")
  @RequirePermissions("team.view")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.users.findOne(id);
  }

  @Patch(":id")
  @RequirePermissions("team.manage")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: TenantContext,
  ) {
    return this.users.update(id, dto, { userId: actor.userId, role: actor.role as Role });
  }

  /** Deactivation, not deletion — their calls and notes still name them. */
  @Delete(":id")
  @RequirePermissions("team.manage")
  deactivate(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() actor: TenantContext) {
    return this.users.deactivate(id, { userId: actor.userId, role: actor.role as Role });
  }
}
