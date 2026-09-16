import { CallOutcome as PrismaCallOutcome, CallStatus as PrismaCallStatus } from "@prisma/client";
import type {
  CallOutcome as SharedCallOutcome,
  CallStatus as SharedCallStatus,
} from "@appsgain/shared";

/**
 * Keeps the Prisma call enums and the lists in @appsgain/shared in step, the same way
 * `lead-enum-sync.ts` does for leads and `auth/role-sync.ts` does for roles.
 *
 * These drifted once: the web app carried `TALKING` where the schema has `CONNECTED`,
 * and a live call rendered a badge for a status the UI had no entry for. Adding a status
 * in one place only now fails the build here rather than at render time.
 */

const _prismaStatusesExistInShared: Record<PrismaCallStatus, SharedCallStatus> = {
  QUEUED: "QUEUED",
  DIALING: "DIALING",
  RINGING: "RINGING",
  CONNECTED: "CONNECTED",
  ON_HOLD: "ON_HOLD",
  TRANSFERRING: "TRANSFERRING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  BUSY: "BUSY",
  NO_ANSWER: "NO_ANSWER",
  VOICEMAIL: "VOICEMAIL",
  CANCELLED: "CANCELLED",
};

const _sharedStatusesExistInPrisma: Record<SharedCallStatus, PrismaCallStatus> = {
  QUEUED: PrismaCallStatus.QUEUED,
  DIALING: PrismaCallStatus.DIALING,
  RINGING: PrismaCallStatus.RINGING,
  CONNECTED: PrismaCallStatus.CONNECTED,
  ON_HOLD: PrismaCallStatus.ON_HOLD,
  TRANSFERRING: PrismaCallStatus.TRANSFERRING,
  COMPLETED: PrismaCallStatus.COMPLETED,
  FAILED: PrismaCallStatus.FAILED,
  BUSY: PrismaCallStatus.BUSY,
  NO_ANSWER: PrismaCallStatus.NO_ANSWER,
  VOICEMAIL: PrismaCallStatus.VOICEMAIL,
  CANCELLED: PrismaCallStatus.CANCELLED,
};

const _prismaOutcomesExistInShared: Record<PrismaCallOutcome, SharedCallOutcome> = {
  INTERESTED: "INTERESTED",
  FOLLOW_UP: "FOLLOW_UP",
  NOT_INTERESTED: "NOT_INTERESTED",
  NO_ANSWER: "NO_ANSWER",
  WRONG_NUMBER: "WRONG_NUMBER",
  DEMO_BOOKED: "DEMO_BOOKED",
  CALLBACK_REQUESTED: "CALLBACK_REQUESTED",
  DO_NOT_CALL: "DO_NOT_CALL",
};

const _sharedOutcomesExistInPrisma: Record<SharedCallOutcome, PrismaCallOutcome> = {
  INTERESTED: PrismaCallOutcome.INTERESTED,
  FOLLOW_UP: PrismaCallOutcome.FOLLOW_UP,
  NOT_INTERESTED: PrismaCallOutcome.NOT_INTERESTED,
  NO_ANSWER: PrismaCallOutcome.NO_ANSWER,
  WRONG_NUMBER: PrismaCallOutcome.WRONG_NUMBER,
  DEMO_BOOKED: PrismaCallOutcome.DEMO_BOOKED,
  CALLBACK_REQUESTED: PrismaCallOutcome.CALLBACK_REQUESTED,
  DO_NOT_CALL: PrismaCallOutcome.DO_NOT_CALL,
};

void _prismaStatusesExistInShared;
void _sharedStatusesExistInPrisma;
void _prismaOutcomesExistInShared;
void _sharedOutcomesExistInPrisma;
