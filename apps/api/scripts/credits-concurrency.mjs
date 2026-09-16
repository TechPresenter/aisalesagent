/**
 * Proves the credit ledger holds under concurrency.
 *
 * This cannot be a unit test with a mocked Prisma, because the thing being tested *is*
 * the database's locking behaviour. A mock would happily return whatever balance the
 * test told it to and the suite would pass while production overdrew.
 *
 * The scenario: a wallet with exactly N credits, and 3N simultaneous requests to spend
 * one each. Correct behaviour is that exactly N succeed, 2N fail with
 * InsufficientCredits, the balance lands on zero, and the ledger sums to zero. A
 * read-decide-write without `FOR UPDATE` fails this — several requests read the same
 * balance, all conclude they can afford it, and the wallet goes negative.
 *
 *   node scripts/credits-concurrency.mjs
 */
import { PrismaClient } from "@prisma/client";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://appsgain:appsgain@127.0.0.1:5432/postgres?schema=public&pgbouncer=true";

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

const BUDGET = 5;
const ATTEMPTS = 15;

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * The same locked read-decide-write the service performs. Duplicated here rather than
 * imported because the service is request-scoped Nest wiring; what matters is that the
 * SQL is identical, and if it ever diverges this test stops being evidence.
 */
async function spendOne(tenantId) {
  try {
    await prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw`
        SELECT id, balance FROM credit_wallets WHERE tenant_id = ${tenantId} FOR UPDATE
      `;
      if (!locked) throw new Error("no wallet");
      if (locked.balance < 1) throw new Error("INSUFFICIENT");

      const balanceAfter = locked.balance - 1;
      await tx.creditWallet.update({ where: { id: locked.id }, data: { balance: balanceAfter } });
      await tx.creditTransaction.create({
        data: {
          tenantId,
          type: "DEBIT",
          operation: "AI_CALL",
          amount: 1,
          balanceBefore: locked.balance,
          balanceAfter,
          note: "concurrency probe",
        },
      });
    });
    return "ok";
  } catch (error) {
    return String(error.message).includes("INSUFFICIENT") ? "refused" : `error:${error.message}`;
  }
}

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { subdomain: "northwind" } });
  if (!tenant) throw new Error("seed the database first: npm run db:seed");

  // Isolate the probe: park the real balance and its ledger out of the way, run against
  // a known budget, then restore. The demo data should not be collateral.
  const wallet = await prisma.creditWallet.findUnique({ where: { tenantId: tenant.id } });
  const originalBalance = wallet.balance;

  await prisma.creditWallet.update({
    where: { id: wallet.id },
    data: { balance: BUDGET },
  });

  console.log(`wallet set to ${BUDGET}; firing ${ATTEMPTS} concurrent spends of 1\n`);

  const results = await Promise.all(
    Array.from({ length: ATTEMPTS }, () => spendOne(tenant.id)),
  );

  const ok = results.filter((r) => r === "ok").length;
  const refused = results.filter((r) => r === "refused").length;
  const errored = results.filter((r) => r.startsWith("error:"));

  const after = await prisma.creditWallet.findUnique({ where: { id: wallet.id } });
  const probeRows = await prisma.creditTransaction.findMany({
    where: { tenantId: tenant.id, note: "concurrency probe" },
  });

  console.log(`  succeeded ${ok}, refused ${refused}, errored ${errored.length}\n`);

  check(`exactly ${BUDGET} spends succeed`, ok === BUDGET, `got ${ok}`);
  check(`the other ${ATTEMPTS - BUDGET} are refused`, refused === ATTEMPTS - BUDGET, `got ${refused}`);
  check("the balance never goes negative", after.balance >= 0, `got ${after.balance}`);
  check("the balance lands on zero", after.balance === 0, `got ${after.balance}`);
  check(
    "one ledger row per successful spend",
    probeRows.length === BUDGET,
    `got ${probeRows.length}`,
  );
  check(
    "no two ledger rows claim the same balanceAfter",
    new Set(probeRows.map((r) => r.balanceAfter)).size === probeRows.length,
    JSON.stringify(probeRows.map((r) => r.balanceAfter)),
  );
  if (errored.length > 0) {
    console.log(`  note: ${errored.length} unexpected errors — ${errored[0]}`);
  }

  // Restore.
  await prisma.creditTransaction.deleteMany({
    where: { tenantId: tenant.id, note: "concurrency probe" },
  });
  await prisma.creditWallet.update({
    where: { id: wallet.id },
    data: { balance: originalBalance },
  });
  console.log(`\nwallet restored to ${originalBalance}`);

  if (failures > 0) process.exit(1);
}

main()
  .catch((error) => {
    console.error("probe failed:", error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
