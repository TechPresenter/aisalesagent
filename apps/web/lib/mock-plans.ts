import type { Tone } from "./status";

/**
 * Feature List §13 — Plans & Billing.
 *
 * Prices are in paise-free rupees and monthly. The yearly figure is derived rather than
 * seeded (see `YEARLY_DISCOUNT`), so the headline "save up to 20%" and the number on the
 * card can never drift apart — which is the kind of mismatch a customer notices first.
 */

export const YEARLY_DISCOUNT = 0.2;

export type BillingPeriod = "monthly" | "yearly";

/** Keyed rather than imported so the data module stays free of React. */
export type PlanIcon = "starter" | "professional" | "business" | "enterprise";

export interface PlanFeature {
  label: string;
  /** A plan lists what it does *not* include too — the gap is the reason to upgrade. */
  included: boolean;
}

export interface Plan {
  id: string;
  name: string;
  tagline: string;
  /** Rupees per month. `null` is Enterprise, which is quoted rather than listed. */
  monthlyPrice: number | null;
  icon: PlanIcon;
  tone: Tone;
  /** The one plan the pricing page steers towards. Exactly one should carry this. */
  featured?: boolean;
  cta: string;
  bestFor: string;
  features: PlanFeature[];
}

export const plans: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "Perfect for small clinics getting started",
    monthlyPrice: 2999,
    icon: "starter",
    tone: "blue",
    cta: "Get Started",
    bestFor: "Best for individual clinics",
    features: [
      { label: "500 AI calls per month", included: true },
      { label: "Basic AI voice agent", included: true },
      { label: "Lead management", included: true },
      { label: "Call recordings (7 days)", included: true },
      { label: "Basic analytics", included: true },
      { label: "Email support", included: true },
      { label: "Advanced integrations", included: false },
      { label: "Custom AI training", included: false },
      { label: "Priority support", included: false },
    ],
  },
  {
    id: "professional",
    name: "Professional",
    tagline: "Great for growing healthcare businesses",
    monthlyPrice: 9999,
    icon: "professional",
    tone: "amber",
    featured: true,
    cta: "Get Started",
    bestFor: "Best for multi-location clinics",
    features: [
      { label: "2,500 AI calls per month", included: true },
      { label: "Advanced AI voice agent", included: true },
      { label: "Lead management & campaigns", included: true },
      { label: "Call recordings (30 days)", included: true },
      { label: "AI transcripts & summaries", included: true },
      { label: "Sales notes & follow-ups", included: true },
      { label: "Advanced analytics & reports", included: true },
      { label: "WhatsApp & Email integrations", included: true },
      { label: "Priority support", included: true },
    ],
  },
  {
    id: "business",
    name: "Business",
    tagline: "For large teams and multi-location clinics",
    monthlyPrice: 24999,
    icon: "business",
    tone: "blue",
    cta: "Get Started",
    bestFor: "Best for established healthcare chains",
    features: [
      { label: "10,000 AI calls per month", included: true },
      { label: "Everything in Professional", included: true },
      { label: "Custom AI training (your data)", included: true },
      { label: "Advanced campaign automation", included: true },
      { label: "Call recordings (90 days)", included: true },
      { label: "Team management (up to 10 users)", included: true },
      { label: "CRM integrations (HubSpot, Zoho)", included: true },
      { label: "Dedicated account manager", included: true },
      { label: "Priority support", included: true },
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "Custom solutions for large organizations",
    monthlyPrice: null,
    icon: "enterprise",
    tone: "purple",
    cta: "Talk to Sales",
    bestFor: "Best for hospitals & enterprise groups",
    features: [
      { label: "Unlimited AI calls", included: true },
      { label: "Everything in Business", included: true },
      { label: "Custom integrations (EMR, HIS)", included: true },
      { label: "White-label solution", included: true },
      { label: "Advanced security & compliance", included: true },
      { label: "Dedicated success manager", included: true },
      { label: "SLA & uptime guarantee", included: true },
      { label: "Custom reporting", included: true },
      { label: "On-premise / Private cloud (optional)", included: true },
    ],
  },
];

/**
 * The comparison grid. A cell is either a value to print or a plain yes/no — `true`
 * renders a tick and `false` an em dash, so a row never has to spell out "Yes"/"No".
 */
export type CompareCell = string | boolean;

export interface CompareRow {
  feature: string;
  /** In plan order: Starter, Professional, Business, Enterprise. */
  values: [CompareCell, CompareCell, CompareCell, CompareCell];
}

export const compareRows: CompareRow[] = [
  { feature: "AI Calls per Month", values: ["500", "2,500", "10,000", "Unlimited"] },
  { feature: "Call Recordings", values: ["7 days", "30 days", "90 days", "Unlimited"] },
  { feature: "AI Transcripts", values: [false, true, true, true] },
  { feature: "Sales Notes & Follow-ups", values: [false, true, true, true] },
  { feature: "Advanced Analytics", values: ["Basic", true, true, true] },
  { feature: "Team Members", values: ["1", "3", "10", "Unlimited"] },
  {
    feature: "Integrations",
    values: [false, "WhatsApp, Email", "CRM, WhatsApp, Email", "Custom (EMR, HIS, etc.)"],
  },
  { feature: "Support", values: ["Email", "Priority", "Priority", "Dedicated"] },
];

/** Rupees per month under the selected billing period. */
export function priceFor(plan: Plan, period: BillingPeriod) {
  if (plan.monthlyPrice === null) return null;
  if (period === "monthly") return plan.monthlyPrice;
  return Math.round(plan.monthlyPrice * (1 - YEARLY_DISCOUNT));
}
