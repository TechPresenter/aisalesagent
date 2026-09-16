"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2 } from "lucide-react";
import { GradientButton } from "@/components/auth/auth-ui";
import { ApiError, updateSessionUser, workspaceApi } from "@/lib/api-client";

/** The industry templates the workspace can be set up against (TRD §7 custom fields). */
const INDUSTRIES = [
  "IT Services",
  "Dental Clinic",
  "Multispeciality Hospital",
  "Diagnostic Lab",
  "Pharmacy",
  "Wellness & Fitness",
  "Other",
];

/**
 * Feature List §1 — Onboarding, step two.
 *
 * The workspace already exists by the time anyone gets here: sign-up created it. So this
 * edits it through `PATCH /workspace` rather than collecting fields for a request that
 * has already been sent — which is what the mocked version of this screen did.
 *
 * There is no city field: the tenant has no column for one, and a field that saves
 * nowhere is worse than a field that is missing.
 */
export function OnboardingBusinessForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState(INDUSTRIES[0]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    workspaceApi.mine().then(
      (workspace) => {
        setName(workspace.name);
        if (workspace.industryVertical) setIndustry(workspace.industryVertical);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  // A workspace set up with an industry that is not on this list keeps it rather than
  // being silently switched to the first option.
  const options = INDUSTRIES.includes(industry) ? INDUSTRIES : [industry, ...INDUSTRIES];

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) return;
    setSaving(true);
    setError(null);
    try {
      const workspace = await workspaceApi.update({
        name: name.trim(),
        industryVertical: industry,
      });
      updateSessionUser({ tenantName: workspace.name });
      router.push("/onboarding/done");
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status < 500
          ? cause.message
          : "Could not save your details. Check that the API is running and try again.",
      );
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <StackedField label="Company Name">
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={loading ? "Loading…" : "Your company"}
          autoComplete="organization"
          className="h-12 w-full rounded-btn border border-slate-200 bg-surface px-3.5 text-[14px] text-brand-navy transition-colors focus:border-brand-magenta focus:outline-none focus:ring-2 focus:ring-brand-magenta/20"
        />
      </StackedField>

      <StackedField label="Industry">
        <span className="relative block">
          <select
            value={industry}
            onChange={(event) => setIndustry(event.target.value)}
            className="h-12 w-full appearance-none rounded-btn border border-slate-200 bg-surface pl-3.5 pr-10 text-[14px] text-brand-navy transition-colors focus:border-brand-magenta focus:outline-none focus:ring-2 focus:ring-brand-magenta/20"
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            strokeWidth={2}
          />
        </span>
      </StackedField>

      {error && (
        <p
          role="alert"
          className="rounded-btn bg-alert-red/[0.08] px-3 py-2 text-[12.5px] font-medium text-[#C93B3B]"
        >
          {error}
        </p>
      )}

      <div className="pt-1.5">
        <GradientButton type="submit" disabled={saving || name.trim().length < 2}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
              Saving&hellip;
            </>
          ) : (
            "Continue"
          )}
        </GradientButton>
      </div>
    </form>
  );
}

/** Label above the control, matching the rest of the onboarding steps. */
function StackedField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}
