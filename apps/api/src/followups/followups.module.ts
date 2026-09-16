import { Module } from "@nestjs/common";
import { FollowUpsController } from "./followups.controller";
import { FollowUpsService } from "./followups.service";

@Module({
  controllers: [FollowUpsController],
  providers: [FollowUpsService],
  exports: [FollowUpsService],
})
export class FollowUpsModule {}
