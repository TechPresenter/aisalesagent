"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { creditsApi, type CreditTransaction, type CreditWallet } from "@/lib/api-client";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";

const PAGE_SIZE = 10;

/** "AI_CALL" -> "AI call". Unknown operations still come out as words. */
function operationLabel(operation: string): string {
  const known: Record<string, string> = {
    AI_CALL: "AI call",
    MANUAL_ADJUSTMENT: "Manual adjustment",
    LEAD_ENRICHMENT: "Lead enrichment",
    TRANSCRIPTION: "Transcription",
    AI_ANALYSIS: "AI analysis",
    TOP_UP: "Top-up",
    PURCHASE: "Purchase",
    REFUND: "Refund",
  };
  if (known[operation]) return known[operation];
  const words = operation.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Feature List §13 — Settings → Billing, as far as the platform actually goes today:
 * the credit wallet, what those credits went on, and the ledger behind both.
 *
 * Plans, invoices and payment methods are modelled in the schema but have no endpoints,
 * so this says so rather than drawing an invoice table that would always be empty.
 */
export function BillingTab({ wallet }: { wallet: CreditWallet | null | undefined }) {
  const [usage, setUsage] = useState<{ operation: string; credits: number }[] | null>(null);
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<{
    data: CreditTransaction[];
    totalPages: number;
    total: number;
  } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    creditsApi.usage().then(setUsage, () => setUsage([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    creditsApi.history(page, PAGE_SIZE).then(
      (result) => {
        if (!cancelled) setHistory(result);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [page]);

  const spent = (usage ?? []).reduce((sum, row) => sum + row.credits, 0);
  const busiest = Math.max(1, ...(usage ?? []).map((row) => row.credits));

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <CardHeader className="p-0">
          <CardTitle>Credits</CardTitle>
          {wallet && (
            <Badge tone={wallet.isLow ? "amber" : "green"}>
              {wallet.isLow ? "Running low" : "Healthy"}
            </Badge>
          )}
        </CardHeader>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Figure
            label="Balance"
            value={wallet === undefined ? "…" : wallet ? formatNumber(wallet.balance) : "—"}
          />
          <Figure label="Spent in the last 30 days" value={formatNumber(spent)} />
          <Figure
            label="Low-balance warning at"
            value={
              wallet?.lowBalanceThreshold === null || wallet === null
                ? "Not set"
                : wallet === undefined
                  ? "…"
                  : formatNumber(wallet.lowBalanceThreshold ?? 0)
            }
          />
        </div>

        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-[12.5px] leading-relaxed text-slate-500">
          Calls spend credits as they connect. Buying credits and changing plans is not built
          yet — there is no checkout behind it. Prices are on the{" "}
          <Link href="/plans" className="font-semibold text-accent-blue hover:underline">
            Plans
          </Link>{" "}
          page.
        </p>
      </Card>

      <Card className="p-5">
        <CardTitle>Where the credits went</CardTitle>
        <p className="mt-1 text-[13px] text-slate-500">Spending by operation, last 30 days.</p>

        {usage === null ? (
          <p className="mt-4 text-[13px] text-slate-400">Loading…</p>
        ) : usage.length === 0 ? (
          <p className="mt-4 text-[13px] text-slate-500">No credits have been spent yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {usage.map((row) => (
              <li key={row.operation}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[13px] font-medium text-brand-navy">
                    {operationLabel(row.operation)}
                  </span>
                  <span className="tabular shrink-0 text-[13px] font-semibold text-brand-navy">
                    {formatNumber(row.credits)}
                  </span>
                </div>
                <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full rounded-full bg-accent-purple"
                    style={{ width: `${(row.credits / busiest) * 100}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Credit history</CardTitle>
          {history && (
            <span className="tabular shrink-0 text-[12px] text-slate-400">
              {formatNumber(history.total)} entries
            </span>
          )}
        </CardHeader>

        {failed ? (
          <p className="px-5 py-10 text-center text-[13px] text-slate-500">
            Could not load the credit history.
          </p>
        ) : !history ? (
          <p className="px-5 py-10 text-center text-[13px] text-slate-400">Loading…</p>
        ) : history.data.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-slate-500">
            Nothing on the ledger yet.
          </p>
        ) : (
          <>
            <div className="scrollbar-thin mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-left">
                <thead>
                  <tr className="bg-slate-50/80">
                    {["When", "Operation", "Change", "Balance after", "Note"].map((header) => (
                      <th
                        key={header}
                        scope="col"
                        className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                      <td className="tabular whitespace-nowrap px-4 py-3 text-[12.5px] text-slate-600">
                        {formatDateTime(row.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-[12.5px] font-medium text-brand-navy">
                        {operationLabel(row.operation)}
                      </td>
                      <td
                        className={cn(
                          "tabular whitespace-nowrap px-4 py-3 text-[12.5px] font-semibold",
                          row.type === "CREDIT" ? "text-deep-green" : "text-brand-navy",
                        )}
                      >
                        {row.type === "CREDIT" ? "+" : "−"}
                        {formatNumber(row.amount)}
                      </td>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-[12.5px] text-slate-600">
                        {formatNumber(row.balanceAfter)}
                      </td>
                      <td className="px-4 py-3 text-[12.5px] text-slate-500">
                        <span className="block max-w-[220px] truncate">{row.note ?? "—"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
              <p className="text-[12.5px] text-slate-500">
                Page {page} of {history.totalPages}
              </p>
              <Pagination page={page} totalPages={history.totalPages} onChange={setPage} />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3.5">
      <p className="text-[12px] text-slate-500">{label}</p>
      <p className="tabular mt-1 text-[20px] font-bold text-brand-navy">{value}</p>
    </div>
  );
}
