import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { Public, RequirePermissions } from "../auth/decorators";
import { ConnectIntegrationDto, IntegrationSettingsDto } from "./dto/integrations.dto";
import { appUrl } from "./events/payloads";
import { IntegrationsService } from "./integrations.service";
import { OAuthService } from "./oauth.service";

/**
 * TRD §8 — `/integrations`.
 *
 * Reading the catalogue is `integrations.view`; anything that stores, tests or removes a
 * credential is `integrations.manage`, because connecting a CRM decides where the
 * workspace's lead data goes.
 */
@Controller("integrations")
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly oauth: OAuthService,
  ) {}

  @Get()
  @RequirePermissions("integrations.view")
  overview() {
    return this.integrations.overview();
  }

  /**
   * Where a vendor sends the browser back after OAuth sign-in. Public by necessity — the
   * browser arrives from Google or Microsoft without our bearer token — and safe because
   * it trusts nothing but the signed, ten-minute state it issued itself.
   */
  @Public()
  @Get("oauth/callback")
  async oauthCallback(@Query() query: Record<string, unknown>, @Res() response: Response) {
    const outcome = await this.oauth.complete(query);
    const target = new URL(appUrl("/settings"));
    target.searchParams.set("tab", "integrations");
    if (outcome.ok) {
      target.searchParams.set("connected", outcome.provider);
    } else {
      target.searchParams.set("integration_error", outcome.message);
    }
    response.redirect(302, target.toString());
  }

  @Post(":provider/connect")
  @RequirePermissions("integrations.manage")
  connect(@Param("provider") provider: string, @Body() dto: ConnectIntegrationDto) {
    return this.integrations.connect(provider, dto);
  }

  @Post(":provider/oauth/start")
  @RequirePermissions("integrations.manage")
  startOAuth(@Param("provider") provider: string) {
    return this.integrations.startOAuth(provider);
  }

  @Patch(":provider")
  @RequirePermissions("integrations.manage")
  update(@Param("provider") provider: string, @Body() dto: IntegrationSettingsDto) {
    return this.integrations.update(provider, dto);
  }

  @Post(":provider/test")
  @RequirePermissions("integrations.manage")
  test(@Param("provider") provider: string) {
    return this.integrations.test(provider);
  }

  @Delete(":provider")
  @HttpCode(204)
  @RequirePermissions("integrations.manage")
  async disconnect(@Param("provider") provider: string): Promise<void> {
    await this.integrations.disconnect(provider);
  }
}
