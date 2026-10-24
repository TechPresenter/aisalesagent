"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronLeft, Circle, Loader2, Plus, X } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { Pagination } from "@/components/ui/pagination";
import { CampaignLeadsPicker } from "@/components/campaigns/campaign-leads-picker";
import {
  agentsApi,
  ApiError,
  callSettingsApi,
  callsApi,
  campaignsApi,
  type ApiAgent,
  type ApiCampaign,
  type ApiCampaignLead,
  type CallSettings,
} from "@/lib/api-client";
import { CAMPAIGN_STATUS, CAMPAIGN_TYPE, availableActions } from "@/lib/campaign-display";
import {
  CALLING_TYPES,
  CAMPAIGN_LEAD_STATE,
  MAX_CALL_SCRIPT_LENGTH,
  WEEK_DAYS,
  campaignReadiness,
  describeDays,
  minutesToTime,
  scriptFromAgent,
  settingsForm,
  settingsPatch,
  settingsProblems,
  timezoneOptions,
  type CampaignSettingsForm,
} from "@/lib/campaign-setup";
import { useDebounced } from "@/lib/use-debounced";
import { usePermission } from "@/lib/use-session";
import { cn, formatDate, formatNumber } from "@/lib/utils";

type DialerPreview = Awaited<ReturnType<typeof callsApi.dialerPreview>>;
type Notice = { tone: "ok" | "bad"; text: string };
type Lifecycle = "activate" | "pause" | "complete" | "archive";

type LoadState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; campaign: ApiCampaign };

const FIELD =
  "h-11 w-full rounded-btn border border-slate-200 bg-surface px-3 text-[13.5px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25 disabled:bg-slate-50 disabled:text-slate-500";

const LEADS_PAGE_SIZE = 10;

const describe = (cause: unknown, fallback: string) =>
  cause instanceof ApiError ? cause.message : fallback;

/**
 * Feature List §4 — one campaign, against `GET /campaigns/:id`.
 *
 * This is where a campaign becomes able to dial. The list screen can only create a draft,
 * and activation refuses a campaign without an agent, a script and at least one lead, so
 * until this page existed a campaign made in the app could never be started. Here are the
 * three things activation needs — the agent and script, the schedule, the leads — and a
 * checklist beside the Activate button showing which are still missing.
 *
 * The page decides nothing: the checklist mirrors the API's rule, and the API refuses
 * activation with its own sentence if the two ever disagree.
 */
