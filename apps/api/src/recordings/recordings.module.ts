import { Module } from "@nestjs/common";
import { RecordingsController } from "./recordings.controller";
import { RECORDING_OBJECT_STORE, RecordingsRetention } from "./recordings-retention";
import { RecordingsService } from "./recordings.service";

@Module({
  controllers: [RecordingsController],
  providers: [
    RecordingsService,
    RecordingsRetention,
    // No object storage exists yet, so there is nothing to delete audio from. A storage
    // adapter is bound here when one is built; see RecordingObjectStore.
    { provide: RECORDING_OBJECT_STORE, useValue: null },
  ],
  // RecordingsRetention is exported for the background worker that schedules it.
  exports: [RecordingsService, RecordingsRetention],
})
export class RecordingsModule {}
