"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  CreditCard,
  Crown,
  Loader2,
  Mail,
  Phone,
  Plug,
  Plus,
  Settings2,
  Shield,
  Trash2,
  Users,
  User,
} from "lucide-react";
import type { Role, TenantSummary } from "@appsgain/shared";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BillingTab } from "@/components/settings/billing-tab";
import { CallSettingsTab } from "@/components/settings/call-settings-tab";
import { ChangePasswordDialog } from "@/components/settings/change-password-dialog";
import { IntegrationsTab } from "@/components/settings/integrations-tab";
import {
  InvitationLinkDialog,
  InviteMemberDialog,
} from "@/components/settings/invite-member-dialog";
import { NotificationsTab } from "@/components/settings/notifications-tab";
import { SecurityTab } from "@/components/settings/security-tab";
import { appBrand } from "@/config/app-brand";
import {
  ApiError,
  creditsApi,
  updateSessionUser,
  usersApi,
  workspaceApi,
  type CreditWallet,
  type InvitationSent,
  type PendingInvitation,
  type SessionUser,
  type UserStatus,
  type WorkspaceMember,
} from "@/lib/api-client";
import {
  assignableRoles,
  canAssign,
  expiryLabel,
  workspaceDeletionMailto,
} from "@/lib/team-invites";
import { toRole, usePermission, useSessionUser } from "@/lib/use-session";
import { cn, formatDate, formatNumber, initialsOf } from "@/lib/utils";

const TABS = [
  { name: "Profile", icon: User },
  { name: "Team", icon: Users },
  { name: "Billing", icon: CreditCard },
  { name: "Integrations", icon: Plug },
  { name: "Call Settings", icon: Phone },
  { name: "Notifications", icon: Bell },
  { name: "Security", icon: Shield },
  { name: "General", icon: Settings2 },
] as const;

type TabName = (typeof TABS)[number]["name"];

type Notice = { tone: "ok" | "bad"; text: string };

/** What the settings page accepts in its query string. */
export interface SettingsQuery {
  /** "integrations", "call-settings"… — the tab to open. */
  tab?: string;
  /** Set by the OAuth callback: the provider that just connected. */
  connected?: string;
  /** Set by the OAuth callback when sign-in did not complete. */
  integration_error?: string;
}

/** "call-settings" → "Call Settings". Unknown values open the default tab. */
function tabFromQuery(value: string | undefined): TabName | undefined {
  if (!value) return undefined;
  const wanted = value.toLowerCase().replace(/[-_]/g, " ");
  return TABS.find((entry) => entry.name.toLowerCase() === wanted)?.name;
}

