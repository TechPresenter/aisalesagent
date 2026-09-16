import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { CreditOperation, Prisma, type CreditTransaction } from "@prisma/client";
import { IntegrationEventsService } from "../integrations/integration-events.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";

/**
 * Raised when a workspace cannot afford an operation.
 *
 * Its own class rather than a bare BadRequestException so the dialer can catch exactly
 * this and stop a campaign, without also swallowing a validation error that happens to
 * look similar.
 */
export class InsufficientCreditsError extends BadRequestException {
  constructor(
    readonly required: number,
    readonly available: number,
  ) {
    super(
      `Not enough credits: ${required} needed, ${available} available. ` +
        `Top up in Settings → Credits.`,
    );
  }
}

/** What each metered operation costs. One table, so pricing cannot drift per caller. */
export const OPERATION_COST: Partial<Record<CreditOperation, number>> = {
  AI_CALL: 1,
  TRANSCRIPTION: 1,
  AI_ANALYSIS: 1,
  AI_LEAD_SEARCH: 5,
  AI_ENRICHMENT: 2,
  WHATSAPP_MESSAGE: 1,
  EMAIL_SEND: 1,
};

export interface SpendRequest {
  operation: CreditOperation;
  /** Overrides the table — a call charges per minute, so its cost is known at the end. */
  amount?: number;
  referenceType?: string;
  referenceId?: string;
  note?: string;
}

export interface WalletState {
  balance: number;
  lowBalanceThreshold: number | null;
  isLow: boolean;
}

/**
 * Feature List §13 — the credit ledger.
 *
 * The rule this service exists to enforce: **the wallet balance is a cache, the ledger is
 * the truth.** Every movement writes a `CreditTransaction` recording the balance before
 * and after, inside the same transaction that updates the wallet. A balance can therefore
 * always be rebuilt from its history, and a discrepancy between the two is detectable
 * rather than invisible.
 *
 * The part that actually matters is the row lock. Two concurrent calls that both read a
 * balance of 1 would both conclude they can afford a call, and the workspace would spend
 * credits it does not have — a bug that only appears under load, which is exactly when
 * nobody is watching. `SELECT … FOR UPDATE` serialises them: the second waits for the
 * first to commit, then reads the balance the first left behind and correctly refuses.
 */
