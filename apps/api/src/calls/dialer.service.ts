import { Injectable, Logger } from "@nestjs/common";
import type { BlockReason } from "./calling-rules";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import { CallsService } from "./calls.service";

export interface DialerRunSummary {
  campaignId: string;
  campaignName: string;
  considered: number;
  placed: number;
  blocked: number;
  /** How many leads each reason stopped, most common first. */
  blockedBy: { reason: BlockReason; count: number }[];
  /** True when the run stopped early because the workspace ran out of credits. */
  haltedForCredits: boolean;
}

/** How many leads one pass will attempt. Keeps a run bounded and interruptible. */
const BATCH_SIZE = 25;

/**
 * The outbound dialer: one pass over a campaign's due leads.
 *
 * Deliberately a **pull-based batch**, invoked by a scheduler or an operator, rather than
 * a long-running loop that dials continuously. Three reasons, and the third is the one
 * that matters:
 *
 *   1. A batch is interruptible. Pausing a campaign takes effect at the next pass rather
 *      than requiring a running loop to notice.
 *   2. A batch is observable. Each run returns exactly what it did and why it skipped
 *      what it skipped, which is what makes "why did nobody get called today" answerable.
 *   3. A crashed loop is indistinguishable from a quiet one. A batch that stops running
 *      shows up as a missing run; a loop that dies silently just... stops calling, and
 *      nobody finds out until a salesperson asks.
 *
 * Every dial still goes through `CallsService.placeCall`, so the compliance gates and the
 * credit charge apply identically whether a call came from here or from someone clicking
 * Call in the UI. There is no second path.
 */
