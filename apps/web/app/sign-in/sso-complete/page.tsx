import type { Metadata } from "next";
import { SsoComplete } from "@/components/auth/sso-return";

export const metadata: Metadata = { title: "Signing In · Appsgain" };

/**
 * Feature List §1 — Authentication. Every Google or Microsoft sign-in ends here: the Clerk
 * token is traded for an Appsgain session, a workspace choice or a sign-up. See sso-return.tsx.
 */
export default function SsoCompletePage() {
  return <SsoComplete />;
}
