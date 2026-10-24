import { Module } from "@nestjs/common";
import { IntegrationsModule } from "../integrations/integrations.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { CreditLedger } from "./credit-ledger";
import { CreditsController } from "./credits.controller";
import { CreditsService } from "./credits.service";

@Module({
  imports: [NotificationsModule, IntegrationsModule],
  controllers: [CreditsController],
  providers: [CreditsService, CreditLedger],
  // CreditLedger for the operator console, which grants to a workspace it is not in.
  exports: [CreditsService, CreditLedger],
})
export class CreditsModule {}
