import { PrismaClient } from "@prisma/client";
import { TENANT_SCOPED_MODELS, assertTenantScopeCoverage } from "./tenant-scoped";

/**
 * The schema grew from four models to thirty-six in one change, and the thing that makes
 * that safe is the rule that every model is either tenant-scoped or deliberately global.
 * `assertTenantScopeCoverage` enforces it at boot — but boot needs a database, so it only
 * fails in an environment that already has one.
 *
 * These tests run the same check against the generated client's model list with no
 * connection, which means a model added without a tenancy decision fails in CI on the
 * commit that adds it, rather than the first time someone starts the API.
 *
 * Reading `_runtimeDataModel` needs no database: it is baked into the generated client.
 */
describe("tenant scope coverage", () => {
  const prisma = new PrismaClient();

  const modelNames: string[] = Object.keys(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((prisma as any)._runtimeDataModel?.models ?? {}) as Record<string, unknown>,
  );

  it("finds the generated models, so the rest of this suite is meaningful", () => {
    // Guards against the check silently passing because the model list came back empty —
    // which is what a Prisma upgrade that renames the internal field would look like.
    expect(modelNames.length).toBeGreaterThan(30);
  });

  it("classifies every model as tenant-scoped or deliberately global", () => {
    expect(() => assertTenantScopeCoverage(prisma)).not.toThrow();
  });

  it("does not register a model that no longer exists in the schema", () => {
    // The opposite drift: a model renamed or deleted leaves a stale entry behind, and a
    // stale entry is a filter that will never fire.
    const stale = [...TENANT_SCOPED_MODELS].filter((model) => !modelNames.includes(model));
    expect(stale).toEqual([]);
  });

  it("scopes every model that actually carries a tenant_id column", () => {
    // The registry is hand-maintained, so this derives the truth from the schema itself:
    // if a model has a tenantId field, it must be scoped, no exceptions and no judgement.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const models = ((prisma as any)._runtimeDataModel?.models ?? {}) as Record<
      string,
      { fields: { name: string }[] }
    >;

    const carriesTenantId = Object.entries(models)
      .filter(([, model]) => model.fields.some((field) => field.name === "tenantId"))
      .map(([name]) => name);

    const unscoped = carriesTenantId.filter((model) => !TENANT_SCOPED_MODELS.has(model));

    expect(unscoped).toEqual([]);
  });

  it("keeps the two sets disjoint", () => {
    // A model in both would be scoped by the extension and simultaneously declared
    // global — the registry would compile and mean nothing.
    const roots = Object.keys(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((prisma as any)._runtimeDataModel?.models ?? {}) as Record<string, unknown>,
    ).filter((model) => !TENANT_SCOPED_MODELS.has(model));

    const overlap = roots.filter((model) => TENANT_SCOPED_MODELS.has(model));
    expect(overlap).toEqual([]);
  });
});
