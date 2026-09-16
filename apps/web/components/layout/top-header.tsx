"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, LogOut, Menu, Search, Settings } from "lucide-react";
import { DropdownMenu, MenuItem, MenuLink, MenuSeparator } from "@/components/ui/dropdown-menu";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { authApi, callsApi } from "@/lib/api-client";
import { useSessionUser } from "@/lib/use-session";
import { cn, initialsOf } from "@/lib/utils";

/** How often the calling status and the follow-up count are re-read. */
const POLL_MS = 30_000;

/** "MANAGER" -> "Manager". */
function roleLabel(role: string | undefined): string {
  return role ? role.charAt(0) + role.slice(1).toLowerCase() : "";
}

/**
 * Brand Guidelines §5 (Layout): 72px, white, global search, live-agent status pill,
 * notifications, account menu.
 *
 * Everything here is live: the name is the signed-in user's, the status pill is the
 * workspace's calling switch and in-flight count, the bell is the notification list, and
 * the search box searches leads. Phase 6 can swap the polling for the WebSocket channel
 * without touching the layout.
 */
export function TopHeader({ onMenuClick }: { onMenuClick: () => void }) {
  const router = useRouter();
  const { user } = useSessionUser();
  const [query, setQuery] = useState("");
  const [calling, setCalling] = useState<{ enabled: boolean; inFlight: number } | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    // No session, no requests: a 401 here would bounce a page that is about to redirect
    // to sign-in anyway.
    if (!user) return;
    let cancelled = false;

    const read = () => {
      callsApi.overview().then(
        (overview) => {
          if (!cancelled) setCalling({ enabled: overview.callingEnabled, inFlight: overview.inFlight });
        },
        () => {
          if (!cancelled) setCalling(null);
        },
      );
    };

    read();
    const timer = window.setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [user]);

  async function signOut() {
    setSigningOut(true);
    await authApi.logout();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 flex h-header shrink-0 items-center gap-3 border-b border-slate-200 bg-surface px-4 sm:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Toggle navigation"
        className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-brand-navy transition-colors hover:bg-slate-100 lg:hidden"
      >
        <Menu className="h-5 w-5" strokeWidth={1.9} />
      </button>

      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const term = query.trim();
          router.push(term ? `/leads?search=${encodeURIComponent(term)}` : "/leads");
        }}
        className="relative min-w-0 flex-1 sm:max-w-md"
      >
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          strokeWidth={1.9}
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search leads by name, phone or city..."
          aria-label="Search leads"
          className="h-10 w-full rounded-btn border border-slate-200 bg-slate-50/70 pl-10 pr-3 text-[13px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand-green/20"
        />
      </form>

      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-4">
        {/* Live status pill: the ring animates outward only while calling is switched on,
            so "running" is legible at a glance and "off" does not pretend otherwise. */}
        {calling && (
          <Link href="/ai-calling" className="hidden items-center gap-2.5 md:flex">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              {calling.enabled && (
                <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-brand-green" />
              )}
              <span
                className={cn(
                  "relative inline-flex h-2.5 w-2.5 rounded-full",
                  calling.enabled ? "bg-brand-green" : "bg-slate-300",
                )}
              />
            </span>
            <span className="leading-tight">
              <span
                className={cn(
                  "block text-[13px] font-semibold",
                  calling.enabled ? "text-brand-green" : "text-slate-500",
                )}
              >
                {calling.enabled ? "AI Calling On" : "AI Calling Off"}
              </span>
              <span className="tabular block text-[11px] text-slate-500">
                {calling.inFlight} {calling.inFlight === 1 ? "call" : "calls"} in progress
              </span>
            </span>
          </Link>
        )}

        <NotificationsBell />

        <DropdownMenu
          trigger={
            <button
              type="button"
              aria-label="Account menu"
              className="flex items-center gap-2.5 rounded-lg p-1 transition-colors hover:bg-slate-100"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-navy text-[12.5px] font-bold text-white">
                {user ? initialsOf(user.name) : ""}
              </span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-[13px] font-semibold text-brand-navy">
                  {user?.name ?? ""}
                </span>
                <span className="block text-[11px] text-slate-500">{roleLabel(user?.role)}</span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={2} />
            </button>
          }
          className="w-[240px]"
        >
          {user && (
            <div className="px-2.5 py-2">
              <p className="truncate text-[13px] font-semibold text-brand-navy">{user.name}</p>
              <p className="truncate text-[11.5px] text-slate-500">{user.email}</p>
              <p className="truncate text-[11.5px] text-slate-400">{user.tenantName}</p>
            </div>
          )}
          <MenuSeparator />
          <MenuLink href="/settings">
            <Settings className="h-4 w-4 text-slate-400" strokeWidth={2} />
            Settings
          </MenuLink>
          <MenuItem onSelect={() => void signOut()} danger>
            {signingOut ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : (
              <LogOut className="h-4 w-4" strokeWidth={2} />
            )}
            Sign out
          </MenuItem>
        </DropdownMenu>
      </div>
    </header>
  );
}
