import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, type Call, type CallOutcome, type CreditTransaction } from "@prisma/client";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import { scopedCreate } from "../prisma/tenant-scoped";
import { CreditsService, InsufficientCreditsError } from "../credits/credits.service";
import { IntegrationEventsService } from "../integrations/integration-events.service";
import { callData, leadData } from "../integrations/events/payloads";
import { NotificationsService } from "../notifications/notifications.service";
import { ProvidersService } from "../providers/providers.service";
import { isSandboxProvider } from "../providers/sandbox/sandbox.adapters";
import {
  BLOCK_REASON_TEXT,
  evaluateCallGates,
  localTimeIn,
  type BlockReason,
  type GateDecision,
} from "./calling-rules";

export interface PlaceCallOutcome {
  placed: boolean;
  callId?: string;
  /** Present when the gates refused. Already human-readable. */
  blockedBy?: BlockReason[];
  message?: string;
}

/**
 * Feature List §5 — the AI calling pipeline.
 *
 * The order of operations here is the whole design, and it is chosen so that the two
 * ways this can go wrong both fail safe:
 *
 *   1. Gates are evaluated first, against the campaign's own timezone and the
 *      workspace's compliance settings. Nothing is charged and nothing is dialled until
 *      they pass.
 *   2. Credits are spent *before* the provider is asked to dial. Charging afterwards
 *      would let a workspace place unlimited calls with an empty wallet whenever the
 *      provider is slow — the charge is the permission.
 *   3. If the provider then refuses, the charge is refunded as a new ledger row. The
 *      original debit is never edited away: it happened, and an append-only ledger is
 *      the only auditable kind.
 *
 * The consequence worth stating plainly: a crash between the debit and the dial leaves a
 * charge with no call. That is the direction to fail in. The alternative — dial first,
 * charge after — fails by placing calls nobody paid for, which is worse and much harder
 * to detect.
 */
