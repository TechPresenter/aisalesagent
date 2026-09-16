"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  CreditCard,
  Crown,
  Loader2,
  Phone,
  Plug,
  Plus,
  Settings2,
  Shield,
  Trash2,
  Users,
  User,
} from "lucide-react";
import { ROLES, type TenantSummary } from "@appsgain/shared";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BillingTab } from "@/components/settings/billing-tab";
import { CallSettingsTab } from "@/components/settings/call-settings-tab";
import { ChangePasswordDialog } from "@/components/settings/change-password-dialog";
import { IntegrationsTab } from "@/components/settings/integrations-tab";
import { NotificationsTab } from "@/components/settings/notifications-tab";
import { SecurityTab } from "@/components/settings/security-tab";
import {
  ApiError,
  creditsApi,
  updateSessionUser,
  usersApi,
  workspaceApi,
  type CreditWallet,
  type UserStatus,
  type WorkspaceMember,
} from "@/lib/api-client";
import { usePermission, useSessionUser } from "@/lib/use-session";
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
 * access. What the API cannot do yet — change a password, edit workspace details, invite
 * someone, buy credits — is shown as unavailable rather than as a form that would not save.
 */
export function SettingsView() {
  const [tab, setTab] = useState<TabName>("Profile");
  const { user } = useSessionUser();
  const canManageTeam = usePermission("team.manage") === true;
  const canManageSettings = usePermission("settings.manage") === true;
  const canManageCalling = usePermission("calling.manage") === true;
  const [changingPassword, setChangingPassword] = useState(false);
  // Stable: the dialog resets its fields whenever this changes.
  const closePasswordDialog = useCallback(() => setChangingPassword(false), []);
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [workspace, setWorkspace] = useState<TenantSummary | null | undefined>(undefined);
  const [wallet, setWallet] = useState<CreditWallet | null | undefined>(undefined);
  const [notice, setNotice] = useState<Notice | null>(null);

  const loadMembers = useCallback(() => {
    usersApi.list().then(setMembers, () => setMembers([]));
  }, []);

  useEffect(() => {
    loadMembers();
    workspaceApi.mine().then(setWorkspace, () => setWorkspace(null));
    creditsApi.wallet().then(setWallet, () => setWallet(null));
  }, [loadMembers]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
            <TeamCard
              members={members}
              selfId={user?.id}
              canManage={canManageTeam}
              onChanged={done}
              onError={(cause) => fail(cause, "Could not update that member.")}
            />
          )}

          {tab === "Billing" && <BillingTab wallet={wallet} />}

          {tab === "Integrations" && <IntegrationsTab />}

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
            <SecurityTab onChangePassword={() => setChangingPassword(true)} />
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
          <DangerZone />
        </div>
      </div>

      <ChangePasswordDialog open={changingPassword} onClose={closePasswordDialog} />
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

function TeamCard({
  members,
  selfId,
  canManage,
  onChanged,
  onError,
}: {
  members: WorkspaceMember[] | null;
  selfId?: string;
  canManage: boolean;
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
          disabled
          title="Inviting teammates needs an invite endpoint the API does not have yet."
          className="inline-flex shrink-0 cursor-not-allowed items-center gap-1 rounded-btn border border-slate-200 px-2.5 py-1.5 text-[12px] font-medium text-slate-400"
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
            const manageable = canManage && !self;
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
                    {ROLES.map((role) => (
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

function DangerZone() {
  return (
    <Card className="border-alert-red/25 p-4">
      <div className="flex items-center gap-2">
        <Trash2 className="h-4 w-4 text-alert-red" strokeWidth={2.2} />
        <h3 className="text-[15px] font-bold text-alert-red">Danger Zone</h3>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-600">
        Deleting a workspace removes every lead, call and recording in it.
      </p>
      <button
        type="button"
        disabled
        title="Workspace deletion is not available from the app yet."
        className="mt-3 flex h-10 w-full cursor-not-allowed items-center justify-center gap-2 rounded-btn border border-alert-red/40 text-[13px] font-semibold text-alert-red opacity-50"
      >
        <Trash2 className="h-4 w-4" strokeWidth={2.2} />
        Delete Account
      </button>
      <p className="mt-2 text-[11.5px] text-slate-400">Not available from the app yet.</p>
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