/** "google_calendar" → "Google Calendar". */
function providerName(provider: string): string {
  return provider
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** "MANAGER" -> "Manager", "ACTIVE" -> "Active". */
function titleCase(value: string | undefined): string {
  return value ? value.charAt(0) + value.slice(1).toLowerCase() : "—";
}

const STATUS_TONE: Record<UserStatus, "green" | "amber" | "gray"> = {
  ACTIVE: "green",
  INVITED: "amber",
  DISABLED: "gray",
};

/**
 * Feature List §14 — Settings.
 *
 * Everything shown is read from the API, and everything editable saves through an
 * endpoint that exists: your name and phone (`PATCH /users/:id`), a teammate's role and
 * access, invitations (`/users/invitations`). What the API cannot do yet is shown as
 * unavailable rather than as a form that would not save — buying credits — or handed to
 * support, which is how a workspace is deleted until that can be done safely in-app.
 */
export function SettingsView({ query = {} }: { query?: SettingsQuery }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabName>(() => tabFromQuery(query.tab) ?? "Profile");
  const { user } = useSessionUser();
  const canManageTeam = usePermission("team.manage") === true;
  const canManageSettings = usePermission("settings.manage") === true;
  const canManageCalling = usePermission("calling.manage") === true;
  const [changingPassword, setChangingPassword] = useState(false);
  // Stable: the dialog resets its fields whenever this changes.
  const closePasswordDialog = useCallback(() => setChangingPassword(false), []);
  // Bumped when a first password is set, so the Security tab reloads and offers 2FA.
  const [securityVersion, setSecurityVersion] = useState(0);
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [workspace, setWorkspace] = useState<TenantSummary | null | undefined>(undefined);
  const [wallet, setWallet] = useState<CreditWallet | null | undefined>(undefined);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Undefined while loading, null if the list could not be read.
  const [invitations, setInvitations] = useState<PendingInvitation[] | null | undefined>(undefined);
  const [inviting, setInviting] = useState(false);
  // A resend's fresh link, shown until the dialog is closed.
  const [resent, setResent] = useState<InvitationSent | null>(null);
  const actorRole = toRole(user?.role);
  // What this person may hand out, to an invitee or a teammate: their own role and below.
  const roles = useMemo(() => assignableRoles(actorRole), [actorRole]);
  // Stable, like closePasswordDialog: the dialogs' focus handling depends on them.
  const closeInvite = useCallback(() => setInviting(false), []);
  const closeResent = useCallback(() => setResent(null), []);

  const loadMembers = useCallback(() => {
    usersApi.list().then(setMembers, () => setMembers([]));
  }, []);

  const loadInvitations = useCallback(() => {
    usersApi.invitations().then(setInvitations, () => setInvitations(null));
  }, []);

  useEffect(() => {
    loadMembers();
    loadInvitations();
    workspaceApi.mine().then(setWorkspace, () => setWorkspace(null));
    creditsApi.wallet().then(setWallet, () => setWallet(null));
  }, [loadMembers, loadInvitations]);

  useEffect(() => {
    if (!notice) return;
    // Failures stay up longer: they usually carry something to read and act on.
    const timer = window.setTimeout(() => setNotice(null), notice.tone === "bad" ? 9000 : 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Arriving back from an OAuth sign-in: say how it went once, then drop the query so a
  // refresh does not announce it again.
  useEffect(() => {
    if (query.connected) {
      setNotice({ tone: "ok", text: `${providerName(query.connected)} connected.` });
    } else if (query.integration_error) {
      setNotice({ tone: "bad", text: query.integration_error });
    }
    if (query.connected || query.integration_error || query.tab) {
      router.replace("/settings", { scroll: false });
    }
    // Once, on arrival — the query is gone after the replace above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stable, because the integrations panels list them as effect dependencies.
  const noticeOk = useCallback((text: string) => setNotice({ tone: "ok", text }), []);
  const noticeBad = useCallback((text: string) => setNotice({ tone: "bad", text }), []);

  const done = (text: string) => {
    setNotice({ tone: "ok", text });
    loadMembers();
  };
  const fail = (cause: unknown, fallback: string) =>
    setNotice({ tone: "bad", text: cause instanceof ApiError ? cause.message : fallback });

  const me = members?.find((member) => member.id === user?.id) ?? null;

  return (
    <>
      <Card className="overflow-hidden">
        <div
          role="tablist"
          aria-label="Settings sections"
          className="scrollbar-thin flex gap-1 overflow-x-auto px-3"
        >
          {TABS.map(({ name, icon: Icon }) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
              className={cn(
                "flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-4 text-[13.5px] font-semibold transition-colors",
                tab === name
                  ? "border-accent-blue text-accent-blue"
                  : "border-transparent text-slate-500 hover:text-brand-navy",
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={2} />
              {name}
            </button>
          ))}
        </div>
      </Card>

      {notice && (
        <div
          role="status"
          className={cn(
            "mt-4 rounded-btn px-4 py-2.5 text-[13px] font-medium",
            notice.tone === "ok"
              ? "bg-brand-green/[0.1] text-deep-green"
              : "bg-alert-red/[0.09] text-[#C93B3B]",
          )}
        >
          {notice.text}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          {tab === "Profile" && (
            <ProfileCard
              me={me}
              fallback={user}
              loading={members === null}
              canEdit={canManageTeam}
              onSaved={(member) => {
                // The header shows the cached session name; keep it in step.
                updateSessionUser({ name: member.name });
                done("Profile saved.");
              }}
              onError={(cause) => fail(cause, "Could not save your profile.")}
              onChangePassword={() => setChangingPassword(true)}
            />
          )}

          {tab === "Team" && (
            <>
              <TeamCard
                members={members}
                selfId={user?.id}
                canManage={canManageTeam}
                roles={roles}
                onInvite={() => setInviting(true)}
                onChanged={done}
                onError={(cause) => fail(cause, "Could not update that member.")}
              />
              <InvitationsCard
                invitations={invitations}
                canManage={canManageTeam}
                actorRole={actorRole}
                onResent={(sent) => {
                  setResent(sent);
                  loadInvitations();
                }}
                onRevoked={(email) => {
                  setNotice({ tone: "ok", text: `The invitation to ${email} was withdrawn.` });
                  loadInvitations();
                }}
                onError={(cause) => {
                  fail(cause, "Could not update that invitation.");
                  // Someone may have accepted or withdrawn it meanwhile; show what is true now.
                  loadInvitations();
                }}
              />
            </>
          )}

          {tab === "Billing" && <BillingTab wallet={wallet} />}

          {tab === "Integrations" && <IntegrationsTab onSaved={noticeOk} onError={noticeBad} />}

          {tab === "Call Settings" && (
            <CallSettingsTab
              canManage={canManageCalling}
              onSaved={(message) => setNotice({ tone: "ok", text: message })}
              onError={(cause) => fail(cause, "Could not save the call settings.")}
            />
          )}

          {tab === "Notifications" && (
            <NotificationsTab
              onSaved={(message) => setNotice({ tone: "ok", text: message })}
              onError={(cause) => fail(cause, "Could not save your notification preferences.")}
            />
          )}

          {tab === "Security" && (
            <SecurityTab
              key={securityVersion}
              onChangePassword={() => setChangingPassword(true)}
            />
          )}

          {/* The workspace itself lives under General; Profile is about the person. */}
          {tab === "General" && (
            <CompanyCard
              workspace={workspace}
              canEdit={canManageSettings}
              onSaved={(next) => {
                setWorkspace(next);
                // The sidebar reads the workspace name from the cached session.
                updateSessionUser({ tenantName: next.name });
                setNotice({ tone: "ok", text: "Company details saved." });
              }}
              onError={(cause) => fail(cause, "Could not save the company details.")}
            />
          )}
        </div>

        <div className="space-y-4">
          <UsageCard wallet={wallet} />
          <TeamPreview members={members} onViewAll={() => setTab("Team")} />
          <DangerZone workspace={workspace} user={user} isOwner={actorRole === "OWNER"} />
        </div>
      </div>

      <InviteMemberDialog
        open={inviting}
        roles={roles}
        onClose={closeInvite}
        onInvited={loadInvitations}
      />
      <InvitationLinkDialog sent={resent} onClose={closeResent} />

      <ChangePasswordDialog
        open={changingPassword}
        onClose={closePasswordDialog}
        onPasswordSet={() => {
          setSecurityVersion((version) => version + 1);
          setNotice({
            tone: "ok",
            text: "Password set. You can sign in with it as well, and turn on two-factor authentication.",
          });
        }}
      />
    </>
  );
}

function ProfileCard({
  me,
  fallback,
  loading,
  canEdit,
  onSaved,
  onError,
  onChangePassword,
}: {
  me: WorkspaceMember | null;
  /** The session's copy, shown while the member list loads or if it cannot be read. */
  fallback: { name: string; email: string; role: string } | null;
  loading: boolean;
  canEdit: boolean;
  onSaved: (member: WorkspaceMember) => void;
  onError: (cause: unknown) => void;
  onChangePassword: () => void;
}) {
  const [name, setName] = useState(me?.name ?? "");
  const [phone, setPhone] = useState(me?.phone ?? "");
  const [saving, setSaving] = useState(false);

  // Reset to the saved values whenever the record is (re)loaded — after a save included.
  useEffect(() => {
    setName(me?.name ?? "");
    setPhone(me?.phone ?? "");
  }, [me]);

  const shownName = me?.name ?? fallback?.name ?? "";
  const email = me?.email ?? fallback?.email ?? "";
  const role = me?.role ?? fallback?.role;
  const editable = me !== null && canEdit;
  const dirty = me !== null && (name.trim() !== me.name || phone.trim() !== (me.phone ?? ""));
  const valid = name.trim().length >= 2;

  async function save() {
    if (!me || !dirty || !valid) return;
    setSaving(true);
    try {
      onSaved(await usersApi.update(me.id, { name: name.trim(), phone: phone.trim() }));
    } catch (cause) {
      onError(cause);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <CardTitle>Profile Information</CardTitle>
      <p className="mt-1 text-[13px] text-slate-500">
        Your name and contact details in this workspace.
      </p>

      <div className="mt-4 flex items-center gap-4">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-navy text-[20px] font-bold text-white">
          {shownName ? initialsOf(shownName) : ""}
        </span>
        <div className="min-w-0">
          <p className="text-[16px] font-bold text-brand-navy">
            {shownName || (loading ? "Loading…" : "—")}
          </p>
          <p className="text-[13px] text-slate-500">{titleCase(role)}</p>
          <p className="truncate text-[12.5px] text-slate-400">{email}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Full Name" required value={name} onChange={setName} disabled={!editable} />
        <TextField
          label="Email Address"
          value={email}
          disabled
          hint="Your sign-in address. It cannot be changed here."
        />
        <TextField
          label="Phone Number"
          type="tel"
          value={phone}
          onChange={setPhone}
          disabled={!editable}
          placeholder="+91 98765 43210"
        />
        <TextField
          label="Role"
          value={titleCase(role)}
          disabled
          hint="Roles are changed from the Team tab."
        />
      </div>

      {!editable && !loading && (
        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-[12.5px] text-slate-500">
          {me
            ? "Your role cannot edit profiles in this workspace."
            : "Your profile could not be loaded from the server."}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" className="h-11" onClick={onChangePassword}>
          Change Password
        </Button>
        <Button
          className="h-11 bg-accent-blue hover:bg-[#1B6CD8]"
          onClick={() => void save()}
          disabled={!editable || !dirty || !valid || saving}
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
          Save Changes
        </Button>
      </div>
    </Card>
  );
}

function CompanyCard({
  workspace,
  canEdit,
  onSaved,
  onError,
}: {
  workspace: TenantSummary | null | undefined;
  canEdit: boolean;
  onSaved: (workspace: TenantSummary) => void;
  onError: (cause: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(workspace?.name ?? "");
    setIndustry(workspace?.industryVertical ?? "");
  }, [workspace]);

  const editable = Boolean(workspace) && canEdit;
  const dirty =
    !!workspace &&
    (name.trim() !== workspace.name || industry.trim() !== (workspace.industryVertical ?? ""));
  const valid = name.trim().length >= 2;

  async function save() {
    if (!workspace || !dirty || !valid) return;
    setSaving(true);
    try {
      onSaved(
        await workspaceApi.update({ name: name.trim(), industryVertical: industry.trim() }),
      );
    } catch (cause) {
      onError(cause);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <CardTitle>Company Information</CardTitle>
      <p className="mt-1 text-[13px] text-slate-500">Your workspace as the platform knows it.</p>

      {workspace === undefined ? (
        <p className="mt-4 text-[13px] text-slate-400">Loading…</p>
      ) : workspace === null ? (
        <p className="mt-4 text-[13px] text-slate-500">Could not load the workspace.</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              label="Company Name"
              required
              value={name}
              onChange={setName}
              disabled={!editable}
            />
            <TextField
              label="Workspace"
              value={workspace.subdomain}
              disabled
              hint="The name people enter when they sign in. Changing it would lock them out, so it is fixed."
            />
            <TextField
              label="Industry"
              value={industry}
              onChange={setIndustry}
              disabled={!editable}
              placeholder="e.g. IT Services"
            />
            <TextField label="Created" value={formatDate(workspace.createdAt)} disabled />
          </div>

          <p className="mt-4 flex items-center gap-2 text-[12.5px] text-slate-500">
            Status
            <Badge tone={workspace.status === "ACTIVE" ? "green" : "amber"}>
              {titleCase(workspace.status)}
            </Badge>
          </p>

          {!editable && (
            <p className="mt-3 rounded-lg bg-slate-50 p-3 text-[12.5px] text-slate-500">
              Your role cannot change the workspace details.
            </p>
          )}

          <div className="mt-4 flex justify-end">
            <Button
              className="h-11 bg-accent-blue hover:bg-[#1B6CD8]"
              onClick={() => void save()}
              disabled={!editable || !dirty || !valid || saving}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
              Save Changes
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * The member list and the Invite Member button. Exported, with InvitationsCard and
 * DangerZone, so settings-view.spec.ts can render each one with the props that decide
 * what it offers, without a router or a signed-in session.
 */
export function TeamCard({
  members,
  selfId,
  canManage,
  roles,
  onInvite,
  onChanged,
  onError,
}: {
  members: WorkspaceMember[] | null;
  selfId?: string;
  canManage: boolean;
  /** The roles the signed-in person may hand out: their own and below, never SUPER_ADMIN. */
  roles: readonly Role[];
  onInvite: () => void;
  onChanged: (message: string) => void;
  onError: (cause: unknown) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  // Deactivating takes two presses: the first asks, the second does it.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmingId) return;
    const timer = window.setTimeout(() => setConfirmingId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmingId]);

  const run = async (member: WorkspaceMember, work: () => Promise<unknown>, success: string) => {
    setBusyId(member.id);
    setConfirmingId(null);
    try {
      await work();
      onChanged(success);
    } catch (cause) {
      onError(cause);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="p-5">
      <CardHeader className="p-0">
        <CardTitle>Team Members</CardTitle>
        <button
          type="button"
          disabled={!canManage}
          onClick={onInvite}
          title={canManage ? undefined : "Your role cannot invite teammates."}
          className="inline-flex shrink-0 items-center gap-1 rounded-btn bg-brand-green px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#15A45D] disabled:cursor-not-allowed disabled:bg-transparent disabled:font-medium disabled:text-slate-400 disabled:ring-1 disabled:ring-inset disabled:ring-slate-200"
        >
          <Plus className="h-3 w-3" strokeWidth={2.4} />
          Invite Member
        </button>
      </CardHeader>

      {members === null ? (
        <p className="mt-4 text-[13px] text-slate-400">Loading…</p>
      ) : members.length === 0 ? (
        <p className="mt-4 text-[13px] text-slate-500">No members to show.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {members.map((member) => {
            const self = member.id === selfId;
            const busy = busyId === member.id;
            // Nobody manages someone ranked above them — the API refuses it — so for those
            // the role is shown, not offered as a choice that would only come back 403.
            const manageable = canManage && !self && roles.includes(member.role as Role);
            return (
              <li key={member.id} className="flex flex-wrap items-center gap-3 py-3">
                <Avatar name={member.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-brand-navy">
                    {member.name}
                    {self && <span className="ml-1.5 text-[11.5px] font-normal text-slate-400">(you)</span>}
                  </p>
                  <p className="truncate text-[12px] text-slate-500">{member.email}</p>
                </div>

                <Badge tone={STATUS_TONE[member.status]}>{titleCase(member.status)}</Badge>

                {manageable ? (
                  <select
                    value={member.role}
                    disabled={busy}
                    aria-label={`Role for ${member.name}`}
                    onChange={(event) => {
                      const role = event.target.value;
                      void run(
                        member,
                        () => usersApi.update(member.id, { role }),
                        `${member.name} is now ${titleCase(role)}.`,
                      );
                    }}
                    className="h-9 rounded-btn border border-slate-200 bg-surface px-2 text-[12.5px] text-brand-navy focus:border-brand-green focus:outline-none disabled:opacity-50"
                  >
                    {roles.map((role) => (
                      <option key={role} value={role}>
                        {titleCase(role)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="w-[92px] text-[12.5px] text-slate-600">{titleCase(member.role)}</span>
                )}

                {manageable &&
                  (member.status === "DISABLED" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          member,
                          () => usersApi.update(member.id, { status: "ACTIVE" }),
                          `${member.name} can sign in again.`,
                        )
                      }
                      className="h-9 rounded-btn border border-slate-200 px-3 text-[12.5px] font-semibold text-brand-navy transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      Reactivate
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        confirmingId === member.id
                          ? void run(
                              member,
                              () => usersApi.deactivate(member.id),
                              `${member.name} has been deactivated.`,
                            )
                          : setConfirmingId(member.id)
                      }
                      className="h-9 rounded-btn border border-alert-red/40 px-3 text-[12.5px] font-semibold text-alert-red transition-colors hover:bg-alert-red/[0.06] disabled:opacity-50"
                    >
                      {confirmingId === member.id ? "Confirm" : "Deactivate"}
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/**
 * Invitations nobody has answered yet, expired ones included so they can be sent again.
 *
 * Resend issues a new link and kills the old one, so it opens the link dialog: with email
 * not configured, the new link on screen is the only copy anyone has. Withdrawing takes
 * two presses, like deactivating a member, because the link someone is holding stops
 * working at once.
 */
export function InvitationsCard({
  invitations,
  canManage,
  actorRole,
  onResent,
  onRevoked,
  onError,
}: {
  invitations: PendingInvitation[] | null | undefined;
  canManage: boolean;
  actorRole: Role | null;
  onResent: (sent: InvitationSent) => void;
  onRevoked: (email: string) => void;
  onError: (cause: unknown) => void;
}) {
  const [busy, setBusy] = useState<{ id: string; action: "resend" | "revoke" } | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmingId) return;
    const timer = window.setTimeout(() => setConfirmingId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmingId]);

  // Someone who cannot invite has nothing to do here unless there is something to see.
  if (!canManage && !(invitations && invitations.length > 0)) return null;

  async function resend(invitation: PendingInvitation) {
    setBusy({ id: invitation.id, action: "resend" });
    setConfirmingId(null);
    try {
      onResent(await usersApi.resendInvitation(invitation.id));
    } catch (cause) {
      onError(cause);
    } finally {
      setBusy(null);
    }
  }

  async function revoke(invitation: PendingInvitation) {
    setBusy({ id: invitation.id, action: "revoke" });
    setConfirmingId(null);
    try {
      await usersApi.revokeInvitation(invitation.id);
      onRevoked(invitation.email);
    } catch (cause) {
      onError(cause);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-5">
      <CardHeader className="p-0">
        <CardTitle>Pending Invitations</CardTitle>
        {invitations && invitations.length > 0 && (
          <span className="tabular text-[12px] text-slate-400">{invitations.length}</span>
        )}
      </CardHeader>

      {invitations === undefined ? (
        <p className="mt-4 text-[13px] text-slate-400">Loading…</p>
      ) : invitations === null ? (
        <p className="mt-4 text-[13px] text-slate-500">Could not load the pending invitations.</p>
      ) : invitations.length === 0 ? (
        <p className="mt-4 text-[13px] text-slate-500">
          No pending invitations. Invite Member creates one and gives you a link to share.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {invitations.map((invitation) => {
            const working = busy?.id === invitation.id ? busy.action : null;
            const expiry = expiryLabel(invitation.expiresAt, invitation.status);
            return (
              <li key={invitation.id} className="flex flex-wrap items-center gap-3 py-3">
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"
                >
                  <Mail className="h-4 w-4" strokeWidth={2.2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-brand-navy">
                    {invitation.email}
                    {invitation.name && (
                      <span className="ml-1.5 text-[11.5px] font-normal text-slate-400">
                        {invitation.name}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[12px] text-slate-500">
                    {titleCase(invitation.role)}
                    {invitation.invitedBy && (
                      <> &middot; invited by {invitation.invitedBy.name}</>
                    )}{" "}
                    &middot; {formatDate(invitation.createdAt)}
                  </p>
                </div>

                <Badge tone={expiry === "Expired" ? "gray" : "amber"}>{expiry}</Badge>

                {canManage && canAssign(actorRole, invitation.role) && (
                  <button
                    type="button"
                    disabled={working !== null}
                    onClick={() => void resend(invitation)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-btn border border-slate-200 px-3 text-[12.5px] font-semibold text-brand-navy transition-colors hover:bg-slate-50 disabled:opacity-50"
                  >
                    {working === "resend" && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
                    )}
                    Resend
                  </button>
                )}
                {canManage && (
                  <button
                    type="button"
                    disabled={working !== null}
                    onClick={() =>
                      confirmingId === invitation.id
                        ? void revoke(invitation)
                        : setConfirmingId(invitation.id)
                    }
                    className="h-9 rounded-btn border border-alert-red/40 px-3 text-[12.5px] font-semibold text-alert-red transition-colors hover:bg-alert-red/[0.06] disabled:opacity-50"
                  >
                    {confirmingId === invitation.id ? "Confirm" : "Revoke"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function TeamPreview({
  members,
  onViewAll,
}: {
  members: WorkspaceMember[] | null;
  onViewAll: () => void;
}) {
  return (
    <Card className="p-4">
      <CardHeader className="p-0">
        <CardTitle className="text-[16px]">Team Members</CardTitle>
        {members && <span className="tabular text-[12px] text-slate-400">{members.length}</span>}
      </CardHeader>

      {members === null ? (
        <p className="mt-3 text-[12.5px] text-slate-400">Loading…</p>
      ) : members.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-slate-500">No members to show.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {members.slice(0, 4).map((member) => (
            <li key={member.id} className="flex items-center gap-2.5">
              <Avatar name={member.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-brand-navy">{member.name}</p>
                <p className="truncate text-[11.5px] text-slate-500">
                  {titleCase(member.role)} &middot; {member.email}
                </p>
              </div>
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1.5 text-[11.5px] font-medium",
                  member.status === "ACTIVE" ? "text-brand-green" : "text-slate-400",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    member.status === "ACTIVE" ? "bg-brand-green" : "bg-slate-300",
                  )}
                />
                {titleCase(member.status)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onViewAll}
        className="mt-3 h-9 w-full rounded-btn border border-slate-200 text-[12.5px] font-semibold text-brand-navy transition-colors hover:bg-slate-50"
      >
        View All Team Members &rarr;
      </button>
    </Card>
  );
}

function UsageCard({ wallet }: { wallet: CreditWallet | null | undefined }) {
  return (
    <Card className="p-4">
      <CardHeader className="p-0">
        <CardTitle className="text-[16px]">Plan &amp; Usage</CardTitle>
        <Link
          href="/plans"
          className="shrink-0 text-[12.5px] font-semibold text-accent-blue hover:underline"
        >
          View All Plans &rarr;
        </Link>
      </CardHeader>

      <div className="mt-3 rounded-xl border border-slate-200 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <Crown className="mt-0.5 h-5 w-5 shrink-0 text-warning-amber" strokeWidth={2} />
            <div>
              <p className="text-[12px] text-slate-500">Credit balance</p>
              <p className="tabular text-[20px] font-bold text-brand-navy">
                {wallet === undefined ? "…" : wallet ? formatNumber(wallet.balance) : "—"}
              </p>
            </div>
          </div>
          {wallet && (
            <Badge tone={wallet.isLow ? "amber" : "green"}>
              {wallet.isLow ? "Running low" : "Healthy"}
            </Badge>
          )}
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-slate-500">
          Each call spends credits. Billing is not connected yet, so plans and top-ups cannot be
          bought from here.
        </p>
      </div>

      <Link
        href="/plans"
        className="mt-3.5 flex h-11 w-full items-center justify-center gap-2 rounded-btn bg-accent-blue text-[14px] font-semibold text-white transition-colors hover:bg-[#1B6CD8]"
      >
        <Crown className="h-4 w-4" strokeWidth={2.2} />
        Compare Plans
      </Link>
    </Card>
  );
}

/**
 * Deleting a workspace, for now, by asking support. Doing it in-app needs what the API
 * does not have yet — a typed confirmation, a grace period, and a purge that keeps the
 * invoices the law says to keep — and a button that deletes nothing is worse than an
 * honest route to someone who can. Only the owner is offered it: support will check with
 * the owner anyway, and a request from anyone else would only start that conversation.
 */
export function DangerZone({
  workspace,
  user,
  isOwner,
}: {
  workspace: TenantSummary | null | undefined;
  user: SessionUser | null;
  isOwner: boolean;
}) {
  const mailto = workspaceDeletionMailto(appBrand.supportEmail, {
    workspaceName: workspace?.name ?? user?.tenantName,
    subdomain: workspace?.subdomain,
    requesterEmail: user?.email,
  });

  return (
    <Card className="border-alert-red/25 p-4">
      <div className="flex items-center gap-2">
        <Trash2 className="h-4 w-4 text-alert-red" strokeWidth={2.2} />
        <h3 className="text-[15px] font-bold text-alert-red">Danger Zone</h3>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-600">
        Deleting a workspace removes every lead, call and recording in it. Our support team
        does it for you, after confirming with the workspace owner.
      </p>
      {!isOwner ? (
        <p className="mt-3 rounded-lg bg-slate-50 p-3 text-[12.5px] text-slate-500">
          Only the workspace owner can ask for it to be deleted.
        </p>
      ) : mailto ? (
        <>
          <a
            href={mailto}
            className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-btn border border-alert-red/40 text-[13px] font-semibold text-alert-red transition-colors hover:bg-alert-red/[0.06]"
          >
            <Mail className="h-4 w-4" strokeWidth={2.2} />
            Contact support to delete this workspace
          </a>
          <p className="mt-2 text-[11.5px] text-slate-400">
            Opens an email to {appBrand.supportEmail} with your workspace details filled in.
          </p>
        </>
      ) : (
        <p className="mt-3 rounded-lg bg-slate-50 p-3 text-[12.5px] text-slate-500">
          To delete this workspace, contact {appBrand.name} support.
        </p>
      )}
    </Card>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  required,
  disabled,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-slate-600">
        {label}
        {required && <span className="ml-0.5 text-alert-red">*</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        readOnly={!onChange}
        disabled={disabled}
        placeholder={placeholder}
        className="h-11 w-full rounded-btn border border-slate-200 px-3 text-[13.5px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25 disabled:bg-slate-50 disabled:text-slate-500"
      />
      {hint && <span className="mt-1 block text-[11.5px] text-slate-400">{hint}</span>}
    </label>
  );
}

const AVATAR_TINTS = [
  "bg-accent-purple/[0.16] text-accent-purple",
  "bg-accent-blue/[0.16] text-accent-blue",
  "bg-warning-amber/[0.18] text-[#B4761A]",
  "bg-brand-green/[0.16] text-deep-green",
];

/** Initials in a tint chosen from the name, so a person keeps one colour everywhere. */
function Avatar({ name }: { name: string }) {
  const seed = Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12.5px] font-bold",
        AVATAR_TINTS[seed % AVATAR_TINTS.length],
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
