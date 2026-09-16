import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from "@nestjs/common";
import type { CreateWorkspaceResponse, TenantSummary } from "@appsgain/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CurrentUser, Public, RequirePermissions } from "../auth/decorators";
import type { TenantContext } from "../prisma/tenant-prisma.provider";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";
import { UpdateWorkspaceDto } from "./dto/update-workspace.dto";
import { WorkspaceService, toTenantSummary } from "./workspace.service";

@Controller("workspace")
export class WorkspaceController {
  constructor(
    private readonly workspace: WorkspaceService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Public by necessity — this is signup, so there is no account to authenticate with
   * yet. It is also the only public write in the API, which makes it the one route that
   * will need rate limiting before this ships anywhere public.
   */
  @Public()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateWorkspaceDto): Promise<CreateWorkspaceResponse> {
    return this.workspace.createWorkspace(dto);
  }

  /**
   * The caller's own workspace. Reads the id from the token's tenant context, never from
   * a parameter, so there is no id here for a caller to substitute.
   */
  @Get()
  async findMine(@CurrentUser() user: TenantContext): Promise<TenantSummary> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: user.tenantId },
    });
    return toTenantSummary(tenant);
  }

  /**
   * Renames the workspace or changes its industry. `settings.manage`, which is where the
   * rest of the workspace-wide settings live.
   */
  @Patch()
  @RequirePermissions("settings.manage")
  update(
    @Body() dto: UpdateWorkspaceDto,
    @CurrentUser() user: TenantContext,
  ): Promise<TenantSummary> {
    return this.workspace.updateWorkspace(user.tenantId, dto);
  }
}
