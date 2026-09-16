"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Eye, EyeOff, Globe, Lock, Mail, Phone, User } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

/**
 * The pieces every auth screen is built from. Extracted because ten screens repeat the
 * same card, the same field chrome and the same gradient CTA, and a sign-in form that
 * sits two pixels off the sign-up form is the kind of thing nobody notices on one screen
 * and everybody notices moving between them.
 */

/** The card the whole flow lives in: logo, optional back arrow, title, then the form. */
export function AuthCard({
  title,
  subtitle,
  backHref,
  children,
  footer,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  /** Omitted on the entry screens, which have nowhere to go back to. */
  backHref?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative w-full rounded-card border border-slate-200/70 bg-surface p-6 shadow-card sm:p-8",
        wide ? "max-w-[520px]" : "max-w-[440px]",
      )}
    >
      {backHref && (
        <Link
          href={backHref}
          aria-label="Go back"
          className="absolute left-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-brand-navy sm:left-5 sm:top-5"
        >
          <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </Link>
      )}

      <div className="flex justify-center">
        <Logo size="md" />
      </div>

      <h1 className="mt-6 text-center text-[24px] font-bold tracking-tight text-brand-navy">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-1.5 text-center text-[13.5px] leading-relaxed text-slate-500">
          {subtitle}
        </p>
      )}

      <div className="mt-6">{children}</div>

      {footer && <div className="mt-5 text-center text-[13px] text-slate-500">{footer}</div>}
    </div>
  );
}

/**
 * Icons are named rather than passed in, because the auth pages are server components
 * and a function prop cannot cross into a client one. Same shape as the icon maps in
 * `analytics-view` and `plans-view`.
 */
const FIELD_ICON = {
  mail: Mail,
  lock: Lock,
  user: User,
  phone: Phone,
  building: Building2,
  globe: Globe,
} as const;

export type FieldIcon = keyof typeof FIELD_ICON;

/**
 * A text field with its label sitting inside the box, above the value — the floating
 * style the reference uses. The icon is decorative; the label is the accessible name.
 */
export function Field({
  label,
  icon,
  type = "text",
  defaultValue,
  placeholder,
  autoComplete,
  value,
  onChange,
}: {
  label: string;
  icon: FieldIcon;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
  autoComplete?: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const Icon = FIELD_ICON[icon];
  const isPassword = type === "password";
  const inputType = isPassword && revealed ? "text" : type;

  return (
    <div className="relative rounded-btn border border-slate-200 bg-surface transition-colors focus-within:border-brand-magenta focus-within:ring-2 focus-within:ring-brand-magenta/20">
      <Icon
        className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400"
        strokeWidth={1.9}
        aria-hidden
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-11 top-1.5 text-[10.5px] font-medium text-slate-400"
      >
        {label}
      </label>
      <input
        id={id}
        type={inputType}
        defaultValue={defaultValue}
        value={value}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={cn(
          "h-[58px] w-full rounded-btn bg-transparent pl-11 pt-4 text-[14px] text-brand-navy placeholder:text-slate-400 focus:outline-none",
          isPassword ? "pr-11" : "pr-3.5",
        )}
      />
      {isPassword && (
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          aria-label={revealed ? "Hide password" : "Show password"}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-navy"
        >
          {revealed ? (
            <EyeOff className="h-[18px] w-[18px]" strokeWidth={1.9} />
          ) : (
            <Eye className="h-[18px] w-[18px]" strokeWidth={1.9} />
          )}
        </button>
      )}
    </div>
  );
}

/** The primary CTA — the brand gradient, full width, on every screen in the flow. */
export function GradientButton({
  children,
  href,
  onClick,
  type = "button",
  disabled,
  className,
}: {
  children: React.ReactNode;
  /** Renders as a link when given, which is what the mocked flow does between steps. */
  href?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  const classes = cn(
    "brand-gradient flex h-12 w-full items-center justify-center gap-2 rounded-btn text-[15px] font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-50",
    className,
  );

  if (href && !disabled) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} onClick={onClick} disabled={disabled} className={classes}>
      {children}
    </button>
  );
}

