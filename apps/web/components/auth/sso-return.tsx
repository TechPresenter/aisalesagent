"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HandleSSOCallback, useAuth, useClerk, useSignIn, useSignUp } from "@clerk/react";
import { Building2, ChevronRight, CircleAlert, KeyRound, Loader2 } from "lucide-react";
import type {
  SsoSignedIn,
  SsoUnconfirmedAccount,
  SsoWorkspaceChoice,
  SsoWorkspaceOption,
} from "@appsgain/shared";
import { AuthCard, AuthLink, GradientButton } from "@/components/auth/auth-ui";
import { TwoFactorStep, useEnterApp } from "@/components/auth/sign-in-steps";
import { authApi, getAccessToken, type TwoFactorChallenge } from "@/lib/api-client";
import {
  endSsoFlow,
  failSso,
  readSsoStart,
  saveSsoSignup,
  spendSsoStart,
  SSO_COMPLETE_PATH,
  SSO_ENABLED,
  ssoErrorMessage,
  ssoOrigin,
  ssoOutcome,
  type SsoOutcome,
} from "@/lib/sso-flow";
import { formatDate } from "@/lib/utils";

/**
 * The two pages Clerk sends the browser back to after Google or Microsoft.
 *
 * - sso-callback finishes a step Clerk still has to take itself, chiefly turning a
 *   first-time visitor's sign-in into a Clerk sign-up. Clerk returns here only then.
 * - sso-complete is where every successful return ends up. It asks Clerk for a session
 *   token, trades it with the API for an Appsgain answer, and signs out of Clerk whatever
 *   that answer was: Appsgain's own session is the only one this app keeps.
 *
 * Both go on only for a flow this tab started (rememberSsoStart, when the button was
 * pressed). Without that, whatever Clerk session the browser holds is not one this person
 * just asked for — a link someone sent, or a sign-in left behind on a shared computer — and
 * trading it would sign them in as somebody else, or start a sign-up in somebody else's
 * name.
 *
 * Anything that goes wrong goes back to the page the person started from with the reason
 * (failSso), where the buttons work again.
 */

const NOT_COMPLETED =
  "Your Google or Microsoft sign-in could not be completed. Try again, or sign in with your email and password.";

/** How long a return may sit without a Clerk session before it counts as failed. */
const SESSION_WAIT_MS = 8_000;

/**
 * How long Clerk may take over its own step. Usually a second or two; a person working
 * through Clerk's bot check takes longer, so this is generous rather than tight.
 */
const CALLBACK_WAIT_MS = 90_000;

/** How long Clerk's sign-out may take before the person is let through anyway. */
const SIGN_OUT_WAIT_MS = 4_000;

export function SsoCallback() {
  return SSO_ENABLED ? <ClerkSsoCallback /> : <SsoUnavailable />;
}

export function SsoComplete() {
  return SSO_ENABLED ? <ClerkSsoComplete /> : <SsoUnavailable />;
}

/**
 * Clerk's part is over once its token has been read, or the flow has failed; this ends it
 * without a redirect. The API has usually revoked the session already, so a sign-out that
 * fails or hangs is not worth keeping the person waiting for.
 */
function useEndClerkSession(): () => Promise<void> {
  const clerk = useClerk();
  return async () => {
    await Promise.race([
      clerk.signOut(() => undefined).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, SIGN_OUT_WAIT_MS)),
    ]);
  };
}

