import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type CreditOperation, type CreditTransaction, type CreditWallet } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CREDIT_POLICY_ENV, readCreditPolicy, type CreditPolicy } from "./credit-policy";

/** The operations that add credits. Debits go through CreditsService.spend. */
export type GrantOperation = Extract<
  CreditOperation,
  "PURCHASE" | "PLAN_GRANT" | "MANUAL_ADJUSTMENT" | "REFUND"
>;

export interface CreditEntry {
  operation: GrantOperation;
  amount: number;
  referenceType?: string;
  referenceId?: string;
  /** Whoever caused the entry; for an operator grant, the operator, not a member. */
  actorId?: string;
  note?: string;
}

/** A wallet row as read under `SELECT … FOR UPDATE`. */
export interface LockedWallet {
  id: string;
  tenantId: string;
  balance: number;
}

/** The trial grant's reference: one per workspace, enforced by the grant-reference index. */
export const TRIAL_GRANT_REFERENCE_TYPE = "trial";

/**
 * The half of the credit ledger that is not tied to a request.
 *
 * CreditsService works for whoever is signed in; this works for a workspace named
 * explicitly, which the operator console needs (it grants to a workspace it is not a
 * member of) and which the wallet's first creation needs regardless of who triggers it.
 * The rules are the ones CreditsService has always kept, kept here once:
 *
 *   - every movement takes the wallet's row lock and writes its ledger row in the same
 *     transaction, so the wallet balance stays equal to the sum of its ledger; and
 *   - a grant that carries a reference is applied at most once — the database refuses a
 *     second one (see the partial unique index in the trial-expiry migration).
 *
 * It uses the unscoped client because the tenant is a parameter, not the caller's. Every
 * caller passes a tenantId it has already established: CreditsService from the guard's
 * context, the operator console from a SUPER_ADMIN route that checked the workspace exists.
 */
@Injectable()
export class CreditLedger {
  readonly policy: CreditPolicy;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.policy = readCreditPolicy(
      Object.fromEntries(CREDIT_POLICY_ENV.map((key) => [key, config.get<string>(key)])),
    );
  }

  /**
   * The workspace's wallet, created on first use.
   *
   * A new wallet starts with the trial grant: one PLAN_GRANT row of TRIAL_CREDITS, written
   * in the same transaction as the wallet, so the wallet's balance is the sum of its
   * ledger from its very first moment — the invariant `reconcile` checks. With
   * TRIAL_CREDITS at 0 the wallet starts empty and no row is written.
   *
   * Two first requests can race to create it. The wallet's unique tenant id lets exactly
   * one insert win; the other's transaction rolls back with its grant, and it reads the
   * winner's wallet. So the grant happens once however many requests arrive together —
   * and since arriving together is exactly when this runs (a new workspace's first page
   * asks for its balance from several places), the transaction waits for a connection as
   * long as an ordinary query would, rather than Prisma's two-second default.
   */
  async ensureWallet(tenantId: string): Promise<CreditWallet> {
    const existing = await this.prisma.creditWallet.findUnique({ where: { tenantId } });
    if (existing) return existing;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // A wallet deleted by hand and recreated must not grant the trial a second time.
        // It starts at zero instead, and reconcile reports the gap — which is the point
        // of reconcile.
        const grant =
          this.policy.trialCredits > 0 &&
          !(await tx.creditTransaction.findFirst({
            where: { tenantId, referenceType: TRIAL_GRANT_REFERENCE_TYPE, referenceId: tenantId },
            select: { id: true },
          }))
            ? this.policy.trialCredits
            : 0;

        const wallet = await tx.creditWallet.create({
          data: { tenantId, balance: grant, lowBalanceThreshold: 100 },
        });

        if (grant > 0) {
          await tx.creditTransaction.create({
            data: {
              tenantId,
              type: "CREDIT",
              operation: "PLAN_GRANT",
              amount: grant,
              balanceBefore: 0,
              balanceAfter: grant,
              referenceType: TRIAL_GRANT_REFERENCE_TYPE,
              referenceId: tenantId,
              note: "Trial credits",
            },
          });
        }

        return wallet;
      }, { maxWait: 10_000 });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const created = await this.prisma.creditWallet.findUnique({ where: { tenantId } });
        if (created) return created;
      }
      throw error;
    }
  }

  /**
   * Runs `work` inside a transaction that holds the wallet's row lock.
   *
   * Anything that reads the ledger to decide whether a credit may happen — the operator's
   * daily cap is one — has to read it here. Read outside the lock, two requests could
   * both see room under the cap and both be applied.
   */
  async withLockedWallet<T>(
    tenantId: string,
    work: (tx: Prisma.TransactionClient, wallet: LockedWallet) => Promise<T>,
  ): Promise<T> {
    await this.ensureWallet(tenantId);

    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string; balance: number }[]>`
        SELECT id, balance FROM credit_wallets WHERE tenant_id = ${tenantId} FOR UPDATE
      `;
      if (!locked) throw new BadRequestException("This workspace has no credit wallet.");
      return work(tx, { id: locked.id, tenantId, balance: locked.balance });
    });
  }

  /**
   * Adds credits to a wallet whose lock the transaction holds, and writes the ledger row.
   *
   * A grant whose reference was already applied is refused with 409 rather than applied
   * again: a retried request or a double click must not credit twice.
   */
  async appendCredit(
    tx: Prisma.TransactionClient,
    wallet: LockedWallet,
    entry: CreditEntry,
  ): Promise<CreditTransaction> {
    if (!Number.isInteger(entry.amount) || entry.amount <= 0) {
      throw new BadRequestException("A credit amount must be a positive whole number.");
    }

    const balanceAfter = wallet.balance + entry.amount;

    await tx.creditWallet.update({
      where: { id: wallet.id },
      // Clearing the notification stamp on the way up so a workspace that tops up and
      // later falls low again is warned a second time.
      data: { balance: balanceAfter, lowBalanceNotifiedAt: null },
    });

    try {
      return await tx.creditTransaction.create({
        data: {
          tenantId: wallet.tenantId,
          type: "CREDIT",
          operation: entry.operation,
          amount: entry.amount,
          balanceBefore: wallet.balance,
          balanceAfter,
          referenceType: entry.referenceType,
          referenceId: entry.referenceId,
          actorId: entry.actorId,
          note: entry.note,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `Credits for ${entry.referenceType} "${entry.referenceId}" have already been granted ` +
            `to this workspace.`,
        );
      }
      throw error;
    }
  }

  /** One credit under the lock — what CreditsService.grant and refunds use. */
  credit(tenantId: string, entry: CreditEntry): Promise<CreditTransaction> {
    return this.withLockedWallet(tenantId, (tx, wallet) => this.appendCredit(tx, wallet, entry));
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
