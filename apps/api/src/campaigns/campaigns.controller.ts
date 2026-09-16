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
import { RequirePermissions } from "../auth/decorators";
import {
  AddCampaignLeadsDto,
  CreateCampaignDto,
  ListCampaignsDto,
  UpdateCampaignDto,
} from "./dto/campaign.dto";
import {
  CampaignsService,
  type CampaignOverview,
  type CampaignWithStats,
  type PaginatedCampaigns,
} from "./campaigns.service";

/**
 * TRD §8 — /campaigns.
 *
 * No `tenantId` parameter anywhere, as with /leads: the workspace comes from the token,
 * which is what makes these endpoints impossible to point at someone else's data.
 *
 * Status changes are their own verbs rather than a PATCH field. `POST /:id/activate`
 * says what it does and can refuse — a campaign with no agent, no script or no leads is
 * rejected with a reason, where `PATCH {status:"ACTIVE"}` would have to either accept it
 * or return a confusing error about a field the caller did set correctly.
 */
@Controller("campaigns")
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @RequirePermissions("campaigns.view")
  list(@Query() query: ListCampaignsDto): Promise<PaginatedCampaigns> {
    return this.campaigns.list(query);
  }

  /** Before `:id`, for the same routing reason as /leads/stats. */
  @Get("overview")
  @RequirePermissions("campaigns.view")
  overview(): Promise<CampaignOverview> {
    return this.campaigns.overview();
  }

  @Get(":id")
  @RequirePermissions("campaigns.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<CampaignWithStats> {
    return this.campaigns.findOne(id);
  }

  @Post()
  @RequirePermissions("campaigns.create")
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateCampaignDto): Promise<CampaignWithStats> {
    return this.campaigns.create(dto);
  }

  @Patch(":id")
  @RequirePermissions("campaigns.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
  ): Promise<CampaignWithStats> {
    return this.campaigns.update(id, dto);
  }

  /**
   * Activation is what makes a campaign able to spend credits and ring people, so it
   * needs `calling.start` rather than `campaigns.edit`. Editing a script and turning the
   * dialer on are different privileges, and a workspace should be able to grant one
   * without the other.
   */
  @Post(":id/activate")
  @RequirePermissions("campaigns.edit", "calling.start")
  @HttpCode(HttpStatus.OK)
  activate(@Param("id", ParseUUIDPipe) id: string): Promise<CampaignWithStats> {
    return this.campaigns.transition(id, "ACTIVE");
  }

  @Post(":id/pause")
  @RequirePermissions("campaigns.edit")
  @HttpCode(HttpStatus.OK)
  pause(@Param("id", ParseUUIDPipe) id: string): Promise<CampaignWithStats> {
    return this.campaigns.transition(id, "PAUSED");
  }

  @Post(":id/complete")
  @RequirePermissions("campaigns.edit")
  @HttpCode(HttpStatus.OK)
  complete(@Param("id", ParseUUIDPipe) id: string): Promise<CampaignWithStats> {
    return this.campaigns.transition(id, "COMPLETED");
  }

  @Post(":id/archive")
  @RequirePermissions("campaigns.edit")
  @HttpCode(HttpStatus.OK)
  archive(@Param("id", ParseUUIDPipe) id: string): Promise<CampaignWithStats> {
    return this.campaigns.transition(id, "ARCHIVED");
  }

  @Post(":id/duplicate")
  @RequirePermissions("campaigns.create")
  @HttpCode(HttpStatus.CREATED)
  duplicate(@Param("id", ParseUUIDPipe) id: string): Promise<CampaignWithStats> {
    return this.campaigns.duplicate(id);
  }

  @Post(":id/leads")
  @RequirePermissions("campaigns.edit", "leads.assign")
  @HttpCode(HttpStatus.OK)
  addLeads(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AddCampaignLeadsDto,
  ): Promise<{ added: number; skipped: number }> {
    return this.campaigns.addLeads(id, dto);
  }

  @Delete(":id/leads/:leadId")
  @RequirePermissions("campaigns.edit", "leads.assign")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeLead(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("leadId", ParseUUIDPipe) leadId: string,
  ): Promise<void> {
    await this.campaigns.removeLead(id, leadId);
  }

  @Delete(":id")
  @RequirePermissions("campaigns.delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.campaigns.remove(id);
  }
}
