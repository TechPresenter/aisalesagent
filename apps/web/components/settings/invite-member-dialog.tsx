"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Info, Loader2 } from "lucide-react";
import type { Role } from "@appsgain/shared";
import { CopyButton } from "@/components/settings/integrations/shared";
import { Modal } from "@/components/ui/modal";
import { usersApi, type InvitationSent } from "@/lib/api-client";
import {
  ROLE_SUMMARY,
  defaultInviteRole,
  describeInviteOutcome,
  inviteErrorText,
  looksLikeEmail,
} from "@/lib/team-invites";
import { cn, formatDate } from "@/lib/utils";

const FIELD =
  "h-11 w-full rounded-btn border border-slate-200 px-3 text-[13.5px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25";

const SECONDARY =
  "h-10 rounded-btn border border-slate-200 px-4 text-[13.5px] font-semibold text-brand-navy transition-colors hover:bg-slate-50";

const PRIMARY =
  "inline-flex h-10 items-center gap-2 rounded-btn bg-brand-green px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#15A45D] disabled:bg-slate-200 disabled:text-slate-400";

/** "MANAGER" → "Manager". */
function roleLabel(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

/**
 * Settings → Team → Invite Member (Feature List §12, "invite members by email with a
 * pre-set role").
 *
 * The API creates the invitation, tries to email it, and hands the link back either way;
 * this dialog always shows that link once the invitation exists. Until the platform has a
 * mail provider that is how every invitation reaches anyone, so an email that did not go
 * is shown as a note about what to do next, not as a failure.
 *
 * `roles` comes from the inviter's own role (assignableRoles): the API refuses anything
 * above it, and SUPER_ADMIN is never on offer.
 */
export function InviteMemberDialog({
  open,
  roles,
  onClose,
  onInvited,
}: {
  open: boolean;
  roles: readonly Role[];
  onClose: () => void;
  /** After the API created (or replaced) an invitation, so the pending list can reload. */
  onInvited: (sent: InvitationSent) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<InvitationSent | null>(null);

  function reset() {
    setEmail("");
    setName("");
    setRole(defaultInviteRole(roles));
    setError(null);
    setSent(null);
  }

  // A fresh form every time the dialog opens.
  useEffect(() => {
    if (open) reset();
    // `roles` is derived from the session and only matters at the moment of opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const valid = looksLikeEmail(email) && role !== null && roles.includes(role);

  async function submit() {
    if (!valid || !role || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await usersApi.invite({
        email: email.trim(),
        name: name.trim() || undefined,
        role,
      });
      setSent(result);
      onInvited(result);
    } catch (cause) {
      // Already a member, a deactivated account, a role above the inviter's: the API
      // says which, and the form stays filled in so it can be corrected.
      setError(inviteErrorText(cause));
    } finally {
      setSaving(false);
    }
  }

  // Keyed, so moving from the form to the result is a fresh dialog: focus lands inside
  // it again instead of on the submit button that has just disappeared.
  if (sent) {
    return (
      <Modal
        key="result"
        open={open}
        onClose={onClose}
        size="sm"
        title="Invitation created"
        description={`${sent.invitation.email} joins as ${roleLabel(sent.invitation.role)} once they accept.`}
        footer={
          <>
            <button type="button" onClick={reset} className={SECONDARY}>
              Invite another
            </button>
            <button type="button" onClick={onClose} className={PRIMARY}>
              Done
            </button>
          </>
        }
      >
        <InvitationLink sent={sent} />
      </Modal>
    );
  }

  return (
    <Modal
      key="form"
      open={open}
      onClose={onClose}
      size="sm"
      title="Invite a team member"
      description="They choose their own password when they accept. The invitation lasts a week."
      footer={
        <>
          <button type="button" onClick={onClose} className={SECONDARY}>
            Cancel
          </button>
          <button
            type="submit"
            form="invite-member-form"
            disabled={!valid || saving}
            className={PRIMARY}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />}
            Create invitation
          </button>
        </>
      }
    >
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-btn bg-alert-red/[0.09] px-3 py-2 text-[12.5px] font-medium text-[#C93B3B]"
        >
          {error}
        </p>
      )}

      {roles.length === 0 ? (
        <p className="text-[13px] text-slate-500">Your role cannot invite teammates.</p>
      ) : (
        <form
          id="invite-member-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
              Email address<span className="ml-0.5 text-alert-red">*</span>
            </span>
            <input
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              className={FIELD}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
              Name <span className="text-slate-400">(optional)</span>
            </span>
            <input
              type="text"
              autoComplete="off"
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Pre-filled when they accept; they can change it"
              className={FIELD}
            />
          </label>

          <fieldset>
            <legend className="mb-1.5 block text-[12px] font-medium text-slate-500">Role</legend>
            <div className="space-y-2">
              {roles.map((option) => (
                <label
                  key={option}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-btn border px-3 py-2.5 transition-colors",
                    role === option
                      ? "border-brand-green bg-brand-green/[0.06]"
                      : "border-slate-200 hover:bg-slate-50",
                  )}
                >
                  <input
                    type="radio"
                    name="invite-role"
                    value={option}
                    checked={role === option}
                    onChange={() => setRole(option)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand-green"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-brand-navy">
                      {roleLabel(option)}
                    </span>
                    <span className="block text-[12px] text-slate-500">
                      {ROLE_SUMMARY[option as keyof typeof ROLE_SUMMARY]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11.5px] text-slate-400">
              You can invite people to your own role or below.
            </p>
          </fieldset>
        </form>
      )}
    </Modal>
  );
}

/**
 * The result of resending an invitation: a new link, the old one already dead. Same
 * presentation as a new invitation, so the person sees one thing for "here is the link".
 */
export function InvitationLinkDialog({
  sent,
  onClose,
}: {
  sent: InvitationSent | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={sent !== null}
      onClose={onClose}
      size="sm"
      title="New invitation link"
      description={
        sent ? `The earlier link for ${sent.invitation.email} no longer works.` : undefined
      }
      footer={
        <button type="button" onClick={onClose} className={PRIMARY}>
          Done
        </button>
      }
    >
      {sent && <InvitationLink sent={sent} />}
    </Modal>
  );
}

/** What happened to the email, then the link with a Copy button. */
function InvitationLink({ sent }: { sent: InvitationSent }) {
  const outcome = describeInviteOutcome(sent);
  return (
    <div className="space-y-3">
      <div
        role="status"
        className={cn(
          "flex items-start gap-2 rounded-lg p-3 text-[12.5px] leading-relaxed",
          outcome.tone === "ok"
            ? "bg-brand-green/[0.1] text-deep-green"
            : "bg-warning-amber/[0.12] text-[#8A5A12]",
        )}
      >
        {outcome.tone === "ok" ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} />
        ) : (
          <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} />
        )}
        <div className="min-w-0">
          <p className="font-medium">{outcome.headline}</p>
          {outcome.detail && <p className="mt-1 opacity-80">{outcome.detail}</p>}
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Invitation link</span>
        <div className="flex items-start gap-2">
          {/* Read-only and selected on focus, so it can still be copied by hand where the
              browser blocks the clipboard. */}
          <input
            type="text"
            readOnly
            value={sent.link}
            aria-label="Invitation link"
            onFocus={(event) => event.currentTarget.select()}
            className="h-9 min-w-0 flex-1 rounded-btn border border-slate-200 bg-slate-50 px-3 font-mono text-[12px] text-brand-navy focus:border-brand-green focus:outline-none"
          />
          <CopyButton value={sent.link} />
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-slate-400">
          Anyone with this link can join as {roleLabel(sent.invitation.role)}, so send it only to{" "}
          {sent.invitation.email}. It works once and expires on{" "}
          {formatDate(sent.invitation.expiresAt)}. Resending gives a new link and stops this one.
        </p>
      </div>
    </div>
  );
}
