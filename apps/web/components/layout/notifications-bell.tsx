"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  CalendarCheck,
  CircleAlert,
  Download,
  Loader2,
  PhoneCall,
  PhoneOff,
  Sparkles,
  UserPlus,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { followUpsApi, notificationsApi, type AppNotification } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** How often the unread count is re-read while the bell is closed. */
const POLL_MS = 30_000;

const STYLE: Record<string, { icon: LucideIcon; tint: string }> = {
  NEW_LEAD: { icon: UserPlus, tint: "bg-accent-blue/[0.13] text-accent-blue" },
  INTERESTED_LEAD: { icon: Sparkles, tint: "bg-brand-green/[0.14] text-deep-green" },
  DEMO_BOOKED: { icon: CalendarCheck, tint: "bg-accent-purple/[0.13] text-accent-purple" },
  CALL_COMPLETED: { icon: PhoneCall, tint: "bg-accent-blue/[0.13] text-accent-blue" },
  CALL_FAILED: { icon: PhoneOff, tint: "bg-alert-red/[0.12] text-alert-red" },
  CREDITS_LOW: { icon: Wallet, tint: "bg-warning-amber/[0.18] text-[#B4761A]" },
  CREDITS_EXHAUSTED: { icon: CircleAlert, tint: "bg-alert-red/[0.12] text-alert-red" },
  FOLLOWUP_DUE: { icon: CalendarCheck, tint: "bg-accent-blue/[0.13] text-accent-blue" },
  FOLLOWUP_OVERDUE: { icon: CircleAlert, tint: "bg-alert-red/[0.12] text-alert-red" },
  EXPORT_READY: { icon: Download, tint: "bg-slate-100 text-slate-500" },
};

const FALLBACK_STYLE = { icon: CircleAlert, tint: "bg-slate-100 text-slate-500" };

/** "4 min ago", "3 h ago", "2 d ago" — short, because the row is narrow. */
function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} d ago`;
}

/**
 * The header bell.
 *
 * The badge is the unread count from `GET /notifications/unread-count`, polled on a timer
 * — a small query with its own index, rather than fetching the whole list to count it.
 * The list is only fetched when the panel is opened, which is the only time it is read.
 *
 * Follow-ups due today sit in the footer rather than in the list: they are a standing
 * state of the queue, not an event that happened, and mixing the two would mean a line
 * that cannot be marked read.
 */
export function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [due, setDue] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const readCount = useCallback(() => {
    notificationsApi.unreadCount().then(
      (count) => {
        setUnread(count);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);

  useEffect(() => {
    readCount();
    const timer = window.setInterval(readCount, POLL_MS);
    return () => window.clearInterval(timer);
  }, [readCount]);

  // The list is what the panel shows, so it is read when the panel opens.
  useEffect(() => {
    if (!open) return;

    notificationsApi.list({ limit: 15 }).then(
      (rows) => {
        setItems(rows);
        setFailed(false);
      },
      () => {
        setItems([]);
        setFailed(true);
      },
    );
    followUpsApi.stats().then(
      (stats) => setDue(stats.today + stats.overdue),
      () => setDue(null),
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function openNotification(notification: AppNotification) {
    setOpen(false);

    if (!notification.read) {
      // Marked read here rather than after the navigation: the panel is about to close,
      // and a read receipt that depends on the next page loading would often be lost.
      setItems((rows) =>
        (rows ?? []).map((row) => (row.id === notification.id ? { ...row, read: true } : row)),
      );
      setUnread((count) => Math.max(0, count - 1));
      await notificationsApi.markRead(notification.id).catch(() => undefined);
    }

    if (notification.linkPath) router.push(notification.linkPath);
  }

  async function markAllRead() {
    setItems((rows) => (rows ?? []).map((row) => ({ ...row, read: true })));
    setUnread(0);
    await notificationsApi.markAllRead().catch(() => undefined);
    readCount();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((shown) => !shown)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-brand-navy transition-colors hover:bg-slate-100"
      >
        <Bell className="h-[19px] w-[19px]" strokeWidth={1.85} />
        {unread > 0 && (
          <span className="tabular absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-alert-red px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full z-50 mt-1.5 w-[340px] overflow-hidden rounded-card border border-slate-200 bg-surface shadow-card sm:w-[380px]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <h2 className="text-[14px] font-bold text-brand-navy">Notifications</h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-[12px] font-semibold text-accent-blue hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="scrollbar-thin max-h-[380px] overflow-y-auto">
            {items === null ? (
              <p className="flex items-center justify-center gap-2 px-4 py-10 text-[13px] text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
                Loading…
              </p>
            ) : failed ? (
              <p className="px-4 py-10 text-center text-[13px] text-slate-500">
                Could not load your notifications.
              </p>
            ) : items.length === 0 ? (
              <p className="px-6 py-10 text-center text-[13px] leading-relaxed text-slate-500">
                Nothing yet. Finished calls, new leads and credit warnings show up here.
              </p>
            ) : (
              <ul>
                {items.map((notification) => {
                  const { icon: Icon, tint } = STYLE[notification.type] ?? FALLBACK_STYLE;
                  return (
                    <li key={notification.id}>
                      <button
                        type="button"
                        onClick={() => void openNotification(notification)}
                        className={cn(
                          "flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-50",
                          !notification.read && "bg-accent-blue/[0.04]",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                            tint,
                          )}
                        >
                          <Icon className="h-4 w-4" strokeWidth={2} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span
                              className={cn(
                                "truncate text-[13px] text-brand-navy",
                                notification.read ? "font-medium" : "font-bold",
                              )}
                            >
                              {notification.title}
                            </span>
                            <span className="tabular shrink-0 text-[11px] text-slate-400">
                              {timeAgo(notification.createdAt)}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[12px] leading-relaxed text-slate-500">
                            {notification.body}
                          </span>
                        </span>
                        {!notification.read && (
                          <span
                            aria-label="Unread"
                            className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent-blue"
                          />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <Link
            href="/follow-ups"
            onClick={() => setOpen(false)}
            className="flex items-center justify-between gap-2 bg-slate-50/70 px-4 py-3 text-[12.5px] font-semibold text-accent-blue hover:bg-slate-100"
          >
            Follow-ups
            <span className="tabular text-[12px] font-medium text-slate-500">
              {due === null ? "" : due === 0 ? "none due" : `${due} due`}
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
