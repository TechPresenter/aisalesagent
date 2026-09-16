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
import type { Lead } from "@prisma/client";
import { RequirePermissions } from "../auth/decorators";
import {
  CreateLeadDto,
  ImportLeadsDto,
  ListLeadsDto,
  UpdateLeadDto,
} from "./dto/lead.dto";
import {
  LeadsService,
  type ImportSummary,
  type LeadActivityEntry,
  type LeadStats,
  type PaginatedLeads,
} from "./leads.service";

/**
 * TRD §8 — `CRUD /leads, POST /leads/import`.
 *
 * No @Public() anywhere in this file, so every route here is authenticated and
 * tenant-scoped by the global guards. There is also no `tenantId` parameter on any
 * route — the workspace comes from the token, which is what makes these endpoints
 * impossible to point at someone else's data.
 */
@Controller("leads")
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @RequirePermissions("leads.view")
  list(@Query() query: ListLeadsDto): Promise<PaginatedLeads> {
    return this.leads.list(query);
  }

  /** Declared before `:id` — Nest matches in order, and "stats" is a valid uuid-shaped
   *  path segment as far as the router is concerned until ParseUUIDPipe rejects it. */
  @Get("stats")
  @RequirePermissions("leads.view")
  stats(): Promise<LeadStats> {
    return this.leads.stats();
  }

  /** Leads per source — the dashboard's donut. Declared before `:id` for the same reason. */
  @Get("sources")
  @RequirePermissions("leads.view")
  sources(): Promise<{ source: string; count: number }[]> {
    return this.leads.sourceBreakdown();
  }

  /** Leads per status — the Analytics funnel. */
  @Get("statuses")
  @RequirePermissions("leads.view")
  statuses(): Promise<{ status: string; count: number }[]> {
    return this.leads.statusBreakdown();
  }

  /** The busiest cities, with the interested and converted counts inside each. */
  @Get("cities")
  @RequirePermissions("leads.view")
  cities(): Promise<{ city: string; leads: number; interested: number; converted: number }[]> {
    return this.leads.cityBreakdown();
  }

  @Get(":id")
  @RequirePermissions("leads.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<Lead> {
    return this.leads.findOne(id);
  }

  /** The lead's timeline. Same permission as viewing the lead: it is the lead's history,
   *  not a separate resource. */
  @Get(":id/activity")
  @RequirePermissions("leads.view")
  activity(@Param("id", ParseUUIDPipe) id: string): Promise<LeadActivityEntry[]> {
    return this.leads.activity(id);
  }

  @Post()
  @RequirePermissions("leads.create")
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateLeadDto): Promise<Lead> {
    return this.leads.create(dto);
  }

  @Patch(":id")
  @RequirePermissions("leads.edit")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateLeadDto): Promise<Lead> {
    return this.leads.update(id, dto);
  }

  /** Bulk import can add thousands of call targets, so it is its own permission rather
   *  than riding on leads.create. */
  @Post("import")
  @RequirePermissions("leads.import")
  @HttpCode(HttpStatus.OK)
  import(@Body() dto: ImportLeadsDto): Promise<ImportSummary> {
    return this.leads.import(dto);
  }

  @Delete(":id")
  @RequirePermissions("leads.delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.leads.remove(id);
  }
}
