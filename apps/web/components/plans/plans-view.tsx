"use client";

import { useState } from "react";
import {
  Building2,
  Check,
  Crown,
  Gem,
  Headphones,
  Send,
  ShieldCheck,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { tenantBranding } from "@/config/branding";
import {
  YEARLY_DISCOUNT,
  compareRows,
  plans,
  priceFor,
  type BillingPeriod,
  type CompareCell,
  type Plan,
  type PlanIcon,
} from "@/lib/mock-plans";
import { TONE_HEX, type Tone } from "@/lib/status";
import { cn, formatNumber } from "@/lib/utils";

const PLAN_ICON: Record<PlanIcon, LucideIcon> = {
  starter: Send,
  professional: Crown,
  business: Building2,
  enterprise: Gem,
};

/** Feature List §13 — Plans & Billing. */
export function PlansView() {
  const [period, setPeriod] = useState<BillingPeriod>("monthly");

  return (
    <>
      {/* Said once, at the top, rather than left for someone to discover by pressing a
          button that does nothing. */}
      <p className="mb-4 rounded-btn bg-warning-amber/[0.1] px-4 py-2.5 text-[13px] font-medium text-[#B4761A]">
        Billing is not connected yet, so plans cannot be bought or changed from the app. Your
        current credit balance is on the Settings page.
      </p>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-brand-navy sm:text-display">
            Choose the Right Plan for Your Growth
          </h1>
          <p className="mt-1.5 text-[14px] text-slate-500">
            Flexible plans designed for clinics, healthcare businesses and sales teams of all
            sizes.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex rounded-btn bg-slate-100 p-1" role="group" aria-label="Billing period">
            <PeriodButton
              label="Monthly"
              active={period === "monthly"}
              onClick={() => setPeriod("monthly")}
            />
            <PeriodButton
              label="Yearly"
              active={period === "yearly"}
              onClick={() => setPeriod("yearly")}
            />
          </div>
          <span className="rounded-full bg-brand-green/[0.13] px-2.5 py-1.5 text-[12px] font-semibold text-deep-green">
            Save up to {Math.round(YEARLY_DISCOUNT * 100)}%
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} period={period} />
        ))}
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_364px]">
        <ComparisonTable />

        <div className="space-y-5">
          <HelpCard
            icon={Headphones}
            tone="blue"
            title="Need Help Choosing?"
            body="Our team can help you find the perfect plan for your clinic's needs."
            action="Talk to Sales"
          />
          <HelpCard
            icon={ShieldCheck}
            tone="green"
            title="30-Day Money Back Guarantee"
            body={`Try ${tenantBranding.tenantName} risk-free. If you're not satisfied, get a full refund within 30 days.`}
          />
          <HelpCard
            icon={Zap}
            tone="purple"
            title="Custom Requirements?"
            body="Need a tailored solution? We offer custom plans for hospitals, chains and enterprise clients."
            action="Contact Us"
          />
        </div>
      </div>
    </>
  );
}

