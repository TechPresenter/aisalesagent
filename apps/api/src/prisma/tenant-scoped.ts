import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * Every model that carries a `tenant_id`. Adding a tenant-scoped table to schema.prisma
 * without adding it here leaves it readable by every tenant, so the two are kept
 * together by the convention comment at the top of the schema — and by
 * `assertTenantScopeCoverage()` below, which the API calls once at boot.
 */
export const TENANT_SCOPED_MODELS = new Set([
  // Identity and access
  "User",
  "RefreshToken",
  "CustomRole",
  // Leads
  "Lead",
  "Tag",
  "LeadTag",
  "LeadActivity",
  // Campaigns
  "Campaign",
  "CampaignLead",
  // AI
  "AiAgent",
  "AiProviderConfig",
  // Calls
  "Call",
  "CallParticipant",
  "Recording",
  "Transcript",
  "TranscriptSegment",
  // Sales workflow
  "SalesNote",
  "FollowUp",
  "CalendarEvent",
  "Notification",
  // Integrations
  "Integration",
  "Webhook",
  "WebhookDelivery",
  // Money
  "CreditWallet",
  "CreditTransaction",
  "Subscription",
  "Invoice",
  // Platform
  "AuditLog",
  "ApiKey",
  "SavedSearch",
  "TablePreference",
  "ExportJob",
  "BackgroundJob",
  // Settings
  "TenantSettings",
  "UserSettings",
  "NotificationPreference",
  "Invitation",
  "PaymentMethod",
  "TwoFactorAuth",
  "BackupCode",
  "CallSettings",
  "AiSettings",
]);

/**
 * Models that legitimately have no tenant_id. Anything else is a mistake.
 *
 * Tenant is the root of the tree. Plan and Permission are catalogues: a plan key and a
 * permission key mean the same thing in every workspace, and neither is writable by a
 * tenant — only by platform administration.
 *
 * CustomRolePermission is the odd one out. It is a join between a tenant-owned
 * CustomRole and a global Permission, and reaching it requires a customRoleId that the
 * scoped client already refuses to hand out across tenants. Adding a tenantId column
 * would be a second copy of a fact the parent row already states.
 */
const TENANT_ROOT_MODELS = new Set([
  "Tenant",
  "Plan",
  "Permission",
  "CustomRolePermission",
]);

/** Reads and bulk writes: safe to narrow by adding tenantId to the where clause. */
const FILTERABLE_OPERATIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
]);

/**
 * Single-row writes addressed by a unique key. Prisma will not accept a non-unique
 * field in their `where`, so they get a pre-flight ownership check instead.
 */
const UNIQUE_WRITE_OPERATIONS = new Set(["update", "delete", "upsert"]);

/** Single-row reads addressed by a unique key — checked after the fact. */
const UNIQUE_READ_OPERATIONS = new Set(["findUnique", "findUniqueOrThrow"]);

const CREATE_OPERATIONS = new Set(["create", "createMany"]);

export type TenantScopedClient = ReturnType<typeof tenantScoped>;

/**
 * Wraps a PrismaClient so that every query against a tenant-scoped model is confined to
 * one tenant, whether or not the calling code remembers to say so.
 *
 * This exists because a guard alone is not isolation. A guard checks the tenantId the
 * *request* mentions; it cannot see a query a developer wrote six months later that
 * forgot its `where`. Putting the filter in the data layer means the failure mode of
 * forgetting is an empty result, not another tenant's rows.
 *
 * Each operation family needs different handling:
 *
 *   - filterable reads/bulk writes — tenantId is merged into `where`.
 *   - creates — tenantId is written into `data`, so a client cannot choose it.
 *   - unique reads (findUnique) — Prisma rejects non-unique fields in `where`, so the
 *     row is fetched and then discarded if it belongs to someone else. Same visible
 *     result, one row of over-fetch.
 *   - unique writes (update/delete/upsert) — a post-check is too late, so ownership is
 *     confirmed with a findFirst before the write is allowed through.
 */