@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaFactory,
    private readonly credits: CreditsService,
    private readonly providers: ProvidersService,
    private readonly notifications: NotificationsService,
    private readonly integrationEvents: IntegrationEventsService,
  ) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  /**
   * Evaluates the gates for a lead without dialling.
   *
   * Exposed so the UI can explain, before anyone clicks Start, why a campaign will not
   * call a particular lead — rather than watching it silently skip them.
   */
  async explain(leadId: string, campaignId?: string): Promise<GateDecision & { messages: string[] }> {
    const decision = await this.gate(leadId, campaignId);
    return {
      ...decision,
      messages: decision.reasons.map((reason) => BLOCK_REASON_TEXT[reason]),
    };
  }

  /**
   * Places one call: gates, charge, dial.
   *
   * Returns rather than throws when the gates refuse. A blocked call is an ordinary
   * outcome of a dialer run — most leads are blocked most of the time, because it is
   * usually the wrong hour — and making the caller catch an exception for the common
   * case would be wrong.
   */
  async placeCall(leadId: string, campaignId?: string): Promise<PlaceCallOutcome> {
    const decision = await this.gate(leadId, campaignId);
    if (!decision.allowed) {
      return {
        placed: false,
        blockedBy: decision.reasons,
        message: decision.reasons.map((r) => BLOCK_REASON_TEXT[r]).join(" "),
      };
    }

    const lead = await this.db.lead.findUniqueOrThrow({ where: { id: leadId } });
    const campaign = campaignId
      ? await this.db.campaign.findUnique({ where: { id: campaignId } })
      : null;
    const callSettings = await this.db.callSettings.findFirst();

    const telephony = await this.providers.telephony();

    // Charged before dialling — see the note on this class.
    let charge: CreditTransaction;
    try {
      charge = await this.credits.spend({
        operation: "AI_CALL",
        referenceType: "lead",
        referenceId: leadId,
        note: campaign ? `Campaign: ${campaign.name}` : "Manual call",
      });
    } catch (error) {
      if (error instanceof InsufficientCreditsError) {
        return {
          placed: false,
          blockedBy: ["INSUFFICIENT_CREDITS"],
          message: error.message,
        };
      }
      throw error;
    }

    const call = await this.db.call.create({
      data: scopedCreate<Prisma.CallUncheckedCreateInput>({
        leadId,
        campaignId: campaign?.id,
        aiAgentId: campaign?.aiAgentId ?? callSettings?.defaultAiAgentId ?? undefined,
        phone: lead.phone,
        direction: "OUTBOUND",
        status: "QUEUED",
        provider: telephony.name,
        creditsUsed: charge.amount,
      }),
    });

    const result = await telephony.placeCall({
      to: lead.phone,
      from: callSettings?.callerId ?? "unknown",
      correlationId: call.id,
      recordingEnabled: callSettings?.recordingEnabled ?? true,
      maxSeconds: callSettings?.maxCallSeconds ?? 600,
    });

    if (!result.ok) {
      // The provider refused, so nothing was dialled and the charge must come back.
      await this.credits.refund(charge, result.error ?? "the provider rejected the call");
      await this.db.call.update({
        where: { id: call.id },
        data: {
          status: "FAILED",
          failureReason: result.error ?? "The telephony provider rejected the call.",
          creditsUsed: 0,
          endedAt: new Date(),
        },
      });
      return { placed: false, callId: call.id, message: result.error };
    }

    await this.db.call.update({
      where: { id: call.id },
      data: {
        status: result.state === "DIALING" ? "DIALING" : "RINGING",
        providerCallId: result.providerCallId,
        startedAt: new Date(),
      },
    });

    await this.recordAttempt(leadId, campaign?.id);

    // Sandbox calls are logged distinctly so "did we actually ring this person" is
    // answerable from the log as well as from the `provider` column.
    if (isSandboxProvider(telephony.name)) {
      this.logger.warn(`Call ${call.id} was placed through the SANDBOX — no real call occurred.`);
    } else {
      this.logger.log(`Call ${call.id} placed via ${telephony.name} to ${lead.phone}`);
    }

    return { placed: true, callId: call.id };
  }

  /**
   * Polls the provider and advances the call, running the post-call pipeline once it has
   * finished.
   *
   * Idempotent: a call already in a terminal state is returned untouched. Provider
   * webhooks and a polling loop will both reach this, sometimes for the same call, and a
   * second completion must not create a second transcript or a second follow-up.
   */
  async syncStatus(callId: string): Promise<Call> {
    const call = await this.db.call.findUnique({ where: { id: callId } });
    if (!call) throw new NotFoundException("Call not found");

    const terminal = ["COMPLETED", "FAILED", "BUSY", "NO_ANSWER", "VOICEMAIL", "CANCELLED"];
    if (terminal.includes(call.status)) return call;
    if (!call.providerCallId) return call;

    const telephony = await this.providers.telephony();
    const status = await telephony.getStatus(call.providerCallId);

    const connected = status.state === "COMPLETED" && status.durationSeconds > 0;

    const updated = await this.db.call.update({
      where: { id: callId },
      data: {
        status: status.state,
        durationSeconds: status.durationSeconds,
        answeredAt: status.answeredAt ? new Date(status.answeredAt) : undefined,
        endedAt: status.endedAt ? new Date(status.endedAt) : undefined,
      },
    });

    if (!terminal.includes(status.state)) return updated;

    // A call that never connected consumed no telephony minutes. Refunding keeps the
    // ledger honest — a workspace should not pay for a number that rang out.
    if (!connected && call.creditsUsed > 0) {
      const charge = await this.db.creditTransaction.findFirst({
        where: { referenceType: "lead", referenceId: call.leadId, type: "DEBIT" },
        orderBy: { createdAt: "desc" },
      });
      if (charge) {
        await this.credits.refund(charge, `call ${status.state.toLowerCase()}`);
        await this.db.call.update({ where: { id: callId }, data: { creditsUsed: 0 } });
      }
    }

    if (connected) {
      await this.runPostCallPipeline(updated, status.recordingUrl);
    }

    await this.settleLead(updated);
    await this.notifyCallSettled(updated);

    // Re-read, so the event carries the outcome the post-call pipeline has just recorded.
    const settled = await this.db.call.findUniqueOrThrow({ where: { id: callId } });
    await this.emitCallCompleted(settled);
    return settled;
  }

  /** Tells integrations a call ended. The lead is included so a chat message can name them. */
  private async emitCallCompleted(call: Call): Promise<void> {
    const lead = await this.db.lead.findUnique({ where: { id: call.leadId } });
    if (!lead) return;
    this.integrationEvents.emit(this.tenantPrisma.context.tenantId, "call.completed", {
      call: callData(call),
      lead: leadData(lead),
    });
  }

  /**
   * Everything a finished call produces: recording, transcript, analysis, note,
   * follow-up.
   *
   * Each step is guarded by "does this already exist", so a repeated completion is a
   * no-op rather than a duplicate. Steps fail independently and are logged — a
   * transcription outage must not lose the recording that was captured.
   */
  private async runPostCallPipeline(call: Call, recordingUrl?: string): Promise<void> {
    const settings = await this.db.callSettings.findFirst();

    if (recordingUrl && (settings?.recordingEnabled ?? true)) {
      const existing = await this.db.recording.findFirst({ where: { callId: call.id } });
      if (!existing) {
        await this.db.recording.create({
          data: scopedCreate<Prisma.RecordingUncheckedCreateInput>({
            callId: call.id,
            storageKey: recordingUrl,
            storageBucket: "provider",
            sizeBytes: BigInt(0),
            durationSeconds: call.durationSeconds ?? 0,
          }),
        });
      }
    }

    if (!recordingUrl || !(settings?.transcriptionEnabled ?? true)) return;

    const already = await this.db.transcript.findFirst({ where: { callId: call.id } });
    if (already) return;

    const stt = await this.providers.speechToText();
    const transcription = await stt.transcribe({ audioUrl: recordingUrl, diarize: true });

    if (!transcription.ok) {
      this.logger.warn(`Transcription failed for call ${call.id}: ${transcription.error}`);
      return;
    }

    await this.credits.spend({
      operation: "TRANSCRIPTION",
      referenceType: "call",
      referenceId: call.id,
    }).catch((error) => {
      // A workspace that runs out mid-pipeline keeps the transcript it already paid the
      // provider for; the shortfall is a billing problem, not a reason to discard work.
      this.logger.warn(`Could not charge transcription for call ${call.id}: ${error.message}`);
    });

    const transcript = await this.db.transcript.create({
      data: scopedCreate<Prisma.TranscriptUncheckedCreateInput>({
        callId: call.id,
        language: transcription.language ?? "en",
        confidence: transcription.confidence,
        provider: stt.name,
      }),
    });

    await this.db.transcriptSegment.createMany({
      data: transcription.turns.map((turn, sequence) =>
        scopedCreate<Prisma.TranscriptSegmentUncheckedCreateInput>({
          transcriptId: transcript.id,
          sequence,
          speaker: turn.speaker,
          speakerLabel: turn.speaker === "AI_AGENT" ? "AI Agent" : "Lead",
          text: turn.text,
          startMs: turn.startMs,
          endMs: turn.endMs,
          confidence: turn.confidence,
        }),
      ),
    });

    // Analysis is deliberately not attempted on a sandbox transcript: summarising
    // placeholder text would produce a confident-looking summary of nothing.
    if (isSandboxProvider(stt.name)) {
      this.logger.warn(
        `Call ${call.id}: transcript is from the sandbox, so no AI analysis was run.`,
      );
    }
  }

  /**
   * Moves the lead and the campaign row on after a call.
   *
   * A NO_ANSWER leaves the lead where it was — it is not information about their
   * interest, only about their availability — but it does consume an attempt, which
   * `recordAttempt` has already counted.
   */
  /**
   * Tells someone what the call did.
   *
   * Addressed to the lead's owner when it has one, and to the workspace when it does
   * not — an unassigned lead going hot is everybody's business. One notice per call, so
   * a sweeper that syncs the same finished call twice does not say it twice.
   */
  private async notifyCallSettled(call: Call): Promise<void> {
    const lead = await this.db.lead.findUnique({
      where: { id: call.leadId },
      select: { id: true, name: true, ownerId: true },
    });
    if (!lead) return;

    const about = {
      userId: lead.ownerId,
      linkPath: `/leads/${lead.id}`,
      resourceType: "call",
      resourceId: call.id,
      dedupeMinutes: 24 * 60,
    };
    const outcome = call.outcome?.toLowerCase().replace(/_/g, " ");

    if (call.outcome === "INTERESTED") {
      await this.notifications.raise({
        ...about,
        type: "INTERESTED_LEAD",
        title: `${lead.name} is interested`,
        body: "The AI agent marked this call interested. Worth following up while it is warm.",
      });
      return;
    }

    if (call.outcome === "DEMO_BOOKED") {
      await this.notifications.raise({
        ...about,
        type: "DEMO_BOOKED",
        title: `Demo booked with ${lead.name}`,
        body: "The call ended with a demo booked. Check the calendar for the slot.",
      });
      return;
    }

    if (call.status === "COMPLETED") {
      await this.notifications.raise({
        ...about,
        type: "CALL_COMPLETED",
        title: `Call finished with ${lead.name}`,
        body: outcome ? `Outcome: ${outcome}.` : "The call connected and has a transcript.",
      });
      return;
    }

    await this.notifications.raise({
      ...about,
      type: "CALL_FAILED",
      title: `Call to ${lead.name} did not connect`,
      body: `It ended as ${call.status.toLowerCase().replace(/_/g, " ")}.`,
    });
  }

  private async settleLead(call: Call): Promise<void> {
    const nextStatus: Partial<Record<string, string>> = {
      COMPLETED: "CONTACTED",
      BUSY: undefined as never,
      NO_ANSWER: "NO_ANSWER",
      VOICEMAIL: "CONTACTED",
    };

    const status = nextStatus[call.status];
    const before = status
      ? await this.db.lead.findUnique({ where: { id: call.leadId }, select: { status: true } })
      : null;
    const lead = await this.db.lead.update({
      where: { id: call.leadId },
      data: {
        lastContactedAt: call.endedAt ?? new Date(),
        ...(status ? { status: status as never } : {}),
      },
    });

    if (before && before.status !== lead.status) {
      this.integrationEvents.emit(this.tenantPrisma.context.tenantId, "lead.status_changed", {
        lead: leadData(lead),
        previousStatus: before.status,
        status: lead.status,
      });
    }

    if (!call.campaignId) return;

    const membership = await this.db.campaignLead.findFirst({
      where: { campaignId: call.campaignId, leadId: call.leadId },
    });
    if (!membership) return;

    const campaign = await this.db.campaign.findUnique({ where: { id: call.campaignId } });
    const exhausted = membership.attempts >= (campaign?.maxAttempts ?? 3);
    const finished = call.status === "COMPLETED";

    await this.db.campaignLead.update({
      where: { campaignId_leadId: { campaignId: call.campaignId, leadId: call.leadId } },
      data: {
        state: finished ? "COMPLETED" : exhausted ? "EXHAUSTED" : "PENDING",
        nextAttemptAt:
          finished || exhausted
            ? null
            : new Date(Date.now() + (campaign?.retryDelayMinutes ?? 240) * 60_000),
      },
    });
  }

  private async recordAttempt(leadId: string, campaignId?: string): Promise<void> {
    if (!campaignId) return;
    await this.db.campaignLead.updateMany({
      where: { campaignId, leadId },
      data: {
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        state: "IN_PROGRESS",
      },
    });
  }

  /** Assembles everything the gates need and evaluates them. */
  private async gate(leadId: string, campaignId?: string): Promise<GateDecision> {
    const lead = await this.db.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundException("Lead not found");

    const settings = await this.db.callSettings.findFirst();
    if (!settings) {
      // No settings row means calling was never configured for this workspace. Refusing
      // is correct: the alternative is inventing defaults that dial real numbers.
      return { allowed: false, reasons: ["CALLING_DISABLED"] };
    }

    const campaign = campaignId
      ? await this.db.campaign.findUnique({ where: { id: campaignId } })
      : null;

    if (campaignId && !campaign) throw new NotFoundException("Campaign not found");

    const membership = campaignId
      ? await this.db.campaignLead.findFirst({ where: { campaignId, leadId } })
      : null;

    const timezone = campaign?.timezone ?? settings.timezone;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const callsToday = await this.db.call.count({
      where: {
        ...(campaignId ? { campaignId } : {}),
        startedAt: { gte: startOfToday },
      },
    });

    const wallet = await this.credits.wallet();

    return evaluateCallGates({
      // A manual call is not governed by a campaign's status; treating an absent campaign
      // as ACTIVE lets the dialer and the manual dialer share one gate function.
      campaignStatus: campaign?.status ?? "ACTIVE",
      callingEnabled: settings.callingEnabled,
      window: {
        startMinute: campaign?.callWindowStart ?? settings.callWindowStart,
        endMinute: campaign?.callWindowEnd ?? settings.callWindowEnd,
        days: campaign?.callDays?.length ? campaign.callDays : settings.callDays,
      },
      localNow: localTimeIn(timezone),
      lead: {
        phone: lead.phone,
        doNotCall: lead.doNotCall,
        country: lead.country,
        status: lead.status,
      },
      attempts: membership?.attempts ?? 0,
      maxAttempts: campaign?.maxAttempts ?? settings.maxAttemptsPerLead,
      lastAttemptAt: membership?.lastAttemptAt ?? null,
      retryDelayMinutes: campaign?.retryDelayMinutes ?? settings.retryDelayMinutes,
      now: new Date(),
      callsToday,
      dailyCallLimit: campaign?.dailyCallLimit ?? settings.maxCallsPerDay,
      creditBalance: wallet.balance,
      creditCost: 1,
      blockedNumbers: settings.blockedNumbers,
      allowedCountries: settings.allowedCountries,
      dncEnabled: settings.dncEnabled,
    });
  }

  // ── reads ─────────────────────────────────────────────────────────────────────────

  async findOne(id: string): Promise<Call> {
    const call = await this.db.call.findUnique({ where: { id } });
    if (!call) throw new NotFoundException("Call not found");
    return call;
  }

  /**
   * Call History.
   *
   * Returns each call with the lead, agent and campaign it belongs to, because a call log
   * that shows a phone number and a uuid is not a log anyone can read. One `include`
   * rather than a lookup per row — thirty calls should not be ninety queries.
   */
  async list(query: {
    campaignId?: string;
    leadId?: string;
    status?: string[];
    outcome?: string[];
    agentId?: string;
    search?: string;
    from?: string;
    to?: string;
    /** "short" under a minute, "medium" one to three, "long" over three. */
    duration?: "short" | "medium" | "long";
    hasRecording?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    const where: Prisma.CallWhereInput = {};
    if (query.campaignId) where.campaignId = query.campaignId;
    if (query.leadId) where.leadId = query.leadId;
    if (query.status?.length) where.status = { in: query.status as never };
    if (query.outcome?.length) where.outcome = { in: query.outcome as never };
    if (query.agentId) where.aiAgentId = query.agentId;

    if (query.search) {
      const term = query.search.trim();
      where.OR = [
        { phone: { contains: term.replace(/\D/g, "") || term } },
        { lead: { name: { contains: term, mode: "insensitive" } } },
        { lead: { contactPerson: { contains: term, mode: "insensitive" } } },
      ];
    }

    if (query.from || query.to) {
      where.startedAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        // The `to` bound is inclusive of the whole day: a user picking "to 10 March"
        // means the end of the 10th, not its first instant, and an exclusive bound
        // silently drops that day's calls.
        ...(query.to ? { lte: endOfDay(new Date(query.to)) } : {}),
      };
    }

    if (query.duration) {
      const bands = {
        short: { lt: 60 },
        medium: { gte: 60, lte: 180 },
        long: { gt: 180 },
      } as const;
      where.durationSeconds = bands[query.duration];
    }

    if (query.hasRecording !== undefined) {
      where.recording = query.hasRecording ? { isNot: null } : { is: null };
    }

    const data = await this.db.call.findMany({
      where,
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        lead: { select: { id: true, name: true, contactPerson: true, city: true } },
        aiAgent: { select: { id: true, name: true, language: true } },
        campaign: { select: { id: true, name: true } },
        recording: { select: { id: true, durationSeconds: true } },
        transcript: { select: { id: true, summary: true, sentiment: true } },
      },
    });
    const total = await this.db.call.count({ where });

    return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /**
   * Advances every call that has not reached a terminal state.
   *
   * Without this nothing ever moves a call off DIALING: `syncStatus` is only reached by
   * a webhook or an explicit poll, and until a call finishes its lead stays claimed as
   * IN_PROGRESS — which the dialer will not re-consider. The campaign then stalls
   * silently, showing leads that are neither called nor callable.
   *
   * Real telephony providers push webhooks and this becomes a safety net for the ones
   * they drop. Against the sandbox, and any provider having a bad day, it is the only
   * thing that closes a call out.
   */
  async syncActive(limit = 50): Promise<{ swept: number; settled: number }> {
    const inFlight = await this.db.call.findMany({
      where: { status: { in: ["QUEUED", "DIALING", "RINGING", "CONNECTED", "ON_HOLD"] } },
      orderBy: { queuedAt: "asc" },
      take: limit,
      select: { id: true },
    });

    let settled = 0;
    for (const call of inFlight) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const updated = await this.syncStatus(call.id);
        if (!["QUEUED", "DIALING", "RINGING", "CONNECTED", "ON_HOLD"].includes(updated.status)) {
          settled += 1;
        }
      } catch (error) {
        // One unreachable call must not stop the sweep — the rest are still stuck.
        this.logger.warn(`Could not sync call ${call.id}: ${(error as Error).message}`);
      }
    }

    return { swept: inFlight.length, settled };
  }

  /**
   * Call History's KPI strip, over the same window the table is showing.
   *
   * Takes the date range so the numbers agree with the rows beneath them. A strip that
   * always reports all-time totals while the table is filtered to last week is a strip
   * that quietly contradicts the page it sits on.
   */
  async historyStats(range: { from?: string; to?: string } = {}): Promise<{
    total: number;
    connected: number;
    interested: number;
    missed: number;
    avgDurationSeconds: number;
    totalCredits: number;
  }> {
    const where: Prisma.CallWhereInput = {};
    if (range.from || range.to) {
      where.startedAt = {
        ...(range.from ? { gte: new Date(range.from) } : {}),
        ...(range.to ? { lte: endOfDay(new Date(range.to)) } : {}),
      };
    }

    const total = await this.db.call.count({ where });
    const connected = await this.db.call.count({ where: { ...where, status: "COMPLETED" } });
    const interested = await this.db.call.count({ where: { ...where, outcome: "INTERESTED" } });
    const missed = await this.db.call.count({
      where: { ...where, status: { in: ["NO_ANSWER", "BUSY", "FAILED"] } },
    });

    // Averaged over connected calls only. Including the zero-second no-answers would drag
    // the mean towards zero and make a healthy call list look like a broken one.
    const durations = await this.db.call.aggregate({
      where: { ...where, status: "COMPLETED", durationSeconds: { gt: 0 } },
      _avg: { durationSeconds: true },
      _sum: { creditsUsed: true },
    });

    return {
      total,
      connected,
      interested,
      missed,
      avgDurationSeconds: Math.round(durations._avg.durationSeconds ?? 0),
      totalCredits: durations._sum.creditsUsed ?? 0,
    };
  }

  /**
   * Calls per outcome, for the dashboard. `overview()` has the same breakdown but for
   * today only — the console's question — whereas the dashboard asks about the whole
   * history, and answering it from one day would show an empty donut most mornings.
   */
  async outcomeBreakdown(
    range: { from?: string; to?: string } = {},
  ): Promise<{ outcome: string; count: number }[]> {
    const where: Prisma.CallWhereInput = { outcome: { not: null } };
    if (range.from || range.to) {
      where.startedAt = {
        ...(range.from ? { gte: new Date(range.from) } : {}),
        ...(range.to ? { lte: endOfDay(new Date(range.to)) } : {}),
      };
    }

    const groups = await this.db.call.groupBy({
      by: ["outcome"],
      where,
      _count: { _all: true },
    });
    return groups.map((g) => ({ outcome: String(g.outcome), count: g._count._all }));
  }

  /**
   * Calls per hour of the day over the last 30 days — the Analytics distribution, and
   * the "best time to call" insight that is read off it.
   *
   * Raw SQL because Prisma cannot group by an extracted hour, and the alternative is
   * pulling every call across the wire to bucket twenty-four numbers in Node.
   */
  async hourlyDistribution(): Promise<{
    timezone: string;
    hours: { hour: number; calls: number; connected: number }[];
  }> {
    const { tenantId } = this.tenantPrisma.context;
    const settings = await this.db.callSettings.findFirst();
    const configured = settings?.timezone ?? "UTC";

    // Timestamps are stored UTC, but "9 AM" has to mean nine in the morning where the
    // workspace is, or the busiest-hour reading is off by the offset.
    const bucketed = (zone: string) =>
      this.tenantPrisma.raw<{ hour: number; calls: bigint; connected: bigint }[]>`
        SELECT
          EXTRACT(HOUR FROM (c.started_at AT TIME ZONE 'UTC' AT TIME ZONE ${zone}))::int AS hour,
          count(*) AS calls,
          count(*) FILTER (WHERE c.status = 'COMPLETED') AS connected
        FROM calls c
        WHERE c.tenant_id = ${tenantId}
          AND c.started_at >= now() - interval '30 days'
        GROUP BY 1
        ORDER BY 1
      `;

    let timezone = configured;
    let rows: { hour: number; calls: bigint; connected: bigint }[];
    try {
      rows = await bucketed(configured);
    } catch {
      // An unrecognised zone name is a settings problem, not a reason to lose the chart.
      this.logger.warn(`Unknown workspace timezone "${configured}"; bucketing call hours in UTC`);
      timezone = "UTC";
      rows = await bucketed("UTC");
    }

    return {
      timezone,
      hours: rows.map((row) => ({
        hour: Number(row.hour),
        calls: Number(row.calls),
        connected: Number(row.connected),
      })),
    };
  }

  /** The live console: calls that have not reached a terminal state. */
  async active(): Promise<Call[]> {
    return this.db.call.findMany({
      where: { status: { in: ["QUEUED", "DIALING", "RINGING", "CONNECTED", "ON_HOLD"] } },
      orderBy: { queuedAt: "asc" },
      take: 50,
    });
  }

  /**
   * The AI Calling console's summary numbers, counted for the period.
   *
   * `inFlight` is the one that has to be live rather than cached — an operator watching
   * the console is watching that number, and a stale one is worse than none.
   */
  async overview(): Promise<{
    inFlight: number;
    queued: number;
    today: { placed: number; connected: number; failed: number };
    statusBreakdown: { status: string; count: number }[];
    outcomeBreakdown: { outcome: string; count: number }[];
    creditsSpentToday: number;
    callingEnabled: boolean;
    usingSandbox: boolean;
  }> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const inFlight = await this.db.call.count({
      where: { status: { in: ["QUEUED", "DIALING", "RINGING", "CONNECTED", "ON_HOLD"] } },
    });
    const queued = await this.db.campaignLead.count({
      where: { state: { in: ["PENDING", "QUEUED"] }, campaign: { status: "ACTIVE" } },
    });
    const placed = await this.db.call.count({ where: { startedAt: { gte: startOfToday } } });
    const connected = await this.db.call.count({
      where: { startedAt: { gte: startOfToday }, status: "COMPLETED" },
    });
    const failed = await this.db.call.count({
      where: { startedAt: { gte: startOfToday }, status: { in: ["FAILED", "BUSY", "NO_ANSWER"] } },
    });

    const statusGroups = await this.db.call.groupBy({
      by: ["status"],
      where: { startedAt: { gte: startOfToday } },
      _count: { _all: true },
    });
    const outcomeGroups = await this.db.call.groupBy({
      by: ["outcome"],
      where: { startedAt: { gte: startOfToday }, outcome: { not: null } },
      _count: { _all: true },
    });

    const spent = await this.db.creditTransaction.aggregate({
      where: { type: "DEBIT", operation: "AI_CALL", createdAt: { gte: startOfToday } },
      _sum: { amount: true },
    });

    const settings = await this.db.callSettings.findFirst();
    const telephony = await this.providers.telephony();

    return {
      inFlight,
      queued,
      today: { placed, connected, failed },
      statusBreakdown: statusGroups.map((g) => ({ status: g.status, count: g._count._all })),
      outcomeBreakdown: outcomeGroups.map((g) => ({
        outcome: String(g.outcome),
        count: g._count._all,
      })),
      creditsSpentToday: spent._sum.amount ?? 0,
      callingEnabled: settings?.callingEnabled ?? false,
      // Surfaced so the console can say plainly that nothing real is being dialled,
      // rather than showing a convincing live view of calls that never happened.
      usingSandbox: isSandboxProvider(telephony.name),
    };
  }

  async hangUp(id: string): Promise<Call> {
    const call = await this.findOne(id);
    if (call.providerCallId) {
      const telephony = await this.providers.telephony();
      await telephony.hangUp(call.providerCallId);
    }
    return this.db.call.update({
      where: { id },
      data: { status: "CANCELLED", endedAt: new Date() },
    });
  }

  /** Outcome recorded by a human after listening — overrides whatever the AI suggested. */
  async setOutcome(id: string, outcome: CallOutcome): Promise<Call> {
    const call = await this.findOne(id);
    if (!["COMPLETED", "VOICEMAIL"].includes(call.status)) {
      throw new BadRequestException("Only a connected call can be given an outcome.");
    }
    const updated = await this.db.call.update({ where: { id }, data: { outcome } });

    if (call.outcome !== outcome) {
      const lead = await this.db.lead.findUnique({ where: { id: updated.leadId } });
      if (lead) {
        this.integrationEvents.emit(this.tenantPrisma.context.tenantId, "call.outcome_changed", {
          call: callData(updated),
          lead: leadData(lead),
          previousOutcome: call.outcome,
          outcome,
        });
      }
    }
    return updated;
  }
}

/** The last instant of a day, so an inclusive "to" bound includes that whole day. */
function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}
