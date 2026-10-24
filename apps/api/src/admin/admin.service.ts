import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type TenantStatus } from "@prisma/client";
import { TenantAccessService } from "../auth/tenant-access.service";
import { CreditLedger } from "../credits/credit-ledger";
import { PrismaService } from "../prisma/prisma.service";

/** Who is operating, and from where — what every audit row this module writes records. */
export interface OperatorContext {
  userId: string;
  email: string;
  /** The operator's own workspace, which the console refuses to act on. */
  tenantId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface ListTenantsQuery {
  status?: TenantStatus;
  search?: string;
  page: number;
  pageSize: number;
}

export type OperatorGrantOperation = "MANUAL_ADJUSTMENT" | "PURCHASE" | "PLAN_GRANT";

export interface GrantCreditsInput {
  amount: number;
  note: string;
  /** A payment or invoice reference. A second grant with the same one is refused. */
  reference?: string;
  operation?: OperatorGrantOperation;
}

/** Every operator grant carries this reference type; the daily cap counts exactly these. */
export const OPERATOR_GRANT_REFERENCE_TYPE = "operator";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The audit actions that change a workspace's status; their metadata carries `from` and `to`. */
const STATUS_ACTIONS = ["platform.tenant.suspend", "platform.tenant.reactivate", "platform.tenant.cancel"];

/** The statuses a workspace can write in (a trial only until it ends). */
const OPEN_STATUSES = new Set<string>(["TRIAL", "ACTIVE"] satisfies TenantStatus[]);
const isOpen = (status: unknown): status is "TRIAL" | "ACTIVE" =>
  typeof status === "string" && OPEN_STATUSES.has(status);

/** A workspace the console may act on, as targetOf found it. */
interface TargetTenant {
  id: string;
  name: string;
  subdomain: string;
  status: TenantStatus;
  trialEndsAt: Date | null;
}

/**
 * The operator (Super Admin) console: see every workspace, suspend, reactivate or close
 * one, and grant it credits.
 *
 * The one feature module that works across workspaces, so it uses the unscoped client
 * and names the workspace in every query. It is reachable only through AdminController,
 * behind OperatorGuard, and every call it serves leaves an audit row: in the workspace it
 * acted on, so that workspace's own audit log shows what the platform did to it, or — for
 * the list, which touches no one workspace — in the operator's own.
 *
 * Audit rows are written here directly, in the same transaction as the change they
 * describe, through `audit()` — the single place to swap for a shared audit service.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: CreditLedger,
    private readonly tenantAccess: TenantAccessService,
  ) {}

  /**
   * Workspaces with what an operator needs to triage them: status, plan, people, balance,
   * and the last thirty days of calls and credits spent.
   *
   * Five grouped queries for the page rather than five per workspace, so a page of fifty
   * costs the same as a page of one.
   */
  async listTenants(query: ListTenantsQuery, operator: OperatorContext) {
    const where: Prisma.TenantWhereInput = {};
    if (query.status) where.status = query.status;
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { subdomain: { contains: search.toLowerCase() } },
      ];
    }

    const [tenants, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          name: true,
          subdomain: true,
          industryVertical: true,
          status: true,
          trialEndsAt: true,
          createdAt: true,
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    const ids = tenants.map((tenant) => tenant.id);
    const since = new Date(Date.now() - 30 * DAY_MS);

    const [members, wallets, calls, spent, subscriptions] = await Promise.all([
      this.prisma.user.groupBy({
        by: ["tenantId", "status"],
        where: { tenantId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.creditWallet.findMany({
        where: { tenantId: { in: ids } },
        select: { tenantId: true, balance: true },
      }),
      this.prisma.call.groupBy({
        by: ["tenantId"],
        where: { tenantId: { in: ids }, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.creditTransaction.groupBy({
        by: ["tenantId"],
        where: { tenantId: { in: ids }, type: "DEBIT", createdAt: { gte: since } },
        _sum: { amount: true },
      }),
      this.prisma.subscription.findMany({
        where: { tenantId: { in: ids } },
        orderBy: { createdAt: "desc" },
        select: { tenantId: true, status: true, plan: { select: { key: true, name: true } } },
      }),
    ]);

    const data = tenants.map((tenant) => {
      const people = members.filter((row) => row.tenantId === tenant.id);
      // Newest first, so the first match is the subscription in force.
      const subscription = subscriptions.find((row) => row.tenantId === tenant.id);
      const wallet = wallets.find((row) => row.tenantId === tenant.id);

      return {
        ...tenant,
        plan: subscription
          ? { key: subscription.plan.key, name: subscription.plan.name, status: subscription.status }
          : null,
        users: {
          total: people.reduce((sum, row) => sum + row._count._all, 0),
          active: people.find((row) => row.status === "ACTIVE")?._count._all ?? 0,
        },
        // Null until the workspace first touches credits, which is when its wallet (and
        // its trial grant) is created.
        balance: wallet?.balance ?? null,
        last30Days: {
          calls: calls.find((row) => row.tenantId === tenant.id)?._count._all ?? 0,
          creditsSpent: spent.find((row) => row.tenantId === tenant.id)?._sum.amount ?? 0,
        },
      };
    });

    await this.audit(this.prisma, operator, {
      tenantId: operator.tenantId,
      action: "platform.tenants.list",
      resourceType: "tenant",
      resourceId: null,
      metadata: {
        status: query.status ?? null,
        search: search || null,
        page: query.page,
        returned: data.length,
      },
    });

    return {
      data,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  /** Read-only from the next request: members can still sign in, see their data and pay. */
  suspend(tenantId: string, reason: string, operator: OperatorContext) {
    return this.changeStatus(tenantId, "SUSPENDED", "platform.tenant.suspend", reason, operator);
  }

  /**
   * Reopens a workspace, which can write again afterwards whatever it was before.
   *
   * A suspended or cancelled workspace goes back to the status it had before it was
   * closed, so one suspended mid-trial is a trial again and still ends on its date.
   * Making it ACTIVE would quietly turn a trial into a workspace that never expires.
   * Otherwise it becomes ACTIVE:
   *   - a trial that has ended, whether before or while it was closed: reactivating says
   *     it may write, which an ended trial would refuse;
   *   - a workspace that is not closed: for a trial, making it a full workspace is the one
   *     thing reactivating can mean;
   *   - a closure that left no audit row (a status set outside this console), whose
   *     earlier status is unknown.
   */
  reactivate(tenantId: string, reason: string | undefined, operator: OperatorContext) {
    return this.changeStatus(
      tenantId,
      (tenant) => this.reopenedStatus(tenant),
      "platform.tenant.reactivate",
      reason,
      operator,
    );
  }

  /**
   * Closes the workspace: every session and every API key it has is revoked in the same
   * transaction, so nothing it issued keeps working, and TenantGuard refuses whatever
   * access token is still in flight. The data stays; reactivating reopens it, and its
   * people sign in again (with new API keys).
   */
  cancel(tenantId: string, reason: string, operator: OperatorContext) {
    return this.changeStatus(tenantId, "CANCELLED", "platform.tenant.cancel", reason, operator, async (tx) => {
      const now = new Date();
      const sessions = await tx.refreshToken.updateMany({
        where: { tenantId, revokedAt: null },
        data: { revokedAt: now },
      });
      const apiKeys = await tx.apiKey.updateMany({
        where: { tenantId, revokedAt: null },
        data: { revokedAt: now },
      });
      return { sessionsRevoked: sessions.count, apiKeysRevoked: apiKeys.count };
    });
  }

  /**
   * Grants credits to a workspace — a sale made by hand until there is a checkout, or a
   * support correction.
   *
   * Runs as the target workspace: its wallet, its lock, its ledger, its audit log. The
   * guard rails are the ones a stolen operator session would run into: a note is
   * required, a reference is applied once, and no workspace gets more than
   * OPERATOR_DAILY_CREDIT_CAP in any 24 hours. The cap is checked under the wallet's lock,
   * so two grants sent together cannot both squeeze under it.
   */
  async grantCredits(tenantId: string, input: GrantCreditsInput, operator: OperatorContext) {
    const tenant = await this.targetOf(tenantId, operator);
    if (tenant.status === "CANCELLED") {
      throw new ConflictException("This workspace is cancelled. Reactivate it before granting credits.");
    }

    const cap = this.ledger.policy.operatorDailyGrantCap;
    if (input.amount > cap) {
      throw new BadRequestException(
        `At most ${cap} credits can be granted to one workspace in 24 hours (OPERATOR_DAILY_CREDIT_CAP).`,
      );
    }

    const operation = input.operation ?? "MANUAL_ADJUSTMENT";
    const since = new Date(Date.now() - DAY_MS);

    const { entry, grantedLast24h } = await this.ledger.withLockedWallet(tenantId, async (tx, wallet) => {
      const recent = await tx.creditTransaction.aggregate({
        where: {
          tenantId,
          type: "CREDIT",
          referenceType: OPERATOR_GRANT_REFERENCE_TYPE,
          createdAt: { gte: since },
        },
        _sum: { amount: true },
      });
      const already = recent._sum.amount ?? 0;
      if (already + input.amount > cap) {
        throw new BadRequestException(
          `This would take the last 24 hours' grants to ${already + input.amount} credits, over the ` +
            `cap of ${cap} (OPERATOR_DAILY_CREDIT_CAP). ${Math.max(0, cap - already)} can still be granted.`,
        );
      }

      const entry = await this.ledger.appendCredit(tx, wallet, {
        operation,
        amount: input.amount,
        referenceType: OPERATOR_GRANT_REFERENCE_TYPE,
        referenceId: input.reference,
        actorId: operator.userId,
        note: input.note,
      });

      await this.audit(tx, operator, {
        tenantId,
        action: "platform.credits.grant",
        resourceType: "credit_transaction",
        resourceId: entry.id,
        metadata: {
          amount: input.amount,
          operation,
          reference: input.reference ?? null,
          note: input.note,
          balanceBefore: entry.balanceBefore,
          balanceAfter: entry.balanceAfter,
        },
      });

      return { entry, grantedLast24h: already + input.amount };
    });

    return {
      transaction: {
        id: entry.id,
        operation: entry.operation,
        amount: entry.amount,
        balanceBefore: entry.balanceBefore,
        balanceAfter: entry.balanceAfter,
        reference: entry.referenceId,
        note: entry.note,
        createdAt: entry.createdAt,
      },
      balance: entry.balanceAfter,
      grantedLast24h,
      dailyCap: cap,
    };
  }

  /** `next` is the new status, or how to work it out from the workspace as it is now. */
  private async changeStatus(
    tenantId: string,
    next: TenantStatus | ((tenant: TargetTenant) => Promise<TenantStatus>),
    action: string,
    reason: string | undefined,
    operator: OperatorContext,
    alongside?: (tx: Prisma.TransactionClient) => Promise<Record<string, number>>,
  ) {
    const tenant = await this.targetOf(tenantId, operator);
    const to = typeof next === "function" ? await next(tenant) : next;

    if (to === "SUSPENDED" && tenant.status === "CANCELLED") {
      // Suspending would reopen a closed workspace for reading. Reopening is reactivate.
      throw new ConflictException("This workspace is cancelled. Reactivate it before suspending it.");
    }

    const details = await this.prisma.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id: tenantId }, data: { status: to } });
      const details = alongside ? await alongside(tx) : {};
      await this.audit(tx, operator, {
        tenantId,
        action,
        resourceType: "tenant",
        resourceId: tenantId,
        metadata: { from: tenant.status, to, reason: reason ?? null, ...details },
      });
      return details;
    });

    // Applies from this instance's next request; other instances within the guard's cache
    // window.
    this.tenantAccess.forget(tenantId);

    return {
      id: tenant.id,
      name: tenant.name,
      subdomain: tenant.subdomain,
      previousStatus: tenant.status,
      status: to,
      ...details,
    };
  }

  /** What reactivate sets: see there. */
  private async reopenedStatus(tenant: TargetTenant): Promise<TenantStatus> {
    if (tenant.status !== "SUSPENDED" && tenant.status !== "CANCELLED") return "ACTIVE";

    const before = await this.statusBeforeClosing(tenant.id);
    const trialEnded = tenant.trialEndsAt !== null && tenant.trialEndsAt <= new Date();
    return before === "TRIAL" && !trialEnded ? "TRIAL" : "ACTIVE";
  }

  /**
   * The open status a closed workspace had before this console closed it, read back from
   * the audit rows changeStatus wrote: newest first, the first `from` that was open. A
   * suspension followed by a cancellation is two rows, so it may take more than one.
   *
   * A row whose `to` is open is a reopening, and the closure being undone began after it;
   * reaching one means this closure left no row, so the answer is that there is none.
   */
  private async statusBeforeClosing(tenantId: string): Promise<"TRIAL" | "ACTIVE" | null> {
    const changes = await this.prisma.auditLog.findMany({
      where: { tenantId, resourceType: "tenant", resourceId: tenantId, action: { in: STATUS_ACTIONS } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { metadata: true },
    });
    for (const { metadata } of changes) {
      const change = (metadata ?? {}) as { from?: unknown; to?: unknown };
      if (isOpen(change.to)) return null;
      if (isOpen(change.from)) return change.from;
    }
    return null;
  }

  /**
   * The workspace the operator named: a customer's, never a platform workspace.
   *
   * Not the operator's own: suspending or cancelling it would lock them out of the console
   * that undoes it. Nor another operator's: `create-super-admin.ts --subdomain` can make
   * more than one platform workspace, and cancelling one would end that operator's
   * sessions and API keys and lock them out the same way. A platform workspace is one with
   * a SUPER_ADMIN in it; the script keeps customers out of those.
   */
  private async targetOf(tenantId: string, operator: OperatorContext): Promise<TargetTenant> {
    if (tenantId === operator.tenantId) {
      throw new BadRequestException(
        "The operator console acts on other workspaces, not the one you are signed in to.",
      );
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, subdomain: true, status: true, trialEndsAt: true },
    });
    if (!tenant) throw new NotFoundException("Workspace not found");

    const operators = await this.prisma.user.count({ where: { tenantId, role: "SUPER_ADMIN" } });
    if (operators > 0) {
      throw new BadRequestException(
        "That is a platform workspace. The operator console acts on customer workspaces only.",
      );
    }
    return tenant;
  }

  private audit(
    db: Prisma.TransactionClient,
    operator: OperatorContext,
    entry: {
      tenantId: string;
      action: string;
      resourceType: string;
      resourceId: string | null;
      metadata: Prisma.InputJsonObject;
    },
  ) {
    return db.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        actorId: operator.userId,
        actorEmail: operator.email,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadata: entry.metadata,
        ipAddress: operator.ipAddress,
        userAgent: operator.userAgent,
      },
    });
  }
}
