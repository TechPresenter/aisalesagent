"use client";

import { useEffect, useLayoutEffect } from "react";
import { ClerkProvider } from "@clerk/react";
import { useRouter } from "next/navigation";
import { CLERK_PUBLISHABLE_KEY, dropForeignClerkClient } from "@/lib/sso-flow";

// Before anything here can render, and so before Clerk's script is even requested: Clerk
// reads its client from the address bar once, as it loads, and a client handed over in a
// link is somebody else's (see dropForeignClerkClient). This module is evaluated once per
// page load, which is exactly how often Clerk loads.
if (CLERK_PUBLISHABLE_KEY) dropForeignClerkClient();

/** A layout effect in the browser; on the server, where there is no layout, a no-op one. */
const useCommitEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Clerk, for the pages that need it and no others.
 *
 * Mounted by the /sign-in and /sign-up layouts only, which also cover the two pages Clerk
 * redirects back to (/sign-in/sso-callback and /sign-in/sso-complete). The dashboard never
 * loads Clerk's script: Clerk is only the broker for "Continue with Google / Microsoft",
 * and the signed-in app runs on Appsgain's own tokens.
 *
 * `@clerk/react` rather than `@clerk/nextjs` for the same reason. The Next.js SDK expects
 * `clerkMiddleware()` in middleware.ts, which here is the pre-release password gate, and
 * Clerk's server-side session is something this app never reads.
 *
 * - Clerk's UI script is left to load (no `prefetchUI={false}`), although these pages draw
 *   their own buttons: Clerk shows its "suspicious sign-up" challenge with it, on
 *   /sign-in/sso-callback, to a first-time visitor it is unsure about. Without it that
 *   person could never finish, and it loads after the page, so nobody waits for it.
 * - `polling={false}`: no background calls to Clerk every five minutes. The script stays
 *   in memory after an in-app move from sign-in to the dashboard, and with no Clerk
 *   session left there is nothing for it to keep in sync.
 * - `telemetry={false}`: Clerk is told who signed in and nothing about how the app is used.
 * - The router functions let Clerk's own navigations stay in-app rather than reload.
 *
 * Without a publishable key this renders its children unchanged, and the sign-in buttons
 * (SsoOptions) stay disabled, so no page here ever calls a Clerk hook outside a provider.
 */
export function ClerkBoundary({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  // Once more as React commits the page. Next's router notes the address when it starts
  // and writes it back into history as it hydrates; noted before the line at the top of
  // this file ran, that puts the parameter back. This runs straight after, in the same
  // commit, so Clerk — whose script is still on its way — finds the address clean.
  useCommitEffect(() => {
    if (CLERK_PUBLISHABLE_KEY) dropForeignClerkClient();
  }, []);

  if (!CLERK_PUBLISHABLE_KEY) return <>{children}</>;

  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      polling={false}
      telemetry={false}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      routerPush={(to) => router.push(to)}
      routerReplace={(to) => router.replace(to)}
    >
      {children}
    </ClerkProvider>
  );
}