export function CampaignDetail({ id }: { id: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [form, setForm] = useState<CampaignSettingsForm | null>(null);
  const [agents, setAgents] = useState<ApiAgent[] | null>(null);
  const [workspace, setWorkspace] = useState<CallSettings | null>(null);
  const [preview, setPreview] = useState<DialerPreview | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<Lifecycle | "save" | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [leadsVersion, setLeadsVersion] = useState(0);

  const canEdit = usePermission("campaigns.edit");
  const canAssign = usePermission("leads.assign");
  const canStart = usePermission("calling.start");

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const load = useCallback(async () => {
    try {
      const campaign = await campaignsApi.get(id);
      setState({ status: "ready", campaign });
      // The form is filled once, from the first read. Later reads (after a status change,
      // or leads being added) leave alone anything someone is in the middle of typing.
      setForm((current) => current ?? settingsForm(campaign));
    } catch (cause) {
      // 400 is an id that is not a UUID at all; 404 is one that is not in this workspace.
      if (cause instanceof ApiError && (cause.status === 404 || cause.status === 400)) {
        setState({ status: "missing" });
        return;
      }
      setState({ status: "error", message: describe(cause, "Could not load this campaign.") });
    }
  }, [id]);

  // The dialer's view of the leads needs `calling.view`. Without it the panel is left out
  // rather than shown broken.
  const loadPreview = useCallback(() => {
    callsApi.dialerPreview(id).then(setPreview, () => setPreview(null));
  }, [id]);

  useEffect(() => {
    setState({ status: "loading" });
    setForm(null);
    void load();
    loadPreview();
  }, [load, loadPreview]);

  // Context rather than the record: a role that cannot read agents or the workspace's
  // calling rules still gets the page, with less to choose from.
  useEffect(() => {
    agentsApi.list().then(setAgents, () => setAgents([]));
    callSettingsApi.get().then(setWorkspace, () => setWorkspace(null));
  }, []);

  const afterLeadsChanged = useCallback(() => {
    setLeadsVersion((n) => n + 1);
    void load();
    loadPreview();
  }, [load, loadPreview]);

  const closePicker = useCallback(() => setPicking(false), []);
  const leadsAdded = useCallback(
    (message: string) => {
      setNotice({ tone: "ok", text: message });
      afterLeadsChanged();
    },
    [afterLeadsChanged],
  );

  if (state.status === "loading") {
    return (
      <Frame>
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" strokeWidth={2.2} />
        <p className="text-[13.5px] text-slate-500">Loading campaign&hellip;</p>
      </Frame>
    );
  }

  if (state.status === "missing") {
    return (
      <Frame>
        <h1 className="text-[18px] font-bold text-brand-navy">Campaign not found</h1>
        <p className="max-w-sm text-[13.5px] text-slate-500">
          It may have been deleted, or it belongs to a different workspace.
        </p>
      </Frame>
    );
  }

  if (state.status === "error") {
    return (
      <Frame>
        <p className="text-[13.5px] text-[#C93B3B]">{state.message}</p>
        <button
          type="button"
          onClick={() => {
            setState({ status: "loading" });
            void load();
          }}
          className="h-10 rounded-btn border border-slate-200 px-4 text-[13.5px] font-semibold text-brand-navy transition-colors hover:bg-slate-50"
        >
          Try again
        </button>
      </Frame>
    );
  }

  const { campaign } = state;
  const status = CAMPAIGN_STATUS[campaign.status];
  const type = CAMPAIGN_TYPE[campaign.type];
  const finished = campaign.status === "COMPLETED" || campaign.status === "ARCHIVED";
  const editable = canEdit === true && campaign.status !== "ARCHIVED";
  const calling = CALLING_TYPES.includes(campaign.type);
  const dirty = form !== null && JSON.stringify(form) !== JSON.stringify(settingsForm(campaign));
  const readiness = campaignReadiness(campaign);
  const ready = readiness.every((item) => item.done);

  async function transition(action: Lifecycle, label: string) {
    if (
      (action === "complete" || action === "archive") &&
      !window.confirm(
        action === "complete"
          ? `Complete "${campaign.name}"? It stops dialling for good and cannot be restarted.`
          : `Archive "${campaign.name}"? It cannot be changed afterwards.`,
      )
    ) {
      return;
    }
    setBusy(action);
    try {
      const updated = await campaignsApi.transition(campaign.id, action);
      setState({ status: "ready", campaign: updated });
      setNotice({ tone: "ok", text: `${updated.name}: ${label.toLowerCase()}d.` });
      loadPreview();
    } catch (cause) {
      // The server's refusal is the useful message: "Before activating, add at least one
      // lead." says what to do next.
      setNotice({ tone: "bad", text: describe(cause, "That did not work. Try again.") });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!form) return;
    const found = settingsProblems(form);
    setProblems(found);
    if (found.length > 0) return;

    setBusy("save");
    try {
      const updated = await campaignsApi.update(campaign.id, settingsPatch(form, calling));
      const copied = calling && !form.callScript.trim() && Boolean(updated.callScript);
      setState({ status: "ready", campaign: updated });
      setForm(settingsForm(updated));
      setNotice({
        tone: "ok",
        text: copied
          ? "Saved. The agent's script was copied in; read it through before activating."
          : "Campaign settings saved.",
      });
      loadPreview();
    } catch (cause) {
      setNotice({ tone: "bad", text: describe(cause, "Could not save the campaign.") });
    } finally {
      setBusy(null);
    }
  }

  const activateAction = availableActions(campaign.status).find(
    (entry) => entry.action === "activate",
  );
  const otherActions = availableActions(campaign.status).filter(
    (entry) => entry.action !== "activate",
  );

  return (
    <>
      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-accent-blue hover:underline"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={2.4} />
        All campaigns
      </Link>

      <div className="mb-5 mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="break-words text-[26px] font-bold leading-tight tracking-tight text-brand-navy">
              {campaign.name}
            </h1>
            <Badge tone={status.tone}>{status.label}</Badge>
            <Badge tone={type.tone}>{type.label}</Badge>
          </div>
          <p className="mt-1.5 text-[14px] text-slate-500">
            {campaign.description?.trim() || `Created ${formatDate(campaign.createdAt)}`}
          </p>
        </div>

        {canEdit && otherActions.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {otherActions.map((entry) => (
              <button
                key={entry.action}
                type="button"
                disabled={busy !== null}
                onClick={() => void transition(entry.action, entry.label)}
                className="inline-flex h-10 items-center gap-2 rounded-btn border border-slate-200 bg-surface px-4 text-[13.5px] font-semibold text-brand-navy transition-colors hover:bg-slate-50 disabled:opacity-60"
              >
                {busy === entry.action && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
                )}
                {entry.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {notice && (
        <div
          role="status"
          className={cn(
            "mb-4 rounded-btn px-4 py-2.5 text-[13px] font-medium",
            notice.tone === "ok"
              ? "bg-brand-green/[0.1] text-deep-green"
              : "bg-alert-red/[0.09] text-[#C93B3B]",
          )}
        >
          {notice.text}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* First in the DOM so it leads on a phone; the grid puts it on the right. */}
        <div className="space-y-5 xl:order-2">
          <Card className="p-5">
            <ActivationStatus campaign={campaign} />

            <ul className="mt-4 space-y-2.5">
              {readiness.map((item) => (
                <li key={item.key} className="flex items-center gap-2.5 text-[13px]">
                  {item.done ? (
                    <CheckCircle2
                      className="h-[18px] w-[18px] shrink-0 text-brand-green"
                      strokeWidth={2.2}
                    />
                  ) : (
                    <Circle
                      className="h-[18px] w-[18px] shrink-0 text-slate-300"
                      strokeWidth={2.2}
                    />
                  )}
                  <span className={item.done ? "text-brand-navy" : "text-slate-500"}>
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>

            {preview && <DialerSummary preview={preview} />}

            {activateAction && (
              <div className="mt-5">
                {dirty && (
                  <p className="mb-2 text-[12px] text-[#B4761A]">
                    Save your changes first: activation checks the saved campaign.
                  </p>
                )}
                {canStart === false && (
                  <p className="mb-2 text-[12px] text-slate-500">
                    Your role cannot start calling. Ask a workspace admin or manager.
                  </p>
                )}
                <button
                  type="button"
                  disabled={!ready || dirty || !canEdit || !canStart || busy !== null}
                  onClick={() => void transition("activate", activateAction.label)}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-btn bg-brand-green px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[#15A45D] disabled:bg-slate-200 disabled:text-slate-400"
                >
                  {busy === "activate" && (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
                  )}
                  {activateAction.label}
                </button>
              </div>
            )}
          </Card>

          <PerformanceCard campaign={campaign} />
        </div>

        <div className="min-w-0 space-y-5 xl:order-1">
          {form && (
            <SettingsCards
              campaign={campaign}
              form={form}
              onChange={setForm}
              agents={agents}
              workspace={workspace}
              editable={editable}
              calling={calling}
              problems={problems}
              saving={busy === "save"}
              dirty={dirty}
              onSave={() => void save()}
              onDiscard={() => {
                setForm(settingsForm(campaign));
                setProblems([]);
              }}
            />
          )}

          <CampaignLeadsCard
            campaignId={campaign.id}
            version={leadsVersion}
            canAdd={canEdit === true && canAssign === true && !finished}
            canRemove={canEdit === true && canAssign === true && campaign.status !== "ARCHIVED"}
            onAdd={() => setPicking(true)}
            onChanged={afterLeadsChanged}
            onNotice={setNotice}
          />
        </div>
      </div>

      <CampaignLeadsPicker
        open={picking}
        campaignId={campaign.id}
        campaignName={campaign.name}
        onClose={closePicker}
        onAdded={leadsAdded}
      />
    </>
  );
}

/** One sentence on what the dialer does with this campaign now. */
function ActivationStatus({ campaign }: { campaign: ApiCampaign }) {
  const copy: Record<ApiCampaign["status"], { title: string; text: string }> = {
    DRAFT: {
      title: "Ready to activate?",
      text: "Nothing is dialled until you activate. Activation needs everything below.",
    },
    ACTIVE: {
      title: "Dialling",
      text: "Live. The dialer calls this campaign's leads inside its schedule.",
    },
    PAUSED: {
      title: "Paused",
      text: "No calls go out until you resume. Resuming checks everything below again.",
    },
    COMPLETED: { title: "Finished", text: "Completed. This campaign no longer dials." },
    ARCHIVED: {
      title: "Finished",
      text: "Archived. This campaign no longer dials and cannot be changed.",
    },
  };
  const { title, text } = copy[campaign.status];
  return (
    <>
      <CardTitle>{title}</CardTitle>
      <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{text}</p>
    </>
  );
}

/** Where the campaign's leads stand with the dialer (`GET /calls/dialer/preview/:id`). */
function DialerSummary({ preview }: { preview: DialerPreview }) {
  const rows: { label: string; value: number }[] = [
    { label: "Due now", value: preview.due },
    { label: "Waiting", value: preview.pending },
    { label: "Done", value: preview.completed },
    { label: "Out of attempts", value: preview.exhausted },
    { label: "Skipped", value: preview.skipped },
  ];
  return (
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-btn bg-slate-50 px-3.5 py-3">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-2">
          <dt className="text-[12px] text-slate-500">{row.label}</dt>
          <dd className="tabular text-[13px] font-semibold text-brand-navy">
            {formatNumber(row.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PerformanceCard({ campaign }: { campaign: ApiCampaign }) {
  const { stats } = campaign;
  const rows: { label: string; value: string }[] = [
    { label: "Leads", value: formatNumber(stats.leads) },
    { label: "Calls placed", value: formatNumber(stats.calls) },
    { label: "Connected", value: `${formatNumber(stats.connected)} (${stats.connectRate}%)` },
    { label: "Interested", value: formatNumber(stats.interested) },
    { label: "Demos booked", value: formatNumber(stats.demoBooked) },
    { label: "Conversion", value: `${stats.conversionRate}%` },
    { label: "Follow-ups", value: formatNumber(stats.followUps) },
    { label: "Credits used", value: formatNumber(stats.creditsUsed) },
  ];
  return (
    <Card className="p-5">
      <CardTitle>Performance</CardTitle>
      <dl className="mt-3 divide-y divide-slate-100">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 py-2">
            <dt className="text-[13px] text-slate-500">{row.label}</dt>
            <dd className="tabular text-[13.5px] font-semibold text-brand-navy">{row.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** The agent and script, and the schedule: the two cards a campaign is configured in. */
function SettingsCards({
  campaign,
  form,
  onChange,
  agents,
  workspace,
  editable,
  calling,
  problems,
  saving,
  dirty,
  onSave,
  onDiscard,
}: {
  campaign: ApiCampaign;
  form: CampaignSettingsForm;
  onChange: React.Dispatch<React.SetStateAction<CampaignSettingsForm | null>>;
  agents: ApiAgent[] | null;
  workspace: CallSettings | null;
  editable: boolean;
  calling: boolean;
  problems: string[];
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const edit = <K extends keyof CampaignSettingsForm>(key: K, value: CampaignSettingsForm[K]) =>
    onChange((current) => (current ? { ...current, [key]: value } : current));

  const zones = useMemo(() => timezoneOptions(campaign.timezone), [campaign.timezone]);

  // Active agents, plus the one already assigned even if it has since been switched off,
  // so the select can show what is saved.
  const agentOptions = (agents ?? []).filter(
    (agent) => agent.isActive || agent.id === form.aiAgentId,
  );
  const chosenAgent = agents?.find((agent) => agent.id === form.aiAgentId);
  const chosenScript = chosenAgent ? scriptFromAgent(chosenAgent) : null;

  /**
   * Picking an agent brings its script with it, unless someone has written their own: a
   * box that is empty, or still holds the previous agent's script untouched, is replaced;
   * anything else is kept.
   */
  function chooseAgent(agentId: string) {
    const next = agents?.find((agent) => agent.id === agentId);
    onChange((current) => {
      if (!current) return current;
      const previous = agents?.find((agent) => agent.id === current.aiAgentId);
      const untouched =
        !current.callScript.trim() ||
        (previous !== undefined && current.callScript === scriptFromAgent(previous));
      const replacement = next ? scriptFromAgent(next) : null;
      return {
        ...current,
        aiAgentId: agentId,
        callScript: untouched && replacement ? replacement : current.callScript,
      };
    });
  }

  function copyAgentScript() {
    if (!chosenScript || !chosenAgent) return;
    if (
      form.callScript.trim() &&
      !window.confirm(`Replace the script in the box with ${chosenAgent.name}'s?`)
    ) {
      return;
    }
    edit("callScript", chosenScript);
  }

  const workspaceHours = workspace
    ? `${minutesToTime(workspace.callWindowStart)}–${minutesToTime(workspace.callWindowEnd)}`
    : null;

  return (
    <>
      {calling && (
        <Card className="p-5">
          <CardTitle>Agent and script</CardTitle>
          <p className="mt-1 text-[13px] text-slate-500">
            Who places the calls, and what they say.
          </p>

          <div className="mt-4 space-y-4">
            <Field label="AI agent">
              <select
                value={form.aiAgentId}
                onChange={(event) => chooseAgent(event.target.value)}
                disabled={!editable || agents === null}
                className={FIELD}
              >
                <option value="">{agents === null ? "Loading agents…" : "No agent yet"}</option>
                {agentOptions.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                    {agent.isActive ? "" : " (switched off)"}
                  </option>
                ))}
                {form.aiAgentId && agents !== null && !chosenAgent && (
                  <option value={form.aiAgentId}>The assigned agent</option>
                )}
              </select>
            </Field>
            {agents !== null && agentOptions.length === 0 && (
              <p className="-mt-2 text-[12px] text-slate-500">
                There is no active agent yet.{" "}
                <Link href="/agents" className="font-semibold text-accent-blue hover:underline">
                  Create one
                </Link>{" "}
                to give this campaign a voice.
              </p>
            )}

            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="campaign-call-script"
                  className="text-[12.5px] font-medium text-slate-600"
                >
                  Call script
                </label>
                {editable && chosenAgent && chosenScript && chosenScript !== form.callScript && (
                  <button
                    type="button"
                    onClick={copyAgentScript}
                    className="text-[12px] font-semibold text-accent-blue hover:underline"
                  >
                    Use {chosenAgent.name}&rsquo;s script
                  </button>
                )}
              </div>
              <textarea
                id="campaign-call-script"
                value={form.callScript}
                onChange={(event) => edit("callScript", event.target.value)}
                disabled={!editable}
                rows={12}
                maxLength={MAX_CALL_SCRIPT_LENGTH}
                placeholder={
                  form.aiAgentId
                    ? "Left empty, the agent's script is copied in when you save."
                    : "What the agent says: the opening, the questions to ask, the answers to objections, the close."
                }
                className="scrollbar-thin w-full resize-y rounded-lg border border-slate-200 bg-surface p-3 text-[13px] leading-relaxed text-slate-700 placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25 disabled:bg-slate-50"
              />
              <p className="mt-1 text-[11.5px] text-slate-400">
                This campaign&rsquo;s own copy. Editing it here does not change the agent.
              </p>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <CardTitle>Schedule</CardTitle>
        <p className="mt-1 text-[13px] text-slate-500">
          When calls go out. Left empty, a setting follows the workspace&rsquo;s call settings.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Timezone" hint="The clock the calling window is read in.">
            <select
              value={form.timezone}
              onChange={(event) => edit("timezone", event.target.value)}
              disabled={!editable}
              className={FIELD}
            >
              <option value="">
                Workspace timezone{workspace ? ` (${workspace.timezone})` : ""}
              </option>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Calls from">
            <input
              type="time"
              value={form.windowStart}
              onChange={(event) => edit("windowStart", event.target.value)}
              disabled={!editable}
              className={`tabular ${FIELD}`}
            />
          </Field>
          <Field label="Until">
            <input
              type="time"
              value={form.windowEnd}
              onChange={(event) => edit("windowEnd", event.target.value)}
              disabled={!editable}
              className={`tabular ${FIELD}`}
            />
          </Field>
        </div>
        <p className="mt-1.5 text-[11.5px] text-slate-400">
          Both times empty: the workspace&rsquo;s hours
          {workspaceHours ? ` (${workspaceHours})` : ""}.
          {editable && (form.windowStart || form.windowEnd) && (
            <>
              {" "}
              <button
                type="button"
                onClick={() =>
                  onChange((current) =>
                    current ? { ...current, windowStart: "", windowEnd: "" } : current,
                  )
                }
                className="font-semibold text-accent-blue hover:underline"
              >
                Use the workspace&rsquo;s hours
              </button>
            </>
          )}
        </p>

        <fieldset className="mt-4">
          <legend className="mb-1.5 text-[12.5px] font-medium text-slate-600">Days</legend>
          <div className="flex flex-wrap gap-2">
            {WEEK_DAYS.map((day) => {
              const active = form.callDays.includes(day.value);
              return (
                <label
                  key={day.value}
                  className={cn(
                    "flex cursor-pointer items-center gap-1.5 rounded-btn border px-3 py-2 text-[12.5px] font-semibold transition-colors focus-within:ring-2 focus-within:ring-brand-green/25",
                    active
                      ? "border-brand-green bg-brand-green/[0.08] text-deep-green"
                      : "border-slate-200 text-slate-500 hover:bg-slate-50",
                    !editable && "cursor-not-allowed opacity-60",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    disabled={!editable}
                    onChange={() =>
                      edit(
                        "callDays",
                        active
                          ? form.callDays.filter((value) => value !== day.value)
                          : [...form.callDays, day.value].sort((a, b) => a - b),
                      )
                    }
                    className="sr-only"
                  />
                  {day.label}
                </label>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11.5px] text-slate-400">
            None picked: the workspace&rsquo;s days
            {workspace ? ` (${describeDays(workspace.callDays)})` : ""}.
          </p>
        </fieldset>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Start date" hint="Optional.">
            <input
              type="date"
              value={form.startDate}
              onChange={(event) => edit("startDate", event.target.value)}
              disabled={!editable}
              className={`tabular ${FIELD}`}
            />
          </Field>
          <Field label="End date" hint="Optional. Must be after the start date.">
            <input
              type="date"
              value={form.endDate}
              min={form.startDate || undefined}
              onChange={(event) => edit("endDate", event.target.value)}
              disabled={!editable}
              className={`tabular ${FIELD}`}
            />
          </Field>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field
            label="Calls per day"
            hint={
              workspace
                ? `Empty: the workspace's cap (${
                    workspace.maxCallsPerDay === null
                      ? "none"
                      : formatNumber(workspace.maxCallsPerDay)
                  }).`
                : "Empty: the workspace's cap."
            }
          >
            <input
              value={form.dailyCallLimit}
              onChange={(event) => edit("dailyCallLimit", event.target.value)}
              disabled={!editable}
              inputMode="numeric"
              placeholder="Workspace cap"
              className={`tabular ${FIELD}`}
            />
          </Field>
          <Field label="Attempts per lead" hint="1 to 10.">
            <input
              value={form.maxAttempts}
              onChange={(event) => edit("maxAttempts", event.target.value)}
              disabled={!editable}
              inputMode="numeric"
              className={`tabular ${FIELD}`}
            />
          </Field>
          <Field label="Wait between attempts" hint="Minutes.">
            <input
              value={form.retryDelayMinutes}
              onChange={(event) => edit("retryDelayMinutes", event.target.value)}
              disabled={!editable}
              inputMode="numeric"
              className={`tabular ${FIELD}`}
            />
          </Field>
        </div>

        {problems.length > 0 && (
          <ul
            role="alert"
            className="mt-4 space-y-1 rounded-btn bg-alert-red/[0.09] px-4 py-3 text-[12.5px] font-medium text-[#C93B3B]"
          >
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}

        {editable && (
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5">
            {dirty && (
              <button
                type="button"
                onClick={onDiscard}
                disabled={saving}
                className="h-10 rounded-btn border border-slate-200 px-4 text-[13.5px] font-semibold text-brand-navy transition-colors hover:bg-slate-50"
              >
                Discard changes
              </button>
            )}
            <button
              type="button"
              onClick={onSave}
              disabled={!dirty || saving}
              className="inline-flex h-10 items-center gap-2 rounded-btn bg-brand-green px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#15A45D] disabled:bg-slate-200 disabled:text-slate-400"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />}
              Save settings
            </button>
          </div>
        )}
      </Card>
    </>
  );
}

/** The campaign's leads, with where the dialer is with each, and the way to add more. */
function CampaignLeadsCard({
  campaignId,
  version,
  canAdd,
  canRemove,
  onAdd,
  onChanged,
  onNotice,
}: {
  campaignId: string;
  version: number;
  canAdd: boolean;
  canRemove: boolean;
  onAdd: () => void;
  onChanged: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search.trim());
  const [result, setResult] = useState<{
    data: ApiCampaignLead[];
    total: number;
    totalPages: number;
  } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    campaignsApi
      .leads(campaignId, { search: debounced || undefined, page, pageSize: LEADS_PAGE_SIZE })
      .then(
        (response) => {
          if (cancelled) return;
          setResult(response);
          setFailed(null);
        },
        (cause) => {
          if (cancelled) return;
          setFailed(
            cause instanceof ApiError && cause.status === 403
              ? "Your role cannot see this campaign's leads."
              : describe(cause, "Could not load this campaign's leads."),
          );
        },
      );
    return () => {
      cancelled = true;
    };
  }, [campaignId, debounced, page, version]);

  async function remove(row: ApiCampaignLead) {
    setRemoving(row.leadId);
    try {
      await campaignsApi.removeLead(campaignId, row.leadId);
      onNotice({ tone: "ok", text: `${row.lead.name} removed from this campaign.` });
      onChanged();
    } catch (cause) {
      onNotice({ tone: "bad", text: describe(cause, "Could not remove the lead.") });
    } finally {
      setRemoving(null);
    }
  }

  const rows = result?.data ?? [];

  return (
    <Card className="flex min-w-0 flex-col overflow-hidden">
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>Leads</CardTitle>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {result
              ? `${formatNumber(result.total)} ${result.total === 1 ? "lead" : "leads"}${debounced ? " match" : " in this campaign"}`
              : "The people this campaign calls."}
          </p>
        </div>
        {canAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex h-10 items-center gap-2 rounded-btn bg-accent-blue px-4 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#1B6CD8]"
          >
            <Plus className="h-4 w-4" strokeWidth={2.4} />
            Add leads
          </button>
        )}
      </CardHeader>

      <div className="px-5 pt-4">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Search this campaign's leads..."
        />
      </div>

      <div className="scrollbar-thin mt-3 w-full overflow-x-auto">
        {failed ? (
          <p className="px-5 py-10 text-center text-[13px] text-slate-500">{failed}</p>
        ) : result === null ? (
          <p className="flex items-center justify-center gap-2 px-5 py-10 text-[13px] text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
            Loading leads…
          </p>
        ) : rows.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-[13.5px] font-medium text-brand-navy">
              {debounced ? "No leads in this campaign match." : "No leads yet."}
            </p>
            {!debounced && (
              <p className="mt-1 text-[12.5px] text-slate-500">
                Add the leads this campaign should call. Leads marked do-not-call are never added.
              </p>
            )}
          </div>
        ) : (
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="bg-slate-50/80">
                <Th className="pl-5">Lead</Th>
                <Th>City</Th>
                <Th>State</Th>
                <Th>Attempts</Th>
                <Th>Added</Th>
                <Th className="pr-5">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const state = CAMPAIGN_LEAD_STATE[row.state];
                return (
                  <tr key={row.leadId} className="border-t border-slate-100 hover:bg-slate-50/70">
                    <td className="py-2.5 pl-5 pr-2">
                      <Link
                        href={`/leads/${row.lead.id}`}
                        className="block text-[13px] font-semibold text-brand-navy hover:text-accent-blue hover:underline"
                      >
                        {row.lead.name}
                      </Link>
                      <span className="tabular block text-[11.5px] text-slate-500">
                        {row.lead.phone}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-[12.5px] text-slate-600">
                      {row.lead.city ?? "—"}
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={state.tone}>{state.label}</Badge>
                        {row.lead.doNotCall && <Badge tone="red">Do not call</Badge>}
                      </span>
                    </td>
                    <td className="tabular px-2 py-2.5 text-[12.5px] text-brand-navy">
                      {formatNumber(row.attempts)}
                    </td>
                    <td className="tabular px-2 py-2.5 text-[12.5px] text-slate-600">
                      {formatDate(row.addedAt)}
                    </td>
                    <td className="py-2.5 pl-2 pr-5 text-right">
                      {canRemove && (
                        <button
                          type="button"
                          onClick={() => void remove(row)}
                          disabled={removing !== null}
                          aria-label={`Remove ${row.lead.name} from this campaign`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-alert-red disabled:opacity-50"
                        >
                          {removing === row.leadId ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
                          ) : (
                            <X className="h-3.5 w-3.5" strokeWidth={2.4} />
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {result && result.totalPages > 1 && (
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <Pagination page={page} totalPages={result.totalPages} onChange={setPage} />
        </div>
      )}
    </Card>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap px-2 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-slate-400">{hint}</span>}
    </label>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-accent-blue hover:underline"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={2.4} />
        All campaigns
      </Link>
      <Card className="mt-4 flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        {children}
      </Card>
    </>
  );
}
