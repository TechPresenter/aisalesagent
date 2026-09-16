import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { RequirePermissions } from "../auth/decorators";
import { ApiKeysService } from "./api-keys.service";
import { CreateApiKeyDto } from "./dto/api-key.dto";

/**
 * `apikeys.manage` throughout. An API key can never carry that permission itself (it is not
 * in API_KEY_SCOPES), so a key cannot mint, list or revoke keys.
 */
@Controller("api-keys")
@RequirePermissions("apikeys.manage")
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  list() {
    return this.apiKeys.list();
  }

  @Post()
  create(@Body() dto: CreateApiKeyDto) {
    return this.apiKeys.create(dto);
  }

  @Delete(":id")
  @HttpCode(204)
  async revoke(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.apiKeys.revoke(id);
  }
}
