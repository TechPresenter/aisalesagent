"use client";

import { useState } from "react";
import { Crown, Headphones, Users, type LucideIcon } from "lucide-react";
import { AuthCard, GradientButton } from "@/components/auth/auth-ui";
import { TONE_HEX, type Tone } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * Feature List §1 — Onboarding, step one.
 *
 * These are the three roles the workspace actually models (`packages/shared/roles.ts`
 * and the API's `TenantRole`), so what someone picks here maps to a real permission set
 * rather than being a preference.
 */
const ROLES: { id: string; label: string; blurb: string; icon: LucideIcon; tone: Tone }[] = [
  {
    id: "OWNER",
    label: "Business Owner / Administrator",
    blurb: "Manage team, campaigns and settings",
    icon: Crown,
    tone: "amber",
  },
  {
    id: "AGENT",
    label: "Sales Agent",
    blurb: "Make calls and handle leads",
    icon: Headphones,
    tone: "blue",
  },
  {
    id: "MEMBER",
    label: "Team Member",
    blurb: "View leads and follow-ups",
    icon: Users,
    tone: "purple",
  },
];

export default function OnboardingRolePage() {
  const [selected, setSelected] = useState(ROLES[0].id);

  return (
    <AuthCard
      title="How will you use Appsgain?"
      subtitle="Choose the option that best describes you."
      backHref="/verify-email"
      wide
    >
      <fieldset className="space-y-3">
        <legend className="sr-only">Your role</legend>
        {ROLES.map((role) => {
          const active = selected === role.id;
          const hex = TONE_HEX[role.tone];

          return (
            <label
              key={role.id}
              className={cn(
                "flex cursor-pointer items-center gap-3.5 rounded-xl border p-3.5 transition-colors",
                active
                  ? "border-brand-magenta bg-brand-magenta/[0.04]"
                  : "border-slate-200 hover:bg-slate-50",
              )}
            >
              <input
                type="radio"
                name="role"
                value={role.id}
                checked={active}
                onChange={() => setSelected(role.id)}
                className="h-[18px] w-[18px] shrink-0 cursor-pointer accent-[#E5199B]"
              />
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: `${hex}1F` }}
              >
                <role.icon className="h-5 w-5" strokeWidth={1.9} style={{ color: hex }} />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-brand-navy">
                  {role.label}
                </span>
                <span className="block text-[12.5px] text-slate-500">{role.blurb}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="mt-6">
        <GradientButton href="/onboarding/business">Continue</GradientButton>
      </div>
    </AuthCard>
  );
}
