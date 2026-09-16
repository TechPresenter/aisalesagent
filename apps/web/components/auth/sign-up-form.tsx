"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Field, GradientButton, PasswordStrength } from "@/components/auth/auth-ui";
import { ApiError, authApi, usersApi, workspaceApi } from "@/lib/api-client";

/** The API's minimum (CreateWorkspaceDto). Checked here only to say so before submitting. */
const MIN_PASSWORD = 12;

/** Same rule as the API's SUBDOMAIN_PATTERN: 3–50 of a-z, 0-9 and "-", no edge hyphens. */
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;

/** "Northwind Solutions Pvt. Ltd." -> "northwind-solutions-pvt-ltd", clipped to 50. */
function toSubdomain(company: string): string {
  return company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 50)
    .replace(/-+$/, "");
}

/**
 * Self-serve signup. `POST /workspace` creates the workspace and its owner in one
 * request; the form then signs the owner in with the same credentials.
 *
 * This used to be a plain `<form action="/verify-email">` — a GET that created nothing
 * and put the typed password in the address bar. There is no email-verification endpoint
 * yet, so the flow skips the code screen and continues into the business step, which
 * edits the workspace this request just created.
 */
export function SignUpForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  // Derived from the company name until the person types their own.
  const [customSubdomain, setCustomSubdomain] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const subdomain = customSubdomain ?? toSubdomain(company);
  const subdomainValid = SUBDOMAIN.test(subdomain);
  const canSubmit =
    name.trim().length >= 2 &&
    company.trim().length >= 2 &&
    subdomainValid &&
    email.trim() !== "" &&
    password.length >= MIN_PASSWORD &&
    agreed &&
    !submitting;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);

    let ownerId: string;
    try {
      const created = await workspaceApi.create({
        name: company.trim(),
        subdomain,
        ownerName: name.trim(),
        ownerEmail: email.trim(),
        ownerPassword: password,
      });
      ownerId = created.owner.id;
    } catch (cause) {
      // 400 and 409 carry the reason ("Subdomain … is already taken"); anything else is
      // the server being unreachable, which the person can do something about.
      setError(
        cause instanceof ApiError && cause.status < 500
          ? cause.message
          : "Could not reach the server. Check that the API is running and try again.",
      );
      setSubmitting(false);
      return;
    }

    try {
      await authApi.login({ subdomain, email: email.trim(), password });
    } catch {
      // The workspace exists; only the automatic sign-in failed. Sign-in will work.
      router.push("/sign-in");
      return;
    }

    // The signup request has no phone field, so it is saved on the owner's own record.
    // Optional, and not worth failing a finished signup over.
    if (phone.trim()) {
      await usersApi.update(ownerId, { phone: phone.trim() }).catch(() => undefined);
    }

    router.push("/onboarding/business");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3.5">
      <Field
        label="Full Name"
        icon="user"
        placeholder="Prashant Kumar"
        autoComplete="name"
        value={name}
        onChange={setName}
      />
      <Field
        label="Company Name"
        icon="building"
        placeholder="Your company"
        autoComplete="organization"
        value={company}
        onChange={setCompany}
      />
      <div>
        <Field
          label="Workspace"
          icon="globe"
          placeholder="your-company"
          autoComplete="off"
          value={subdomain}
          onChange={(value) => setCustomSubdomain(value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
        />
        <p
          className={
            subdomain && !subdomainValid
              ? "mt-1.5 px-1 text-[11.5px] text-[#C93B3B]"
              : "mt-1.5 px-1 text-[11.5px] text-slate-500"
          }
        >
          {subdomain && !subdomainValid
            ? "3–50 lowercase letters, digits or hyphens, not starting or ending with a hyphen."
            : "You sign in with this workspace name."}
        </p>
      </div>
      <Field
        label="Business Email"
        icon="mail"
        type="email"
        placeholder="you@yourcompany.com"
        autoComplete="email"
        value={email}
        onChange={setEmail}
      />
      <Field
        label="Phone Number (optional)"
        icon="phone"
        type="tel"
        placeholder="+91 99554 46477"
        autoComplete="tel"
        value={phone}
        onChange={setPhone}
      />
      <div>
        <Field
          label="Create Password"
          icon="lock"
          type="password"
          placeholder={`At least ${MIN_PASSWORD} characters`}
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
        />
        <PasswordStrength password={password} />
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 pt-1 text-[12.5px] leading-relaxed text-slate-600">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 accent-[#E5199B]"
        />
        <span>
          I agree to the{" "}
          <Link href="/terms" className="font-semibold text-brand-magenta hover:underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="font-semibold text-brand-magenta hover:underline">
            Privacy Policy
          </Link>
        </span>
      </label>

      {error && (
        <p
          role="alert"
          className="rounded-btn bg-alert-red/[0.08] px-3 py-2 text-[12.5px] font-medium text-[#C93B3B]"
        >
          {error}
        </p>
      )}

      <div className="pt-1.5">
        <GradientButton type="submit" disabled={!canSubmit}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
              Creating account&hellip;
            </>
          ) : (
            "Create Account"
          )}
        </GradientButton>
      </div>
    </form>
  );
}