function PlanCard({ plan, period }: { plan: Plan; period: BillingPeriod }) {
  const Icon = PLAN_ICON[plan.icon];
  const price = priceFor(plan, period);
  const hex = TONE_HEX[plan.tone];

  return (
    <Card
      className={cn(
        "relative flex h-full flex-col p-5",
        // The featured plan is marked with the accent border and a tinted ground rather
        // than by being made larger, so the four cards stay on one baseline grid.
        plan.featured && "border-accent-blue bg-accent-blue/[0.03] shadow-card-hover",
      )}
    >
      {plan.featured && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-accent-blue px-3 py-1 text-[11.5px] font-bold text-white shadow-sm">
          Most Popular
        </span>
      )}

      <div className="flex items-start gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `${hex}1F` }}
        >
          <Icon className="h-[21px] w-[21px]" strokeWidth={1.9} style={{ color: hex }} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold tracking-tight text-brand-navy">{plan.name}</h2>
          <p className="mt-0.5 text-[12.5px] leading-snug text-slate-500">{plan.tagline}</p>
        </div>
      </div>

      <div className="mt-4 min-h-[46px]">
        {price === null ? (
          <p className="text-[26px] font-bold leading-none tracking-tight text-brand-navy">
            Custom Pricing
          </p>
        ) : (
          <>
            <p className="flex flex-wrap items-baseline gap-1.5">
              <span className="tabular text-[28px] font-bold leading-none tracking-tight text-brand-navy">
                ₹{formatNumber(price)}
              </span>
              <span className="text-[13.5px] text-slate-500">/ month</span>
            </p>
            {period === "yearly" && (
              <p className="tabular mt-1 text-[11.5px] text-slate-400">
                billed yearly — ₹{formatNumber(price * 12)} a year
              </p>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        disabled
        title="Billing is not connected yet, so plans cannot be bought from the app."
        className={cn(
          "mt-4 flex h-11 w-full cursor-not-allowed items-center justify-center rounded-btn text-[14px] font-semibold opacity-60",
          plan.featured
            ? "bg-accent-blue text-white"
            : "border border-slate-200 text-accent-blue",
        )}
      >
        {plan.cta}
      </button>

      <ul className="mt-4 flex-1 space-y-2.5">
        {plan.features.map((feature) => (
          <li key={feature.label} className="flex items-start gap-2.5">
            {feature.included ? (
              <span
                aria-hidden
                className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-green"
              >
                <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.4} />
              </span>
            ) : (
              <span
                aria-hidden
                className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-200"
              >
                <X className="h-2.5 w-2.5 text-slate-500" strokeWidth={3.4} />
              </span>
            )}
            <span
              className={cn(
                "text-[12.5px] leading-snug",
                feature.included ? "text-slate-600" : "text-slate-400",
              )}
            >
              {feature.label}
            </span>
            <span className="sr-only">{feature.included ? "included" : "not included"}</span>
          </li>
        ))}
      </ul>

      <p className="mt-4 border-t border-slate-100 pt-3.5 text-[12.5px] text-slate-500">
        {plan.bestFor}
      </p>
    </Card>
  );
}

function ComparisonTable() {
  const featuredIndex = plans.findIndex((plan) => plan.featured);

  return (
    <Card className="min-w-0 overflow-hidden p-5">
      <h2 className="text-[19px] font-bold tracking-tight text-brand-navy">Compare Plans</h2>

      <div className="scrollbar-thin mt-3.5 overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-left">
          <caption className="sr-only">Feature comparison across the four plans</caption>
          <thead>
            <tr className="border-y border-slate-200 bg-slate-50/80">
              <th
                scope="col"
                className="whitespace-nowrap px-3 py-2.5 text-[12px] font-semibold text-slate-500"
              >
                Features
              </th>
              {plans.map((plan, index) => (
                <th
                  key={plan.id}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap px-3 py-2.5 text-center text-[12px] font-semibold",
                    index === featuredIndex
                      ? "bg-accent-blue/[0.06] text-accent-blue"
                      : "text-brand-navy",
                  )}
                >
                  {plan.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {compareRows.map((row) => (
              <tr key={row.feature} className="border-b border-slate-100">
                <th
                  scope="row"
                  className="px-3 py-2.5 text-left text-[12.5px] font-medium text-brand-navy"
                >
                  {row.feature}
                </th>
                {row.values.map((value, index) => (
                  <td
                    key={plans[index].id}
                    className={cn(
                      "px-3 py-2.5 text-center text-[12.5px] text-slate-600",
                      index === featuredIndex && "bg-accent-blue/[0.06]",
                    )}
                  >
                    <CompareValue value={value} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CompareValue({ value }: { value: CompareCell }) {
  if (value === true) {
    return (
      <>
        <Check className="mx-auto h-4 w-4 text-brand-green" strokeWidth={2.8} aria-hidden />
        <span className="sr-only">Included</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <span aria-hidden>—</span>
        <span className="sr-only">Not included</span>
      </>
    );
  }
  return <span className="tabular">{value}</span>;
}

const HELP_TONE: Record<"blue" | "green" | "purple", string> = {
  blue: "bg-accent-blue/[0.05]",
  green: "bg-brand-green/[0.06]",
  purple: "bg-accent-purple/[0.06]",
};

function HelpCard({
  icon: Icon,
  tone,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  tone: "blue" | "green" | "purple";
  title: string;
  body: string;
  action?: string;
}) {
  const hex = TONE_HEX[tone as Tone];

  return (
    <Card className={cn("flex gap-3 p-4", HELP_TONE[tone])}>
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${hex}24` }}
      >
        <Icon className="h-5 w-5" strokeWidth={1.9} style={{ color: hex }} />
      </span>
      <div className="min-w-0">
        <h3 className="text-[14px] font-bold text-brand-navy">{title}</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">{body}</p>
        {action && (
          <button
            type="button"
            disabled
            title="Billing is not connected yet."
            className="mt-2.5 flex h-9 w-full cursor-not-allowed items-center justify-center rounded-btn bg-accent-blue px-4 text-[13px] font-semibold text-white opacity-60"
          >
            {action}
          </button>
        )}
      </div>
    </Card>
  );
}

function PeriodButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md px-4 py-1.5 text-[13.5px] font-semibold transition-colors",
        active ? "bg-accent-blue text-white shadow-sm" : "text-brand-navy hover:bg-white/70",
      )}
    >
      {label}
    </button>
  );
}