@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaFactory,
    private readonly notifications: NotificationsService,
    private readonly integrationEvents: IntegrationEventsService,
  ) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  async wallet(): Promise<WalletState> {
    const { tenantId } = this.tenantPrisma.context;
    const wallet = await this.ensureWallet(tenantId);
    return {
      balance: wallet.balance,
      lowBalanceThreshold: wallet.lowBalanceThreshold,
      isLow:
        wallet.lowBalanceThreshold !== null && wallet.balance <= wallet.lowBalanceThreshold,
    };
  }

  /**
   * Whether an operation is affordable, without committing to it.
   *
   * Advisory only, and deliberately so: the answer is stale the moment it returns. It is
   * for disabling a button and warning before a campaign starts — never for gating the
   * spend itself, which `spend()` does under a lock.
   */
  async canAfford(operation: CreditOperation, amount?: number): Promise<boolean> {
    const cost = amount ?? OPERATION_COST[operation] ?? 0;
    const { balance } = await this.wallet();
    return balance >= cost;
  }

  /**
   * Debits the wallet and writes the ledger entry, atomically.
   *
   * Throws InsufficientCreditsError rather than allowing a negative balance. A workspace
   * that has run out should stop, loudly, not quietly go into debt — the alternative is
   * discovering at the end of the month that the dialer kept calling for free.
   */
  async spend(request: SpendRequest): Promise<CreditTransaction> {
    const { tenantId, userId } = this.tenantPrisma.context;
    const amount = request.amount ?? OPERATION_COST[request.operation] ?? 0;

    if (amount < 0) {
      // A negative debit is a credit wearing a disguise, and would bypass every check
      // that makes `topUp` auditable.
      throw new BadRequestException("A debit amount cannot be negative.");
    }
    if (amount === 0) {
      throw new BadRequestException(`No price is configured for ${request.operation}.`);
    }

    await this.ensureWallet(tenantId);

    const charge = await this.prisma.$transaction(async (tx) => {
      // The lock. Everything below runs while no other transaction can read this row,
      // which is what makes the read-decide-write sequence safe.
      const [locked] = await tx.$queryRaw<{ id: string; balance: number }[]>`
        SELECT id, balance FROM credit_wallets WHERE tenant_id = ${tenantId} FOR UPDATE
      `;

      if (!locked) {
        throw new BadRequestException("This workspace has no credit wallet.");
      }

      if (locked.balance < amount) {
        throw new InsufficientCreditsError(amount, locked.balance);
      }

      const balanceAfter = locked.balance - amount;

      await tx.creditWallet.update({
        where: { id: locked.id },
        data: { balance: balanceAfter },
      });

      return tx.creditTransaction.create({
        data: {
          tenantId,
          type: "DEBIT",
          operation: request.operation,
          amount,
          balanceBefore: locked.balance,
          balanceAfter,
          referenceType: request.referenceType,
          referenceId: request.referenceId,
          actorId: request.operation === "MANUAL_ADJUSTMENT" ? userId : undefined,
          note: request.note,
        },
      });
    });

    // Raised after the commit: warning about a balance that was never written would be
    // worse than not warning at all.
    await this.warnIfBalanceLow(charge);

    return charge;
  }

  /**
   * Tells the workspace once when the wallet crosses its own low-balance line, and again
   * when it is empty. Deduplicated over twelve hours so a busy dialer does not repeat it
   * on every call.
   */
  private async warnIfBalanceLow(charge: CreditTransaction): Promise<void> {
    const wallet = await this.db.creditWallet.findFirst();
    const resource = { resourceType: "wallet", resourceId: wallet?.id ?? "wallet", dedupeMinutes: 720 };

    const threshold = wallet?.lowBalanceThreshold ?? null;
    const { tenantId } = this.tenantPrisma.context;

    if (charge.balanceAfter <= 0) {
      await this.notifications.raise({
        ...resource,
        type: "CREDITS_EXHAUSTED",
        title: "Credits exhausted",
        body: "Calls will be refused until the wallet is topped up.",
        linkPath: "/settings",
      });
      // Integrations hear about the crossing, not every charge after it: the notice above
      // is de-duplicated by time, and a Slack channel deserves the same courtesy.
      if (charge.balanceBefore > 0) {
        this.integrationEvents.emit(tenantId, "credits.low_balance", {
          balance: charge.balanceAfter,
          threshold,
          exhausted: true,
        });
      }
      return;
    }

    if (threshold !== null && charge.balanceAfter <= threshold) {
      await this.notifications.raise({
        ...resource,
        type: "CREDITS_LOW",
        title: "Credits running low",
        body: `${charge.balanceAfter} credits left, below the ${threshold} warning level.`,
        linkPath: "/settings",
      });
      if (charge.balanceBefore > threshold) {
        this.integrationEvents.emit(tenantId, "credits.low_balance", {
          balance: charge.balanceAfter,
          threshold,
          exhausted: false,
        });
      }
    }
  }

  /**
   * Credits the wallet — a purchase, a plan grant, or a refund of a charge that should
   * not have happened.
   *
   * Also locked. A top-up racing a spend would otherwise read a stale balance and write
   * back a total that silently discards the other transaction's effect.
   */
  async grant(
    operation: Extract<CreditOperation, "PURCHASE" | "PLAN_GRANT" | "MANUAL_ADJUSTMENT" | "REFUND">,
    amount: number,
    options: { referenceType?: string; referenceId?: string; note?: string } = {},
  ): Promise<CreditTransaction> {
    const { tenantId, userId } = this.tenantPrisma.context;

    if (amount <= 0) {
      throw new BadRequestException("A credit amount must be positive.");
    }

    await this.ensureWallet(tenantId);

    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string; balance: number }[]>`
        SELECT id, balance FROM credit_wallets WHERE tenant_id = ${tenantId} FOR UPDATE
      `;

      if (!locked) throw new BadRequestException("This workspace has no credit wallet.");

      const balanceAfter = locked.balance + amount;

      await tx.creditWallet.update({
        where: { id: locked.id },
        // Clearing the notification stamp on the way up so a workspace that tops up and
        // later falls low again is warned a second time.
        data: { balance: balanceAfter, lowBalanceNotifiedAt: null },
      });

      return tx.creditTransaction.create({
        data: {
          tenantId,
          type: "CREDIT",
          operation,
          amount,
          balanceBefore: locked.balance,
          balanceAfter,
          referenceType: options.referenceType,
          referenceId: options.referenceId,
          actorId: userId,
          note: options.note,
        },
      });
    });
  }

  /**
   * Returns credits for work that was charged and then failed.
   *
   * A refund is a new ledger row, never an edit or a delete of the original. The charge
   * happened; pretending otherwise loses the fact that it did, and an append-only ledger
   * is the only kind that can be audited.
   */
  async refund(original: CreditTransaction, reason: string): Promise<CreditTransaction> {
    return this.grant("REFUND", original.amount, {
      referenceType: original.referenceType ?? undefined,
      referenceId: original.referenceId ?? undefined,
      note: `Refund: ${reason}`,
    });
  }

  async history(page = 1, pageSize = 25) {
    const rows = await this.db.creditTransaction.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const total = await this.db.creditTransaction.count();
    return { data: rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /**
   * Usage grouped by operation, for the Credits screen.
   *
   * Debits only: a top-up is not consumption, and including it would make the chart say
   * a workspace "used" the credits it just bought.
   */
  async usageByOperation(sinceDays = 30) {
    const since = new Date();
    since.setDate(since.getDate() - sinceDays);

    const groups = await this.db.creditTransaction.groupBy({
      by: ["operation"],
      where: { type: "DEBIT", createdAt: { gte: since } },
      _sum: { amount: true },
    });

    return groups
      .map((group) => ({ operation: group.operation, credits: group._sum.amount ?? 0 }))
      .sort((a, b) => b.credits - a.credits);
  }

  /**
   * Rebuilds the wallet balance from the ledger and reports any drift.
   *
   * The whole point of recording balanceBefore/After on every row is that this check is
   * possible. Exposed to platform administration rather than run automatically: a
   * mismatch means something wrote the wallet outside this service, and that should be
   * investigated, not silently corrected.
   */
  async reconcile(): Promise<{ walletBalance: number; ledgerBalance: number; drift: number }> {
    const { tenantId } = this.tenantPrisma.context;

    const wallet = await this.ensureWallet(tenantId);
    const sums = await this.db.creditTransaction.groupBy({
      by: ["type"],
      _sum: { amount: true },
    });

    const credited = sums.find((s) => s.type === "CREDIT")?._sum.amount ?? 0;
    const debited = sums.find((s) => s.type === "DEBIT")?._sum.amount ?? 0;
    const ledgerBalance = credited - debited;

    const drift = wallet.balance - ledgerBalance;
    if (drift !== 0) {
      this.logger.error(
        `Credit drift for tenant ${tenantId}: wallet=${wallet.balance} ledger=${ledgerBalance}`,
      );
    }

    return { walletBalance: wallet.balance, ledgerBalance, drift };
  }

  /**
   * A workspace created before this service existed has no wallet row. Created lazily at
   * zero rather than as part of tenant creation, so the ledger invariant holds from the
   * first entry: a wallet's balance is the sum of its ledger, and an empty ledger sums
   * to zero.
   */
  private async ensureWallet(tenantId: string) {
    const existing = await this.db.creditWallet.findFirst();
    if (existing) return existing;

    return this.db.creditWallet.create({
      data: { tenantId, balance: 0, lowBalanceThreshold: 100 } as Prisma.CreditWalletUncheckedCreateInput,
    });
  }
}
