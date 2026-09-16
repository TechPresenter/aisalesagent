"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { TopHeader } from "@/components/layout/top-header";
import { AuthShell } from "@/components/auth/auth-shell";
import { isAuthRoute } from "@/config/navigation";

/**
 * Sidebar is fixed at 240px from lg up and slides in as an overlay below that, so the
 * dashboard stays usable on a tablet without a second layout.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

  // Sign-in has no workspace to frame yet, so the auth flow gets its own shell. Decided
  // here rather than with an `app/(auth)` route group because that would mean moving
  // every dashboard route into a second group to take the sidebar off this one.
  if (isAuthRoute(pathname)) {
    return <AuthShell>{children}</AuthShell>;
  }

  return (
    <div className="min-h-screen">
      <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} />

      {navOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-30 bg-brand-navy/40 lg:hidden"
        />
      )}

      <div className="flex min-h-screen flex-col lg:pl-sidebar">
        <TopHeader onMenuClick={() => setNavOpen((v) => !v)} />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
