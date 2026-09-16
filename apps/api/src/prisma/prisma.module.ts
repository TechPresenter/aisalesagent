import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { TenantPrismaFactory } from "./tenant-prisma.provider";

/**
 * Global because practically every feature module needs one of the two, and threading
 * an import through each of them adds ceremony without adding a decision.
 */
@Global()
@Module({
  providers: [PrismaService, TenantPrismaFactory],
  exports: [PrismaService, TenantPrismaFactory],
})
export class PrismaModule {}
