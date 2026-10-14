"use client";

import { useEffect, useState } from "react";
import { useAuth, useClerk, useSignIn } from "@clerk/react";
import { Loader2 } from "lucide-react";
import {
  rememberSsoStart,
  spendSsoStart,
  SSO_CALLBACK_PATH,
  SSO_COMPLETE_PATH,
  SSO_ENABLED,
  SSO_PROVIDERS,
  takeSsoError,
  type SsoOrigin,
  type SsoProvider,
} from "@/lib/sso-flow";

/** How long Clerk may take to load and start the redirect before the press counts as failed. */
const CLERK_WAIT_MS = 20_000;

/**
 * "Or continue with" and the Google and Microsoft buttons, on sign-in and sign-up.
 *
 * TRD §5 lists Google and Microsoft SSO. Clerk runs the redirect (lib/sso-flow.ts has the
 * whole round trip); without NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY the buttons stay disabled,
 * because a sign-in button that does nothing when pressed reads as a broken page, not as
 * a feature still to come.
 *
 * A failed attempt comes back here with its reason (failSso), shown above the buttons,
 * which are usable again straight away.
 *
 * `workspace` is what the sign-in form's workspace field holds when the button is pressed:
 * an address with accounts in several workspaces then goes straight to that one rather
 * than to a list.
 */
