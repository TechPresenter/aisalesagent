import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CreditsModule } from "../credits/credits.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { OperatorGuard } from "./operator.guard";

/**
 * The platform operator's console (TRD §8, /admin). AuthModule for TenantAccessService,
 * so a status change applies on the next request; CreditsModule for the ledger, so a
 * grant takes the same lock and keeps the same invariant as every other credit.
 */
@Module({
  imports: [AuthModule, CreditsModule],
  controllers: [AdminController],
  providers: [AdminService, OperatorGuard],
})
export class AdminModule {}
