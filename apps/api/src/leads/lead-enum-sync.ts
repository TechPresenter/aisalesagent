import { LeadSource as PrismaLeadSource, LeadStatus as PrismaLeadStatus } from "@prisma/client";
import type { LeadSource as SharedLeadSource, LeadStatus as SharedLeadStatus } from "@appsgain/shared";

/**
 * A compile-time bridge between the Prisma lead enums and the lists in @appsgain/shared,
 * exactly as `auth/role-sync.ts` does for roles.
 *
 * This file exists because the two drifted once and nothing caught it: the schema gained
 * NEGOTIATION, INVALID and LOST, the API started returning them, and the web app crashed
 * rendering a badge for a status its own union did not contain. A runtime crash on real
 * data is a poor substitute for a build error.
 *
 * Add a status or source in one place only and `npm run typecheck` fails here until it
 * is added in both.
 */

/** Fails if Prisma gains a status @appsgain/shared does not have. */
const _prismaStatusesExistInShared: Record<PrismaLeadStatus, SharedLeadStatus> = {
  NEW: "NEW",
  CONTACTED: "CONTACTED",
  INTERESTED: "INTERESTED",
  FOLLOW_UP: "FOLLOW_UP",
  DEMO_BOOKED: "DEMO_BOOKED",
  NEGOTIATION: "NEGOTIATION",
  CONVERTED: "CONVERTED",
  NOT_INTERESTED: "NOT_INTERESTED",
  NO_ANSWER: "NO_ANSWER",
  WRONG_NUMBER: "WRONG_NUMBER",
  INVALID: "INVALID",
  LOST: "LOST",
  CLOSED: "CLOSED",
};

/** Fails if @appsgain/shared gains a status Prisma does not have. */
const _sharedStatusesExistInPrisma: Record<SharedLeadStatus, PrismaLeadStatus> = {
  NEW: PrismaLeadStatus.NEW,
  CONTACTED: PrismaLeadStatus.CONTACTED,
  INTERESTED: PrismaLeadStatus.INTERESTED,
  FOLLOW_UP: PrismaLeadStatus.FOLLOW_UP,
  DEMO_BOOKED: PrismaLeadStatus.DEMO_BOOKED,
  NEGOTIATION: PrismaLeadStatus.NEGOTIATION,
  CONVERTED: PrismaLeadStatus.CONVERTED,
  NOT_INTERESTED: PrismaLeadStatus.NOT_INTERESTED,
  NO_ANSWER: PrismaLeadStatus.NO_ANSWER,
  WRONG_NUMBER: PrismaLeadStatus.WRONG_NUMBER,
  INVALID: PrismaLeadStatus.INVALID,
  LOST: PrismaLeadStatus.LOST,
  CLOSED: PrismaLeadStatus.CLOSED,
};

const _prismaSourcesExistInShared: Record<PrismaLeadSource, SharedLeadSource> = {
  UPLOAD: "UPLOAD",
  AI_FOUND: "AI_FOUND",
  WEBSITE: "WEBSITE",
  REFERRAL: "REFERRAL",
  SOCIAL_MEDIA: "SOCIAL_MEDIA",
  IMPORT: "IMPORT",
  API: "API",
  MANUAL: "MANUAL",
};

const _sharedSourcesExistInPrisma: Record<SharedLeadSource, PrismaLeadSource> = {
  UPLOAD: PrismaLeadSource.UPLOAD,
  AI_FOUND: PrismaLeadSource.AI_FOUND,
  WEBSITE: PrismaLeadSource.WEBSITE,
  REFERRAL: PrismaLeadSource.REFERRAL,
  SOCIAL_MEDIA: PrismaLeadSource.SOCIAL_MEDIA,
  IMPORT: PrismaLeadSource.IMPORT,
  API: PrismaLeadSource.API,
  MANUAL: PrismaLeadSource.MANUAL,
};

void _prismaStatusesExistInShared;
void _sharedStatusesExistInPrisma;
void _prismaSourcesExistInShared;
void _sharedSourcesExistInPrisma;
