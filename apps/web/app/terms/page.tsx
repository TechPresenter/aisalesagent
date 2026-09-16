import type { Metadata } from "next";
import { AuthCard, AuthLink } from "@/components/auth/auth-ui";

export const metadata: Metadata = { title: "Terms of Service · Appsgain" };

/**
 * A placeholder, deliberately not a legal document.
 *
 * The sign-up form asks people to agree to terms and links here; a 404 under a checkbox
 * somebody has to tick is worse than a page that says plainly the terms are not written
 * yet. Replace this with the real agreement before the product is offered to anyone.
 */
export default function TermsPage() {
  return (
    <AuthCard
      title="Terms of Service"
      subtitle="Not published yet."
      backHref="/sign-up"
      footer={
        <>
          Back to <AuthLink href="/sign-up">create your account</AuthLink>
        </>
      }
    >
      <div className="space-y-3 text-[13.5px] leading-relaxed text-slate-600">
        <p>
          Appsgain has not published its terms of service yet. This page exists so the link on
          the sign-up form leads somewhere honest rather than to a missing page.
        </p>
        <p>
          Ask whoever set up your workspace for the agreement that applies to you before relying
          on this service.
        </p>
      </div>
    </AuthCard>
  );
}
