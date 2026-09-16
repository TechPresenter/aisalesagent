import {
  BarChart3,
  Bot,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  FileText,
  History,
  LayoutDashboard,
  Mic,
  Megaphone,
  PhoneCall,
  Search,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

/** Build Plan Phase 3 fixes both the order and the labels of the sidebar. */
export const navItems: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Leads", href: "/leads", icon: Users },
  { label: "Find Leads (AI)", href: "/find-leads", icon: Search },
  { label: "Campaigns", href: "/campaigns", icon: Megaphone },
  { label: "AI Calling", href: "/ai-calling", icon: PhoneCall },
  { label: "Call History", href: "/call-history", icon: History },
  { label: "Recordings", href: "/recordings", icon: Mic },
  { label: "Transcripts", href: "/transcripts", icon: FileText },
  { label: "Sales Notes", href: "/sales-notes", icon: ClipboardList },
  { label: "Follow-ups", href: "/follow-ups", icon: CalendarCheck },
  { label: "Calendar", href: "/calendar", icon: CalendarDays },
  { label: "AI Agents", href: "/agents", icon: Bot },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
  { label: "Settings", href: "/settings", icon: Settings },
];

/**
 * Routes that render outside the dashboard chrome — no sidebar, no top header. Kept here
 * beside `navItems` so the two lists of "what routes exist" sit together, and read by
 * `AppShell` to decide which frame to draw.
 */
export const AUTH_ROUTES = [
  "/welcome",
  "/sign-in",
  "/sign-up",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/onboarding",
  "/terms",
  "/privacy",
] as const;

export function isAuthRoute(pathname: string) {
  return AUTH_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}