function ClerkSsoCallback() {
  const router = useRouter();
  const clerk = useClerk();
  const endClerkSession = useEndClerkSession();
  const { errors: signInErrors } = useSignIn();
  const { errors: signUpErrors } = useSignUp();
  const slow = useAfter(15_000);
  const [ours, setOurs] = useState(false);
  const failed = useRef(false);
  // The latest errors, for the log: Clerk calls back from closures made several renders ago.
  const latest = { signIn: signInErrors?.raw ?? null, signUp: signUpErrors?.raw ?? null };
  const errors = useRef(latest);
  errors.current = latest;

  /**
   * Back to the start with the generic message. Why Clerk stopped is logged, because no
   * screen here can do anything about it — but whoever looks at the console can.
   */
  function fail(reason: string) {
    if (failed.current) return;
    failed.current = true;
    const client = clerk.client;
    console.error(`[sso] ${reason}`, {
      signIn: client?.signIn?.status ?? null,
      signUp: client?.signUp?.status ?? null,
      missingFields: client?.signUp?.missingFields ?? [],
      errors: errors.current,
    });
    void endClerkSession().then(() => router.replace(failSso(NOT_COMPLETED)));
  }

  useEffect(() => {
    if (readSsoStart()) setOurs(true);
    else fail("Return page reached without a flow started in this tab");
    // Once, on arrival; `fail` is stable for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When none of Clerk's outcomes arrives — a step this page has no branch for, or a
  // request that failed inside Clerk — the person is not left watching a spinner.
  useEffect(() => {
    const timer = setTimeout(
      () => fail("Clerk did not finish the return in time"),
      CALLBACK_WAIT_MS,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthCard title="Signing You In" subtitle="Just a moment while we finish signing you in.">
      <Working />
      {/* Clerk's own step. It renders only an empty slot for Clerk's older CAPTCHA; the
          newer sign-up challenge opens as a dialog over this card (see ClerkBoundary). */}
      {ours && (
        <HandleSSOCallback
          navigateToApp={({ session, decorateUrl }) => {
            // A session task is a Clerk-side requirement (an organisation to pick, say) set
            // in the Clerk dashboard. This app has no screens for those, and the API refuses
            // a session that still has one.
            if (session?.currentTask) {
              fail(`Clerk session has an unfinished task: ${session.currentTask.key}`);
              return;
            }
            const url = decorateUrl(SSO_COMPLETE_PATH);
            if (url.startsWith("http")) window.location.href = url;
            else router.replace(url);
          }}
          // Clerk wanting another factor or more sign-up details means the Clerk application
          // asks for more than Google or Microsoft provide; nothing on this page can supply it.
          navigateToSignIn={() => fail("Clerk asked for more to finish the sign-in")}
          navigateToSignUp={() => fail("Clerk asked for more to finish the sign-up")}
        />
      )}
      {slow && <TakingLong />}
    </AuthCard>
  );
}

type View =
  | { kind: "working" }
  | { kind: "two-factor"; challenge: TwoFactorChallenge; passwordCleared: boolean }
  | { kind: "choose-workspace"; choice: SsoWorkspaceChoice }
  | { kind: "password-cleared"; workspace: SsoWorkspaceOption | null };

function ClerkSsoComplete() {
  const router = useRouter();
  const enterApp = useEnterApp();
  const endClerkSession = useEndClerkSession();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [view, setView] = useState<View>({ kind: "working" });
  const started = useRef(false);
  // Clerk's script not loading at all, say. Every other path ends in a redirect or a view.
  const slow = useAfter(20_000);

  function fail(message: string) {
    router.replace(failSso(message));
  }

  /**
   * A session is stored. The notice about the account just taken over, when due, comes
   * first. The return page leaves history on the way in: Back from the dashboard should
   * not land on a page with nothing left to do.
   */
  function signedIn(passwordCleared: boolean, workspace: SsoWorkspaceOption | null = null) {
    endSsoFlow();
    if (passwordCleared) setView({ kind: "password-cleared", workspace });
    else enterApp("/", { replace: true });
  }

  /** Whatever `sso/clerk` or, after a pick, `sso/select` answered. */
  function act(outcome: SsoOutcome, picked: SsoWorkspaceOption | null = null) {
    switch (outcome.kind) {
      case "signup-required":
        // The token goes to the sign-up form through sessionStorage, never the address bar.
        saveSsoSignup(outcome.signup);
        router.replace("/sign-up");
        return;
      case "choose-workspace":
        setView({ kind: "choose-workspace", choice: outcome.choice });
        return;
      case "two-factor":
        setView({
          kind: "two-factor",
          challenge: outcome.challenge,
          passwordCleared: outcome.passwordCleared,
        });
        return;
      case "signed-in":
        signedIn(outcome.passwordCleared, picked);
    }
  }

  useEffect(() => {
    if (started.current) return;

    const start = readSsoStart();
    if (!start) {
      started.current = true;
      // Back to this page, or a reload, after the token was traded: the person is already
      // signed in here, and there is nothing to finish.
      if (getAccessToken()) {
        endSsoFlow();
        router.replace("/");
        return;
      }
      // Not a flow this tab started, so whatever Clerk session the browser holds is not
      // one this person just asked for. It is ended, never traded.
      void endClerkSession().then(() => fail(NOT_COMPLETED));
      return;
    }

    if (!isLoaded) return;

    // Arriving from sso-callback, Clerk can report "signed out" for a moment before the
    // session it has just made becomes current. Give it a few seconds before calling
    // this a failure.
    if (!isSignedIn) {
      const timer = setTimeout(() => {
        if (started.current) return;
        started.current = true;
        void endClerkSession().then(() => fail(NOT_COMPLETED));
      }, SESSION_WAIT_MS);
      return () => clearTimeout(timer);
    }

    started.current = true;
    void (async () => {
      let result;
      try {
        const token = await getToken();
        if (!token) throw new Error("Clerk returned no session token");
        // Spent before it is sent: the API ends this Clerk session whatever it answers, so
        // a reload from here on has nothing to resume.
        spendSsoStart();
        result = await authApi.signInWithClerk({
          token,
          ...(start.workspace ? { subdomain: start.workspace } : {}),
        });
      } catch (cause) {
        await endClerkSession();
        fail(ssoErrorMessage(cause));
        return;
      }
      await endClerkSession();
      act(ssoOutcome(result));
    })();
    // `started` makes this run once; the functions it calls are stable for that run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn]);

  if (view.kind === "two-factor") {
    return (
      <AuthCard title="Welcome Back" subtitle="Sign in to your account to continue">
        <TwoFactorStep
          challenge={view.challenge}
          onSignedIn={() => signedIn(view.passwordCleared)}
          onStartOver={() => router.replace(ssoOrigin())}
          expiredMessage="This sign-in has expired. Continue with Google or Microsoft again."
        />
      </AuthCard>
    );
  }

  if (view.kind === "choose-workspace") {
    return (
      <WorkspaceChooser
        choice={view.choice}
        onSignedIn={(result, picked) => act(ssoOutcome(result), picked)}
        onSignUpInstead={(signup) => act({ kind: "signup-required", signup })}
      />
    );
  }

  if (view.kind === "password-cleared") {
    return (
      <PasswordClearedNotice
        workspace={view.workspace}
        onContinue={() => enterApp("/", { replace: true })}
      />
    );
  }

  return (
    <AuthCard title="Signing You In" subtitle="Just a moment while we finish signing you in.">
      <Working />
      {slow && <TakingLong />}
    </AuthCard>
  );
}

/**
 * Where the verified address can go: several workspaces, or one whose account never
 * confirmed its email. Listing them is fine here — the person has just proved they own
 * the address — and the pick goes back with the short-lived selection token rather than
 * the Clerk one, which is already gone.
 *
 * A never-confirmed account is opened only after saying what opening it means, and with
 * what its creator set up around it: anyone can sign up with someone else's address, and
 * the person should be able to tell a workspace they made from one made to catch them.
 */
function WorkspaceChooser({
  choice,
  onSignedIn,
  onSignUpInstead,
}: {
  choice: SsoWorkspaceChoice;
  onSignedIn: (result: SsoSignedIn, picked: SsoWorkspaceOption) => void;
  onSignUpInstead: (signup: NonNullable<SsoWorkspaceChoice["signup"]>) => void;
}) {
  const [opening, setOpening] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<SsoWorkspaceOption | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(workspace: SsoWorkspaceOption) {
    if (opening) return;
    setOpening(workspace.subdomain);
    setError(null);
    try {
      onSignedIn(
        await authApi.selectSsoWorkspace({
          selectionToken: choice.selectionToken,
          subdomain: workspace.subdomain,
        }),
        workspace,
      );
    } catch (cause) {
      setError(ssoErrorMessage(cause));
      setOpening(null);
    }
  }

  const errorBox = error && (
    <p
      role="alert"
      className="mt-3.5 rounded-btn bg-alert-red/[0.08] px-3 py-2 text-[12.5px] font-medium text-[#C93B3B]"
    >
      {error}
    </p>
  );

  const signUpInstead = choice.signup && (
    <button
      type="button"
      onClick={() => onSignUpInstead(choice.signup!)}
      disabled={opening !== null}
      className="mt-3 w-full text-center text-[13px] font-semibold text-brand-magenta hover:underline disabled:opacity-60"
    >
      Create a workspace of my own instead
    </button>
  );

  if (confirming?.unconfirmed) {
    return (
      <AuthCard
        title="Is This Your Workspace?"
        subtitle={`${confirming.name} was set up with your email address on ${formatDate(
          confirming.unconfirmed.createdAt,
        )}, but the address was never confirmed.`}
      >
        <div className="rounded-lg bg-warning-amber/[0.12] p-3 text-[12.5px] leading-relaxed text-[#8A5A12]">
          <p className="flex items-start gap-2 font-semibold">
            <CircleAlert className="mt-px h-4 w-4 shrink-0" strokeWidth={2.2} />
            Open it only if you set it up yourself.
          </p>
          <p className="mt-1.5">
            Opening it stops the password and two-step verification it was set up with from working,
            and signs out everywhere else it is signed in. It has{" "}
            {setUpAround(confirming.unconfirmed)}. Anything you do not recognise can be removed
            under Settings &rarr; Team and Integrations.
          </p>
        </div>
        {errorBox}
        <div className="mt-4">
          <GradientButton onClick={() => void open(confirming)} disabled={opening !== null}>
            {opening ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
                Opening&hellip;
              </>
            ) : (
              "Yes, Open This Workspace"
            )}
          </GradientButton>
        </div>
        {signUpInstead}
        <button
          type="button"
          onClick={() => {
            setConfirming(null);
            setError(null);
          }}
          disabled={opening !== null}
          className="mt-2 w-full text-center text-[13px] font-semibold text-slate-500 hover:text-brand-navy disabled:opacity-60"
        >
          Back
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={choice.signup ? "Check This Workspace" : "Choose a Workspace"}
      subtitle={
        !choice.signup
          ? "Your email address belongs to more than one workspace. Pick the one to open."
          : choice.workspaces.length === 1
            ? "A workspace was set up with your email address, but the address was never confirmed."
            : "Workspaces were set up with your email address, but the address was never confirmed."
      }
      footer={
        <>
          Not the account you meant? <AuthLink href={ssoOrigin()}>Start over</AuthLink>
        </>
      }
    >
      <ul className="space-y-2.5">
        {choice.workspaces.map((workspace) => (
          <li key={workspace.subdomain}>
            <button
              type="button"
              onClick={() =>
                workspace.unconfirmed ? setConfirming(workspace) : void open(workspace)
              }
              disabled={opening !== null}
              className="flex w-full items-center gap-3 rounded-btn border border-slate-200 bg-surface px-3.5 py-3 text-left transition-colors hover:border-brand-magenta/40 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-magenta/[0.1]">
                <Building2
                  className="h-[18px] w-[18px] text-brand-magenta"
                  strokeWidth={2}
                  aria-hidden
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-brand-navy">
                  {workspace.name}
                </span>
                <span className="block truncate text-[12px] text-slate-500">
                  {workspace.unconfirmed ? (
                    <span className="font-semibold text-[#B4761A]">Email never confirmed</span>
                  ) : (
                    workspace.subdomain
                  )}
                </span>
              </span>
              {opening === workspace.subdomain ? (
                <Loader2
                  className="h-4 w-4 animate-spin text-slate-400"
                  strokeWidth={2.4}
                  aria-hidden
                />
              ) : (
                <ChevronRight className="h-4 w-4 text-slate-400" strokeWidth={2.2} aria-hidden />
              )}
            </button>
          </li>
        ))}
      </ul>

      {errorBox}
      {signUpInstead}
    </AuthCard>
  );
}

/** "2 other members, 1 pending invitation, no API keys and 1 webhook". */
function setUpAround(account: SsoUnconfirmedAccount): string {
  const count = (n: number, one: string, many: string) =>
    `${n === 0 ? "no" : n} ${n === 1 ? one : many}`;
  const parts = [
    count(account.otherMembers, "other member", "other members"),
    count(account.pendingInvitations, "pending invitation", "pending invitations"),
    count(account.apiKeys, "API key", "API keys"),
  ];
  return `${parts.join(", ")} and ${count(account.webhooks, "webhook", "webhooks")}`;
}

/**
 * The person has just taken over an account that had never confirmed its email. The API
 * has replaced the password and two-step verification its creator set up and ended their
 * sessions; the owner should know why their old password, if it was theirs, stopped
 * working, how to have one again, and what in the workspace to look over.
 */
function PasswordClearedNotice({
  workspace,
  onContinue,
}: {
  workspace: SsoWorkspaceOption | null;
  onContinue: () => void;
}) {
  const around = workspace?.unconfirmed;
  return (
    <AuthCard title="You're Signed In">
      <div className="flex flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-magenta/[0.1]">
          <KeyRound className="h-6 w-6 text-brand-magenta" strokeWidth={2} />
        </span>
        <p className="mt-3 text-[16px] font-bold text-brand-navy">Your old password was removed</p>
        <p className="mt-1.5 max-w-[340px] text-[13px] leading-relaxed text-slate-500">
          This account&apos;s email address had never been confirmed, so in case someone else set it
          up, the password and two-step verification it was created with no longer work, and its
          other sessions were signed out. Keep signing in with Google or Microsoft, or set a new
          password under Settings &rarr; Security.
        </p>
        {around && (
          <p className="mt-3 max-w-[340px] rounded-lg bg-slate-50 p-3 text-[12.5px] leading-relaxed text-slate-600">
            {workspace.name} has {setUpAround(around)}. Look them over under Settings &rarr; Team
            and Integrations, and remove any you do not recognise.
          </p>
        )}
      </div>
      <div className="mt-5">
        <GradientButton onClick={onContinue}>Continue</GradientButton>
      </div>
    </AuthCard>
  );
}

/** Someone reached a return page on a deployment built without the Clerk key. */
function SsoUnavailable() {
  return (
    <AuthCard title="Not Available" subtitle="Google and Microsoft sign-in is not set up here.">
      <GradientButton href="/sign-in">Sign In With Email</GradientButton>
    </AuthCard>
  );
}

function Working() {
  return (
    <div className="flex justify-center py-2" role="status" aria-label="Signing you in">
      <Loader2 className="h-7 w-7 animate-spin text-brand-magenta" strokeWidth={2.2} />
    </div>
  );
}

function TakingLong() {
  return (
    <p className="mt-4 text-center text-[13px] text-slate-500">
      This is taking longer than it should. <AuthLink href="/sign-in">Back to sign in</AuthLink>
    </p>
  );
}

/** True once `ms` have passed since mount. */
function useAfter(ms: number): boolean {
  const [passed, setPassed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setPassed(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return passed;
}