export function tenantScoped(prisma: PrismaClient, tenantId: string) {
  if (!tenantId) {
    // A blank tenantId would merge as `where: { tenantId: "" }` on reads but silently
    // match nothing while still *looking* scoped. Fail loudly instead.
    throw new ForbiddenException("Tenant scope is required");
  }

  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const typedArgs = args as Record<string, unknown>;

          if (FILTERABLE_OPERATIONS.has(operation)) {
            typedArgs.where = { ...((typedArgs.where as object) ?? {}), tenantId };
            return query(typedArgs);
          }

          if (CREATE_OPERATIONS.has(operation)) {
            const data = typedArgs.data;
            typedArgs.data = Array.isArray(data)
              ? data.map((row) => ({ ...(row as object), tenantId }))
              : { ...((data as object) ?? {}), tenantId };
            return query(typedArgs);
          }

          if (UNIQUE_WRITE_OPERATIONS.has(operation)) {
            // `as any` is contained to this one delegate lookup: the extension callback
            // is generic over every model, so there is no narrower type available here.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const delegate = (prisma as any)[lowerFirst(model)];
            const owned = await delegate.findFirst({
              where: { ...((typedArgs.where as object) ?? {}), tenantId },
              select: { id: true },
            });

            if (!owned) {
              // 404 rather than 403 on purpose: telling a caller "this row exists but is
              // not yours" confirms the row exists, which is itself a cross-tenant leak.
              throw new NotFoundException(`${model} not found`);
            }

            if (operation === "upsert") {
              typedArgs.create = {
                ...((typedArgs.create as object) ?? {}),
                tenantId,
              };
            }
            return query(typedArgs);
          }

          if (UNIQUE_READ_OPERATIONS.has(operation)) {
            // The ownership check reads `tenantId` off the returned row, so a caller's
            // `select` must not be allowed to remove it. Left alone, `findUnique({ where,
            // select: { id: true } })` returns a row whose tenantId is `undefined`, the
            // check below compares undefined to the real tenant, and a row the caller
            // legitimately owns comes back as null — a 404 on your own data, with nothing
            // in any log to explain it.
            //
            // So tenantId is added to the projection, and removed again before the result
            // is handed back. The caller gets exactly the shape it asked for; the filter
            // gets the field it needs.
            const select = typedArgs.select as Record<string, unknown> | undefined;
            const injectedTenantId = Boolean(select) && select!.tenantId === undefined;
            if (injectedTenantId) {
              typedArgs.select = { ...select, tenantId: true };
            }

            const result = (await query(typedArgs)) as { tenantId?: string } | null;
            if (!result || result.tenantId !== tenantId) {
              if (operation === "findUniqueOrThrow") {
                throw new NotFoundException(`${model} not found`);
              }
              return null;
            }

            if (injectedTenantId) {
              const { tenantId: _omitted, ...rest } = result;
              return rest;
            }
            return result;
          }

          return query(typedArgs);
        },
      },
    },
  });
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/** A Prisma create input with the tenantId removed — the scoped client supplies it. */
export type WithoutTenant<T> = Omit<T, "tenantId">;

/**
 * The one place the runtime guarantee meets the compile-time type.
 *
 * Prisma generates `tenantId` as a required field on every tenant-scoped create input,
 * because as far as the generated types know, a caller must provide it. Under the scoped
 * client a caller must *not*: the extension overwrites whatever is passed, so accepting
 * one would be accepting a value that is silently discarded.
 *
 * Calling this is how a service says "the data layer fills this in". It is deliberately
 * a named function rather than an inline `as` so that the assertions are greppable and a
 * reviewer can see every place the two models of the world are being reconciled.
 */
export function scopedCreate<T extends { tenantId: string }>(data: WithoutTenant<T>): T {
  return data as T;
}

/**
 * Boot-time check that no model has been added to the schema without a decision about
 * its tenancy. Cheap, and it turns "someone forgot" from a silent data leak into a
 * process that will not start.
 */
export function assertTenantScopeCoverage(prisma: PrismaClient): void {
  // Prisma exposes the generated model list on the runtime data model.
  const models: string[] = Object.keys(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((prisma as any)._runtimeDataModel?.models ?? {}) as Record<string, unknown>,
  );

  const unclassified = models.filter(
    (model) => !TENANT_SCOPED_MODELS.has(model) && !TENANT_ROOT_MODELS.has(model),
  );

  if (unclassified.length > 0) {
    throw new Error(
      `Models are missing a tenancy decision: ${unclassified.join(", ")}. ` +
        `Add each to TENANT_SCOPED_MODELS (it has a tenant_id) or TENANT_ROOT_MODELS ` +
        `(it is deliberately global) in src/prisma/tenant-scoped.ts.`,
    );
  }
}
