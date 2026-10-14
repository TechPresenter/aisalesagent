"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Crown, Layers } from "lucide-react";
import { navItems } from "@/config/navigation";
import { appBrand } from "@/config/app-brand";
import { Logo } from "@/components/brand/logo";
import { creditsApi, type CreditWallet } from "@/lib/api-client";
import { useSessionUser } from "@/lib/use-session";
import { cn, formatNumber, initialsOf } from "@/lib/utils";

/**
 * Brand Guidelines §5 (Layout): fixed 240px, Brand Navy background, white/70% nav text,
 * active item marked with a Brand Green left-edge accent bar over a lighter navy fill.
 */
export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user, resolved } = useSessionUser();
  const [wallet, setWallet] = useState<CreditWallet | null>(null);

  useEffect(() => {
    if (!user) return;
    creditsApi.wallet().then(setWallet, () => setWallet(null));
  }, [user]);

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex w-sidebar flex-col bg-brand-navy transition-transform duration-200 lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full",
      )}
    >
      {/* The product lockup, as a SaaS dashboard normally carries — the tenant's own
          identity is on the workspace row below it. */}
      <Link
        href="/"
        onClick={onNavigate}
        aria-label={`${appBrand.name} — go to the dashboard`}
        className="flex h-header shrink-0 items-center px-4"
      >
        <Logo size="sm" onDark />
      </Link>

      <WorkspaceRow resolved={resolved} tenantName={user?.tenantName} />

      <nav className="scrollbar-thin mt-1 flex-1 overflow-y-auto px-3 pb-4">
        <ul className="space-y-0.5">
          {navItems.map(({ label, href, icon: Icon }) => {
            const active = pathname === href;
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium transition-colors",
                    active
                      ? "bg-white/[0.07] text-white"
                      : "text-white/65 hover:bg-white/[0.05] hover:text-white",
                  )}
                >
                  {active && (
                    <span className="absolute -left-3 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-green" />
                  )}
                  <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Feature List §13 — credit balance, pinned above the upgrade prompt. There is no
          allowance to measure it against yet, so it is a number, not a progress bar. */}
      <div className="shrink-0 space-y-3 p-3">
        <div className="rounded-xl bg-deep-green p-3.5">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-white/85" strokeWidth={1.9} />
            <span className="text-[13px] font-semibold text-white">Credits</span>
          </div>
          <p className="tabular mt-1 text-[12px] text-white/70">
            {wallet ? `${formatNumber(wallet.balance)} credits left` : "—"}
          </p>
          {wallet?.isLow && (
            <p className="mt-1 text-[11px] font-semibold text-warning-amber">Running low</p>
          )}
        </div>

        <div className="rounded-xl bg-white/[0.06] p-3.5">
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-warning-amber" strokeWidth={1.9} />
            <span className="text-[13px] font-semibold text-white">Upgrade Plan</span>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-white/55">
            Get more calls, AI features and advanced analytics.
          </p>
          <Link
            href="/plans"
            onClick={onNavigate}
            className="mt-3 flex h-9 items-center justify-center rounded-btn bg-brand-green text-[13px] font-semibold text-white transition-colors hover:bg-[#15A45D]"
          >
            View Plans
          </Link>
        </div>
      </div>
    </aside>
  );
}

/**
 * The signed-in workspace, under the product mark: its own name and initials on the
 * product green.
 *
 * The session is read after hydration (useSessionUser), so the first frame has no
 * workspace to show. It gets a neutral placeholder of the same size rather than a stand-in
 * name: a default would flash some other company's identity at every customer on every
 * page load, which is what the old demo branding here did. Once the session is read and
 * holds no workspace name (signed out, or a session cached before names were), the row is
 * left out rather than left loading forever. Per-workspace colours and logos arrive with
 * the branding settings; until then every workspace wears the product green.
 *
 * Exported for its tests.
 */
export function WorkspaceRow({
  resolved,
  tenantName,
}: {
  resolved: boolean;
  tenantName?: string;
}) {
  const name = tenantName?.trim();

  if (!name) {
    if (resolved) return null;
    return (
      <div
        aria-busy="true"
        className="mx-3 mb-1 flex items-center gap-2.5 rounded-lg bg-white/[0.05] px-2.5 py-2"
      >
        <span className="sr-only">Loading workspace</span>
        <span aria-hidden className="h-7 w-7 shrink-0 animate-pulse rounded-md bg-white/10" />
        <span aria-hidden className="flex h-[30px] min-w-0 flex-1 flex-col justify-center gap-2">
          <span className="block h-2.5 w-24 animate-pulse rounded bg-white/10" />
          <span className="block h-2 w-14 animate-pulse rounded bg-white/[0.07]" />
        </span>
      </div>
    );
  }

  return (
    <div className="mx-3 mb-1 flex items-center gap-2.5 rounded-lg bg-white/[0.05] px-2.5 py-2">
      <span
        aria-hidden
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-green text-[11.5px] font-bold text-white"
      >
        {initialsOf(name)}
      </span>
      <span className="min-w-0">
        <span
          className="block truncate text-[12.5px] font-semibold leading-tight text-white"
          title={name}
        >
          {name}
        </span>
        <span className="block truncate text-[9.5px] uppercase tracking-[0.09em] text-white/45">
          Workspace
        </span>
      </span>
    </div>
  );
}
