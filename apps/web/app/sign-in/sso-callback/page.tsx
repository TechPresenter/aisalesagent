import type { Metadata } from "next";
import { SsoCallback } from "@/components/auth/sso-return";

export const metadata: Metadata = { title: "Signing In · Appsgain" };

/** Where Clerk returns when it still has a step of its own to finish. See sso-return.tsx. */
export default function SsoCallbackPage() {
  return <SsoCallback />;
}