export function SsoOptions({
  origin,
  label = "Or continue with",
  workspace,
}: {
  origin: SsoOrigin;
  label?: string;
  workspace?: string;
}) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Only ever set, never cleared, here: React runs this twice in development, and the
    // second run finds the message already taken.
    const message = takeSsoError();
    if (message) setError(message);
  }, []);

  return (
    <>
      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
          {label}
        </span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      {error && (
        <p
          role="alert"
          className="mb-3 rounded-btn bg-alert-red/[0.08] px-3 py-2 text-[12.5px] font-medium text-[#C93B3B]"
        >
          {error}
        </p>
      )}

      {SSO_ENABLED ? (
        <ClerkSsoButtons origin={origin} workspace={workspace} onError={setError} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {(["google", "microsoft"] as const).map((provider) => (
            <SsoButton
              key={provider}
              provider={provider}
              disabled
              title={`${SSO_PROVIDERS[provider].label} sign-in is not set up yet.`}
            />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * The live buttons. A separate component so the Clerk hooks are only ever called inside
 * ClerkBoundary's provider, which exists only when the key does.
 */
function ClerkSsoButtons({
  origin,
  workspace,
  onError,
}: {
  origin: SsoOrigin;
  workspace?: string;
  onError: (message: string | null) => void;
}) {
  const clerk = useClerk();
  const { signIn } = useSignIn();
  // Pending sessions count: one left half-way through a Clerk step is just as much in the way.
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const [pending, setPending] = useState<SsoProvider | null>(null);

  // The only Clerk session Appsgain ever wants is the one between the redirect and
  // /sign-in/sso-complete, which ends it. One still here was left by an attempt that never
  // got that far (a closed tab, a dropped connection), and Clerk refuses to start a new
  // sign-in while it exists. Ending it without the usual redirect keeps the person here.
  useEffect(() => {
    if (isLoaded && isSignedIn && !pending) {
      void clerk.signOut(() => undefined).catch(() => undefined);
    }
  }, [clerk, isLoaded, isSignedIn, pending]);

  // On the page that starts a flow, any flow this tab started before is over: abandoned
  // half-way, or failed. Left in place, it would let a return page opened later in this
  // tab go on as if the person had just pressed the button.
  useEffect(() => spendSsoStart(), []);

  // Back from Google's page, the browser may restore this one from its cache, spinner and
  // all; the buttons have to work again, and the flow that left from here is abandoned.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      spendSsoStart();
      setPending(null);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  async function start(provider: SsoProvider) {
    if (pending) return;
    onError(null);
    setPending(provider);
    rememberSsoStart({ provider, origin, workspace });

    const failed = () => {
      spendSsoStart();
      onError(`Could not open ${SSO_PROVIDERS[provider].label} sign-in. Try again in a moment.`);
      setPending(null);
    };

    // Clerk's script never arrived (a blocked network, an over-eager extension).
    if (clerk.status === "error") {
      failed();
      return;
    }

    try {
      // The API revokes each Clerk session it is handed, so one still showing here may
      // already be gone at Clerk and refuse to sign out. That is no reason not to go on:
      // a session that really is still there makes the redirect below fail instead.
      if (clerk.loaded && clerk.session) {
        await clerk.signOut(() => undefined).catch(() => undefined);
      }
      // Waits for Clerk to finish loading, then leaves for the provider. Clerk returns to
      // sso-complete when the account was already known to it, and to sso-callback when
      // it still has a step of its own to finish, such as a first-time sign-up. A Clerk
      // that never loads would leave this waiting for good, hence the time limit.
      const started = await Promise.race([
        signIn.sso({
          strategy: SSO_PROVIDERS[provider].strategy,
          redirectUrl: SSO_COMPLETE_PATH,
          redirectCallbackUrl: SSO_CALLBACK_PATH,
        }),
        new Promise<"timed-out">((resolve) =>
          setTimeout(() => resolve("timed-out"), CLERK_WAIT_MS),
        ),
      ]);
      if (started === "timed-out" || started.error) {
        console.error("[sso] Clerk could not start the redirect", started);
        failed();
      }
      // Otherwise the browser is already on its way to Google or Microsoft.
    } catch (cause) {
      console.error("[sso] Clerk could not start the redirect", cause);
      failed();
    }
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {(["google", "microsoft"] as const).map((provider) => (
        <SsoButton
          key={provider}
          provider={provider}
          busy={pending === provider}
          disabled={pending !== null}
          onClick={() => void start(provider)}
        />
      ))}
    </div>
  );
}

/**
 * The marks are drawn inline rather than fetched: both vendors' brand guidelines require
 * the exact logo, and a remote image that fails to load leaves an unlabelled button.
 */
function SsoButton({
  provider,
  disabled,
  busy = false,
  title,
  onClick,
}: {
  provider: SsoProvider;
  disabled?: boolean;
  busy?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  const { label } = SSO_PROVIDERS[provider];
  // Never clickable while switched off; merely waiting on the other button while a
  // redirect is under way, which keeps its colour.
  const off = disabled && !onClick;

  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      aria-busy={busy || undefined}
      aria-label={`Continue with ${label}`}
      className={
        off
          ? "flex h-12 cursor-not-allowed items-center justify-center gap-2.5 rounded-btn border border-slate-200 bg-surface text-[14px] font-semibold text-brand-navy opacity-60"
          : "flex h-12 items-center justify-center gap-2.5 rounded-btn border border-slate-200 bg-surface text-[14px] font-semibold text-brand-navy transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-wait"
      }
    >
      {busy ? (
        <Loader2
          className="h-[18px] w-[18px] animate-spin text-slate-400"
          strokeWidth={2.2}
          aria-hidden
        />
      ) : provider === "google" ? (
        <GoogleMark />
      ) : (
        <MicrosoftMark />
      )}
      {label}
    </button>
  );
}

function GoogleMark() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.1Z"
      />
      <path
        fill="#34A853"
        d="M24 46c6 0 11-2 14.6-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.6-3.9-12.4-9.1H4.3v5.7C7.9 41.1 15.4 46 24 46Z"
      />
      <path
        fill="#FBBC05"
        d="M11.6 28.1a13.2 13.2 0 0 1 0-8.2v-5.7H4.3a22 22 0 0 0 0 19.6l7.3-5.7Z"
      />
      <path
        fill="#EA4335"
        d="M24 9.5c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 2.9 30 1 24 1 15.4 1 7.9 5.9 4.3 13.2l7.3 5.7C13.4 13.4 18.2 9.5 24 9.5Z"
      />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg className="h-[17px] w-[17px]" viewBox="0 0 24 24" aria-hidden>
      <path fill="#F25022" d="M1 1h10.2v10.2H1z" />
      <path fill="#7FBA00" d="M12.8 1H23v10.2H12.8z" />
      <path fill="#00A4EF" d="M1 12.8h10.2V23H1z" />
      <path fill="#FFB900" d="M12.8 12.8H23V23H12.8z" />
    </svg>
  );
}