/** The muted secondary link under a form — "Don't have an account? Sign Up". */
export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-semibold text-brand-magenta hover:underline">
      {children}
    </Link>
  );
}

/**
 * The six-digit code input.
 *
 * Six separate boxes rather than one field, because that is what the design shows and
 * what people expect from an OTP — but typing, pasting a whole code, Backspace and the
 * arrow keys all have to keep working, which is the part a row of bare inputs gets
 * wrong. Each box advances on entry, Backspace steps back out of an empty box, and a
 * paste fills the row from wherever it lands.
 *
 * `onChange` takes an updater rather than a value, and that is load-bearing: focus moves
 * to the next box faster than React re-renders, so someone typing quickly — or a
 * password manager filling the row — lands the next keystroke while `value` is still the
 * previous array. Writing `[...value]` there silently drops the digit before it.
 */
export function OtpInput({
  length = 6,
  value,
  onChange,
}: {
  length?: number;
  value: string[];
  onChange: (update: (previous: string[]) => string[]) => void;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const focus = (index: number) => refs.current[index]?.focus();

  const setAt = (index: number, digit: string) => {
    onChange((previous) => {
      const next = [...previous];
      next[index] = digit;
      return next;
    });
  };

  return (
    <div className="flex justify-center gap-2.5">
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node;
          }}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={1}
          aria-label={`Digit ${index + 1} of ${length}`}
          value={value[index] ?? ""}
          onChange={(event) => {
            const digit = event.target.value.replace(/\D/g, "").slice(-1);
            setAt(index, digit);
            if (digit && index < length - 1) focus(index + 1);
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !value[index] && index > 0) {
              event.preventDefault();
              setAt(index - 1, "");
              focus(index - 1);
            }
            if (event.key === "ArrowLeft" && index > 0) focus(index - 1);
            if (event.key === "ArrowRight" && index < length - 1) focus(index + 1);
          }}
          onPaste={(event) => {
            event.preventDefault();
            const digits = event.clipboardData.getData("text").replace(/\D/g, "").split("");
            if (digits.length === 0) return;
            onChange((previous) => {
              const next = [...previous];
              digits.slice(0, length - index).forEach((digit, offset) => {
                next[index + offset] = digit;
              });
              return next;
            });
            focus(Math.min(index + digits.length, length - 1));
          }}
          className="tabular h-[52px] w-[46px] rounded-btn border border-slate-200 bg-surface text-center text-[20px] font-bold text-brand-navy transition-colors focus:border-brand-magenta focus:outline-none focus:ring-2 focus:ring-brand-magenta/20"
        />
      ))}
    </div>
  );
}

/**
 * Password strength, scored on the four things that actually change the answer: length,
 * mixed case, a digit and a symbol. Deliberately not a library — the meter's job here is
 * to tell someone their password is thin before they commit to it, and five bars driven
 * by four rules do that honestly. Real enforcement belongs on the server.
 */
export function passwordScore(password: string) {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return score;
}

const STRENGTH: { label: string; className: string }[] = [
  { label: "Too short", className: "bg-alert-red" },
  { label: "Weak", className: "bg-alert-red" },
  { label: "Fair", className: "bg-warning-amber" },
  { label: "Good", className: "bg-warning-amber" },
  { label: "Strong", className: "bg-brand-green" },
  { label: "Strong", className: "bg-brand-green" },
];

export function PasswordStrength({ password }: { password: string }) {
  const score = passwordScore(password);
  const { label, className } = STRENGTH[score];

  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex flex-1 gap-1.5" role="presentation">
        {Array.from({ length: 5 }, (_, index) => (
          <span
            key={index}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              index < score ? className : "bg-slate-200",
            )}
          />
        ))}
      </div>
      <span
        className={cn(
          "shrink-0 text-[11.5px] font-semibold",
          score >= 4 ? "text-brand-green" : score >= 2 ? "text-warning-amber" : "text-alert-red",
        )}
        // Announced rather than silent: the bars alone say nothing to a screen reader.
        role="status"
      >
        {password ? label : ""}
      </span>
    </div>
  );
}
