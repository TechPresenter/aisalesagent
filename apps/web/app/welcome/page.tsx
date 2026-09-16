import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BarChart3, PhoneCall, Target, Users, type LucideIcon } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { appBrand } from "@/config/app-brand";
import { TONE_HEX, type Tone } from "@/lib/status";

export const metadata: Metadata = { title: `${appBrand.name} · AI Sales Agent` };

const HIGHLIGHTS: { label: string; icon: LucideIcon; tone: Tone }[] = [
  { label: "AI Calling 24/7", icon: PhoneCall, tone: "blue" },
  { label: "Smart Lead Management", icon: Users, tone: "purple" },
  { label: "Real-time Insights", icon: BarChart3, tone: "green" },
  { label: "Better Conversions", icon: Target, tone: "red" },
];

/** The entry screen — the one surface that sells before it asks for anything. */
export default function WelcomePage() {
  return (
    <div className="relative w-full max-w-[440px] overflow-hidden rounded-card border border-slate-200/70 bg-surface shadow-card">
      {/* The soft wash is on the card here rather than the page, so the hero reads as a
          single panel the way the app's first screen should. */}
      <div className="brand-wash px-6 pb-7 pt-8 sm:px-8">
        <Logo size="md" />

        <h1 className="mt-7 text-[32px] font-bold leading-[1.15] tracking-tight text-brand-navy">
          Smarter Business Growth with{" "}
          <span className="brand-gradient-text">AI</span>
        </h1>
        <p className="mt-3 max-w-[300px] text-[14px] leading-relaxed text-slate-500">
          Automate calls, manage leads and close more deals with AI-powered solutions.
        </p>

        <ul className="mt-6 space-y-3">
          {HIGHLIGHTS.map(({ label, icon: Icon, tone }) => (
            <li key={label} className="flex items-center gap-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: `${TONE_HEX[tone]}1F` }}
              >
                <Icon
                  className="h-[18px] w-[18px]"
                  strokeWidth={1.9}
                  style={{ color: TONE_HEX[tone] }}
                />
              </span>
              <span className="text-[13.5px] font-medium text-brand-navy">{label}</span>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex items-end justify-between gap-4">
          <p className="text-[15px] font-bold leading-tight text-brand-navy">
            AI Powered.
            <br />
            People Driven.
          </p>
          <Link
            href="/sign-in"
            aria-label="Continue to sign in"
            className="brand-gradient flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-opacity hover:opacity-95"
          >
            <ArrowRight className="h-5 w-5" strokeWidth={2.4} />
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-slate-100 px-6 py-4 sm:px-8">
        <span className="flex items-center gap-1.5" aria-hidden>
          <span className="h-1.5 w-6 rounded-full bg-brand-magenta" />
          <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
          <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        </span>
        <Link href="/sign-in" className="text-[13px] font-semibold text-slate-500 hover:underline">
          Skip
        </Link>
      </div>
    </div>
  );
}
