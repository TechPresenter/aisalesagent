import { Controller, Get } from "@nestjs/common";
import { RequirePermissions } from "../auth/decorators";
import { ProvidersService } from "./providers.service";

/**
 * Settings → AI reads this to show what is connected.
 *
 * Read-only for now: writing credentials arrives with the Integrations module, and an
 * endpoint that accepted secrets before the storage path was finished would be the worst
 * possible half-feature.
 */
@Controller("providers")
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get("health")
  @RequirePermissions("integrations.view")
  async health() {
    return {
      encryptionReady: this.providers.encryptionReady(),
      providers: await this.providers.healthAll(),
    };
  }
}
