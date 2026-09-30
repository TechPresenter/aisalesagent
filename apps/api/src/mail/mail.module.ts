import { Module } from "@nestjs/common";
import { MailService } from "./mail.service";

/** The platform's own email transport. See MailService. */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
