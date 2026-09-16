import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { join } from "node:path";
import { AuthModule } from "./auth/auth.module";
import { HealthController } from "./health/health.controller";
import { CampaignsModule } from "./campaigns/campaigns.module";
import { CreditsModule } from "./credits/credits.module";
import { ProvidersModule } from "./providers/providers.module";
import { CallsModule } from "./calls/calls.module";
import { CallSettingsModule } from "./call-settings/call-settings.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { TranscriptsModule } from "./transcripts/transcripts.module";
import { RecordingsModule } from "./recordings/recordings.module";
import { NotesModule } from "./notes/notes.module";
import { FollowUpsModule } from "./followups/followups.module";
import { UsersModule } from "./users/users.module";
import { CalendarModule } from "./calendar/calendar.module";
import { AgentsModule } from "./agents/agents.module";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { IntegrationsModule } from "./integrations/integrations.module";
import { LeadsModule } from "./leads/leads.module";
import { PrismaModule } from "./prisma/prisma.module";
import { WorkspaceModule } from "./workspace/workspace.module";
import { validateEnv } from "./config/env.validation";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // One .env at the repository root rather than one per app: the web app, the API and
      // the AI service all need the same database and service URLs, and keeping three
      // copies in sync by hand is how they end up pointing at different things.
      //
      // Two candidates because `__dirname` is not the same in both run modes: `nest start`
      // executes the compiled tree from apps/api/dist/src, while ts-node (jest, the seed)
      // runs from apps/api/src — one level shallower. Nest takes the first path that
      // exists, so listing both makes the API find its configuration either way instead
      // of booting into "Missing required environment variables" in exactly one of them.
      envFilePath: [
        join(__dirname, "../../../../.env"),
        join(__dirname, "../../../.env"),
      ],
      validate: validateEnv,
    }),
    PrismaModule,
    AuthModule,
    WorkspaceModule,
    LeadsModule,
    CampaignsModule,
    CreditsModule,
    ProvidersModule,
    CallsModule,
    CallSettingsModule,
    NotificationsModule,
    TranscriptsModule,
    RecordingsModule,
    NotesModule,
    FollowUpsModule,
    UsersModule,
    CalendarModule,
    AgentsModule,
    IntegrationsModule,
    ApiKeysModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

