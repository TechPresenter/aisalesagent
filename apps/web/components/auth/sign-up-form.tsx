"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Field, GradientButton, PasswordStrength } from "@/components/auth/auth-ui";
import { SsoOptions } from "@/components/auth/sso-buttons";
import type { SsoKnownAddress } from "@appsgain/shared";
import { ApiError, authApi, usersApi, workspaceApi } from "@/lib/api-client";
import { endSsoFlow, providerLabel, readSsoSignup, type PendingSsoSignup } from "@/lib/sso-flow";

/** The API's minimum (CreateWorkspaceDto). Checked here only to say so before submitting. */
const MIN_PASSWORD = 12;

/** Same rule as the API's SUBDOMAIN_PATTERN: 3–50 of a-z, 0-9 and "-", no edge hyphens. */
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;

/**
 * Where the address is known already, said before the person makes a second workspace by
 * mistake. The API only tells this to someone who has just proved they own the address.
 */
function knownAddressNote(known: SsoKnownAddress): string {
  return known.reason === "disabled"
    ? `Your account in ${known.workspace} has been turned off. Ask an admin there to turn it back on, or create a new workspace below.`
    : `You have been invited to ${known.workspace}. To join it, open the invitation email; this form creates a new workspace.`;
}

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
 * and put the typed password in the address bar. Now the owner is signed in first, then
 * sent to the verification code screen, which continues into the business step that
 * edits the workspace this request just created.
 *
 * After "Continue with Google / Microsoft" found no account for the address, the form
 * comes back in SSO mode (the sign-up token waits in sessionStorage, see sso-flow.ts):
 * name and email filled in from the provider, the email fixed because that is the address
 * the token was issued for, and no password, which the token stands in for. The request
 * then returns the owner already signed in with the email already confirmed, so the
 * verification screen is skipped. Someone who pressed the button on sign-in is told why
 * they are here, since they expected an account to exist.
 */
export function SignUpForm() {
  const router = useRouter();
  const [sso, setSso] = useState<PendingSsoSignup | null>(null);
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

  // Read after mount: sessionStorage does not exist on the server, and a form that
  // rendered differently there would not hydrate.
  useEffect(() => {
    const { signup, expired } = readSsoSignup();
    if (signup) {
      setSso(signup);
      setName((typed) => typed || signup.name || "");
      setEmail(signup.email);
    } else if (expired) {
      setError(
        "Your Google or Microsoft sign-up timed out. Continue with Google or Microsoft again, or sign up with a password.",
      );
    }
  }, []);

  function leaveSsoMode() {
    endSsoFlow();
    setSso(null);
    setEmail("");
  }

  const subdomain = customSubdomain ?? toSubdomain(company);
  const subdomainValid = SUBDOMAIN.test(subdomain);
  const canSubmit =
    name.trim().length >= 2 &&
    company.trim().length >= 2 &&
    subdomainValid &&
    email.trim() !== "" &&
    (sso !== null || password.length >= MIN_PASSWORD) &&
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
        // The token, never a password as well: the API refuses both together, even an
        // empty password, so the key is left out rather than sent blank.
        ...(sso
          ? { ownerEmail: sso.email, ssoToken: sso.signupToken }
          : { ownerEmail: email.trim(), ownerPassword: password }),
      });
      ownerId = created.owner.id;
    } catch (cause) {
      // 400 and 409 carry the reason ("Subdomain … is already taken"); so does the 503 a
      // server without Google and Microsoft sign-in answers an SSO sign-up. Anything else
      // is the server being unreachable, which the person can do something about.
      setError(
        cause instanceof ApiError && (cause.status < 500 || (sso !== null && cause.status === 503))
          ? cause.message
          : "Could not reach the server. Check that the API is running and try again.",
      );
      // A token past its fifteen minutes, or one already used to create a workspace, cannot
      // be retried; back to the ordinary form, where the buttons can fetch a fresh one or
      // sign in. A taken subdomain keeps it.
      if (
        sso &&
        cause instanceof ApiError &&
        ((cause.status === 400 && cause.message.includes("expired")) ||
          (cause.status === 409 && cause.message.includes("already uses this address")))
      ) {
        leaveSsoMode();
      }
      setSubmitting(false);
      return;
    }

    if (sso) {
      // Signed in by the request itself (workspaceApi.create stored the session).
      endSsoFlow();
    } else {
      try {
        await authApi.login({ subdomain, email: email.trim(), password });
      } catch {
        // The workspace exists; only the automatic sign-in failed. Sign-in will work.
        router.push("/sign-in");
        return;
      }
    }

    // The signup request has no phone field, so it is saved on the owner's own record.
    // Optional, and not worth failing a finished signup over.
    if (phone.trim()) {
      await usersApi.update(ownerId, { phone: phone.trim() }).catch(() => undefined);
    }

    // Google or Microsoft has already confirmed the address, so there is no code to send.
    router.push(sso ? "/onboarding/business" : "/verify-email?next=/onboarding/business");
    router.refresh();
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-3.5">
        {sso && (
          <div className="rounded-lg bg-slate-50 p-3 text-[12.5px] leading-relaxed text-slate-600">
            {sso.known ? (
              <p className="mb-1.5 font-medium text-brand-navy">{knownAddressNote(sso.known)}</p>
            ) : (
              sso.fromSignIn && (
                <p className="mb-1.5 font-medium text-brand-navy">
                  No Appsgain account uses {sso.email} yet. Create a workspace below, or{" "}
                  <Link
                    href="/sign-in"
                    onClick={() => endSsoFlow()}
                    className="font-semibold text-brand-magenta hover:underline"
                  >
                    go back to sign in
                  </Link>
                  .
                </p>
              )
            )}
            Signing up with your {providerLabel(sso.provider)} account,{" "}
            <span className="font-semibold text-brand-navy">{sso.email}</span>. Add your company
            details to finish; there is no password to choose now (you can set one later under
            Settings &rarr; Security).{" "}
            <button
              type="button"
              onClick={leaveSsoMode}
              className="font-semibold text-brand-magenta hover:underline"
            >
              Use a password instead
            </button>
          </div>
        )}
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
          readOnly={sso !== null}
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
        {!sso && (
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
        )}

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

      {!sso && <SsoOptions origin="/sign-up" label="Or sign up with" />}
    </>
  );
}