@Injectable()
export class DialerService {
  private readonly logger = new Logger(DialerService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaFactory,
    private readonly calls: CallsService,
  ) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  /**
   * Runs one pass over every active campaign in the workspace.
   *
   * Sequential across campaigns rather than parallel: they share one credit wallet and
   * one provider account, so running them at once would race for both and make the
   * "which campaign spent the last credit" question unanswerable.
   */
  async runAll(): Promise<DialerRunSummary[]> {
    const active = await this.db.campaign.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    });

    const summaries: DialerRunSummary[] = [];
    for (const campaign of active) {
      // eslint-disable-next-line no-await-in-loop
      const summary = await this.runCampaign(campaign.id);
      summaries.push(summary);

      // An empty wallet stops the whole pass, not just this campaign — the next one
      // would fail on every lead and produce a run summary full of noise.
      if (summary.haltedForCredits) {
        this.logger.warn("Dialer pass halted: the workspace has run out of credits.");
        break;
      }
    }

    return summaries;
  }

  async runCampaign(campaignId: string): Promise<DialerRunSummary> {
    const campaign = await this.db.campaign.findUniqueOrThrow({ where: { id: campaignId } });

    const summary: DialerRunSummary = {
      campaignId,
      campaignName: campaign.name,
      considered: 0,
      placed: 0,
      blocked: 0,
      blockedBy: [],
      haltedForCredits: false,
    };

    if (campaign.status !== "ACTIVE") return summary;

    // Settle whatever the last pass left in flight before claiming more. A dialer that
    // only ever claims will run a campaign into the ground: every lead ends up
    // IN_PROGRESS, nothing is due, and the campaign stalls with no error anywhere.
    await this.calls.syncActive();
    await this.releaseStaleClaims(campaignId);

    const due = await this.claimDueLeads(campaignId, BATCH_SIZE);
    summary.considered = due.length;

    const reasonCounts = new Map<BlockReason, number>();

    for (const membership of due) {
      // Sequential on purpose. Parallel dialling would let several calls pass the credit
      // gate against the same balance before any of them had charged it — the wallet's
      // row lock makes the *charge* safe, but the daily limit and the concurrency the
      // provider will accept are not protected by it.
      // eslint-disable-next-line no-await-in-loop
      const outcome = await this.calls.placeCall(membership.leadId, campaignId);

      if (outcome.placed) {
        summary.placed += 1;
        continue;
      }

      summary.blocked += 1;
      for (const reason of outcome.blockedBy ?? []) {
        reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
      }

      // Releasing the claim so the next pass reconsiders this lead. A blocked lead is
      // usually blocked for a reason that expires — the wrong hour, the retry delay —
      // and leaving it claimed would take it out of the campaign permanently.
      // eslint-disable-next-line no-await-in-loop
      await this.releaseClaim(campaignId, membership.leadId, outcome.blockedBy ?? []);

      if (outcome.blockedBy?.includes("INSUFFICIENT_CREDITS")) {
        summary.haltedForCredits = true;
        break;
      }

      // These three are properties of the campaign or the clock, not of the lead, so
      // every remaining lead in the batch would fail identically. Stopping saves the
      // round trips and keeps the summary readable.
      const campaignWide: BlockReason[] = [
        "OUTSIDE_CALLING_WINDOW",
        "DAY_NOT_ALLOWED",
        "DAILY_LIMIT_REACHED",
        "CALLING_DISABLED",
        "CAMPAIGN_NOT_ACTIVE",
      ];
      if (outcome.blockedBy?.some((reason) => campaignWide.includes(reason))) {
        break;
      }
    }

    summary.blockedBy = [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    this.logger.log(
      `Dialer: ${campaign.name} — considered ${summary.considered}, placed ${summary.placed}, ` +
        `blocked ${summary.blocked}`,
    );

    return summary;
  }

  /**
   * Takes the next due leads and marks them IN_PROGRESS in one statement.
   *
   * The claim is what stops two dialer passes — a scheduled one and an operator clicking
   * Run — from dialling the same lead twice. `updateMany` with the state as part of the
   * `where` makes the read and the claim a single atomic operation: whichever pass gets
   * there first flips the rows, and the second finds nothing left to take.
   *
   * Selecting ids first and updating them is the tempting alternative and is wrong; the
   * gap between the two is exactly where the double-dial lives.
   */
  private async claimDueLeads(campaignId: string, limit: number) {
    const now = new Date();

    const candidates = await this.db.campaignLead.findMany({
      where: {
        campaignId,
        state: { in: ["PENDING", "QUEUED"] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      orderBy: [{ nextAttemptAt: "asc" }, { addedAt: "asc" }],
      take: limit,
      select: { leadId: true },
    });

    if (candidates.length === 0) return [];

    const leadIds = candidates.map((c) => c.leadId);

    const claimed = await this.db.campaignLead.updateMany({
      where: {
        campaignId,
        leadId: { in: leadIds },
        // Still the guard: if another pass claimed these between the read and here, the
        // state no longer matches and this updates fewer rows — or none.
        state: { in: ["PENDING", "QUEUED"] },
      },
      data: { state: "IN_PROGRESS" },
    });

    if (claimed.count === 0) return [];

    return this.db.campaignLead.findMany({
      where: { campaignId, leadId: { in: leadIds }, state: "IN_PROGRESS" },
      select: { leadId: true, attempts: true },
    });
  }

  /**
   * Puts a blocked lead back in the queue, or retires it.
   *
   * A lead blocked by something permanent — on the do-not-call list, closed, an
   * undialable number — is set to SKIPPED so the dialer stops reconsidering it every
   * pass. Anything else returns to PENDING, because the block was about timing.
   */
  private async releaseClaim(
    campaignId: string,
    leadId: string,
    reasons: BlockReason[],
  ): Promise<void> {
    const permanent: BlockReason[] = [
      "DO_NOT_CALL",
      "LEAD_ALREADY_CLOSED",
      "INVALID_PHONE",
      "NUMBER_BLOCKED",
      "COUNTRY_NOT_ALLOWED",
    ];

    const isPermanent = reasons.some((reason) => permanent.includes(reason));
    const isExhausted = reasons.includes("MAX_ATTEMPTS_REACHED");

    await this.db.campaignLead.updateMany({
      where: { campaignId, leadId },
      data: {
        state: isPermanent ? "SKIPPED" : isExhausted ? "EXHAUSTED" : "PENDING",
      },
    });
  }

  /**
   * Releases leads left claimed by a pass that never finished.
   *
   * A crash between the claim and the dial — or a call that finished without anything
   * settling its lead — leaves a row IN_PROGRESS with no live call behind it. Nothing
   * else will ever free it, so the lead silently drops out of the campaign.
   *
   * A claim is stale when the lead has no call that is still in flight. Checked by
   * absence rather than by a timeout, so a genuinely long call is never yanked out from
   * under itself.
   */
  private async releaseStaleClaims(campaignId: string): Promise<void> {
    const claimed = await this.db.campaignLead.findMany({
      where: { campaignId, state: "IN_PROGRESS" },
      select: { leadId: true, attempts: true },
    });
    if (claimed.length === 0) return;

    const live = await this.db.call.findMany({
      where: {
        campaignId,
        leadId: { in: claimed.map((c) => c.leadId) },
        status: { in: ["QUEUED", "DIALING", "RINGING", "CONNECTED", "ON_HOLD"] },
      },
      select: { leadId: true },
    });
    const liveLeadIds = new Set(live.map((c) => c.leadId));

    const campaign = await this.db.campaign.findUniqueOrThrow({ where: { id: campaignId } });

    for (const membership of claimed) {
      if (liveLeadIds.has(membership.leadId)) continue;

      // Whether it goes back in the queue depends on whether it has attempts left; a
      // lead that has used them all is exhausted, not pending.
      const exhausted = membership.attempts >= campaign.maxAttempts;

      // eslint-disable-next-line no-await-in-loop
      await this.db.campaignLead.updateMany({
        where: { campaignId, leadId: membership.leadId, state: "IN_PROGRESS" },
        data: {
          state: exhausted ? "EXHAUSTED" : "PENDING",
          nextAttemptAt: exhausted
            ? null
            : new Date(Date.now() + campaign.retryDelayMinutes * 60_000),
        },
      });
    }

    this.logger.log(
      `Dialer: released ${claimed.length - liveLeadIds.size} stale claim(s) on ${campaign.name}`,
    );
  }

  /**
   * What a campaign would do on its next pass, without dialling.
   *
   * The Start button should be able to say "this will call 12 leads, and skip 40 because
   * it is outside calling hours" before anyone commits to it.
   */
  async preview(campaignId: string): Promise<{
    due: number;
    pending: number;
    exhausted: number;
    skipped: number;
    completed: number;
  }> {
    const now = new Date();

    const [due, pending, exhausted, skipped, completed] = [
      await this.db.campaignLead.count({
        where: {
          campaignId,
          state: { in: ["PENDING", "QUEUED"] },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
      }),
      await this.db.campaignLead.count({ where: { campaignId, state: "PENDING" } }),
      await this.db.campaignLead.count({ where: { campaignId, state: "EXHAUSTED" } }),
      await this.db.campaignLead.count({ where: { campaignId, state: "SKIPPED" } }),
      await this.db.campaignLead.count({ where: { campaignId, state: "COMPLETED" } }),
    ];

    return { due, pending, exhausted, skipped, completed };
  }
}
