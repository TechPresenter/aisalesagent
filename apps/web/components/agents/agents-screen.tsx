"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Copy,
  Loader2,
  PhoneCall,
  Plus,
  Power,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { PageTitle } from "@/components/shared/page-title";
import { PermissionGate } from "@/components/shared/permission-gate";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { FilterSelect } from "@/components/ui/filter-select";
import { AgentEditor } from "@/components/agents/agent-editor";
import {
  agentsApi,
  ApiError,
  AGENT_LANGUAGES,
  type AgentStats,
  type ApiAgent,
} from "@/lib/api-client";
import { useDebounced } from "@/lib/use-debounced";
import { toRole, useSessionUser } from "@/lib/use-session";
import { hasPermission } from "@appsgain/shared";
import { cn, formatNumber, initialsOf } from "@/lib/utils";
import type { Tone } from "@/lib/status";

const ALL = "all";

/** Feature List §12 — AI Agents. */
export function AgentsScreen() {
  const { user } = useSessionUser();
  const role = toRole(user?.role);
  const mayManage = role !== null && hasPermission(role, "agents.manage");

  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState(ALL);
  const [status, setStatus] = useState(ALL);

  const [agents, setAgents] = useState<ApiAgent[]>([]);
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [editing, setEditing] = useState<ApiAgent | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const debouncedSearch = useDebounced(search, 300);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, totals] = await Promise.all([
        agentsApi.list({
          search: debouncedSearch.trim() || undefined,
          language: language === ALL ? undefined : language,
          activeOnly: status === "active" ? true : undefined,
        }),
        agentsApi.stats().catch(() => null),
      ]);
      setAgents(status === "inactive" ? rows.filter((a) => !a.isActive) : rows);
      if (totals) setStats(totals);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not reach the server. Check that the API is running.",
      );
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, language, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const succeed = (text: string) => {
    setNotice({ tone: "ok", text });
    void load();
  };
  const fail = (cause: unknown, fallback: string) =>
    setNotice({ tone: "bad", text: cause instanceof ApiError ? cause.message : fallback });

  async function toggleActive(agent: ApiAgent) {
    setBusyId(agent.id);
    try {
      await agentsApi.update(agent.id, { isActive: !agent.isActive });
      succeed(`${agent.name} is now ${agent.isActive ? "off duty" : "on duty"}.`);
    } catch (cause) {
      fail(cause, "Could not change that agent.");
    } finally {
      setBusyId(null);
    }
  }

  async function duplicate(agent: ApiAgent) {
    setBusyId(agent.id);
    try {
      const copy = await agentsApi.duplicate(agent.id);
      succeed(`Copied to "${copy.name}". It starts off duty — review it, then turn it on.`);
    } catch (cause) {
      fail(cause, "Could not copy that agent.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(agent: ApiAgent) {
    if (!window.confirm(`Delete ${agent.name}? This cannot be undone.`)) return;
    setBusyId(agent.id);
    try {
      await agentsApi.remove(agent.id);
      succeed(`${agent.name} deleted.`);
    } catch (cause) {
      fail(cause, "Could not delete that agent.");
    } finally {
      setBusyId(null);
    }
  }

  const cards: { label: string; value: number | string; icon: typeof Bot; tone: Tone }[] = [
    { label: "Agents", value: stats?.total ?? 0, icon: Bot, tone: "blue" },
    { label: "On Duty", value: stats?.active ?? 0, icon: CheckCircle2, tone: "green" },
    { label: "Calls Placed", value: stats?.callsPlaced ?? 0, icon: PhoneCall, tone: "purple" },
    {
      label: "Connect Rate",
      value: `${stats?.connectRate ?? 0}%`,
      icon: TrendingUp,
      tone: "amber",
    },
  ];

  return (
    <>
      <PageTitle
        title="AI Agents"
        subtitle="The voices that make your calls — what they say, and how they say it."
        actions={
          <PermissionGate permission="agents.manage">
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="inline-flex h-11 items-center gap-2 rounded-btn bg-accent-blue px-5 text-[14.5px] font-semibold text-white shadow-sm transition-colors hover:bg-[#1B6CD8]"
            >
              <Plus className="h-4 w-4" strokeWidth={2.6} />
              New Agent
            </button>
          </PermissionGate>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, icon, tone }) =>
          stats ? (
            <StatCard
              key={label}
              label={label}
              value={value}
              sparkline={[]}
              icon={icon}
              tone={tone}
            />
          ) : (
            <Card key={label} className="flex items-center gap-3 p-4">
              <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-slate-100" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-6 w-16 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
              </div>
            </Card>
          ),
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

      <Card className="mb-5">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search agents by name or personality..."
            className="min-w-[220px] flex-1"
          />
          <FilterSelect
            label="Language"
            value={language}
            onChange={setLanguage}
            className="w-[170px]"
            options={[
              { value: ALL, label: "All Languages" },
              ...AGENT_LANGUAGES.map(({ value, label }) => ({ value, label })),
            ]}
          />
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            className="w-[140px]"
            options={[
              { value: ALL, label: "All" },
              { value: "active", label: "On duty" },
              { value: "inactive", label: "Off duty" },
            ]}
          />
        </div>
      </Card>

      {loading && agents.length === 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          <span className="sr-only">Loading agents</span>
          {Array.from({ length: 3 }, (_, i) => (
            <Card key={i} className="space-y-3 p-5">
              <div className="h-11 w-11 animate-pulse rounded-full bg-slate-100" />
              <div className="h-4 w-32 animate-pulse rounded bg-slate-100" />
              <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
            </Card>
          ))}
        </div>
      )}

      {error && agents.length === 0 && (
        <Card className="px-5 py-14 text-center">
          <p className="text-[13.5px] font-medium text-brand-navy">Could not load agents.</p>
          <p className="mt-1 text-[12.5px] text-slate-500">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 inline-flex h-9 items-center rounded-btn border border-slate-200 px-4 text-[13px] font-semibold text-accent-blue transition-colors hover:bg-slate-50"
          >
            Try again
          </button>
        </Card>
      )}

      {!loading && !error && agents.length === 0 && (
        <Card className="px-5 py-14 text-center">
          <Bot className="mx-auto h-8 w-8 text-slate-300" strokeWidth={1.6} />
          <p className="mt-2 text-[13.5px] font-medium text-brand-navy">No agents yet.</p>
          <p className="mt-1 text-[12.5px] text-slate-500">
            An agent is a script and a voice. Campaigns pick one to make their calls.
          </p>
        </Card>
      )}

      {agents.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              mayManage={mayManage}
              busy={busyId === agent.id}
              onEdit={() => setEditing(agent)}
              onToggle={() => void toggleActive(agent)}
              onDuplicate={() => void duplicate(agent)}
              onDelete={() => void remove(agent)}
            />
          ))}
        </div>
      )}

      <AgentEditor
        open={editing !== null}
        agent={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={(message) => {
          setEditing(null);
          succeed(message);
        }}
      />
    </>
  );
}

function AgentCard({
  agent,
  mayManage,
  busy,
  onEdit,
  onToggle,
  onDuplicate,
  onDelete,
}: {
  agent: ApiAgent;
  mayManage: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const languageLabel =
    AGENT_LANGUAGES.find((l) => l.value === agent.language)?.label ?? agent.language;
  const questions = agent.qualificationQuestions?.length ?? 0;
  const objections = agent.objectionHandling?.length ?? 0;

  return (
    <Card className={cn("flex flex-col p-5", !agent.isActive && "opacity-70")}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-purple/[0.13] text-[14px] font-bold text-accent-purple"
        >
          {initialsOf(agent.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[15px] font-bold tracking-tight text-brand-navy">
              {agent.name}
            </h3>
            <Badge tone={agent.isActive ? "green" : "gray"}>
              {agent.isActive ? "On duty" : "Off duty"}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-slate-500">
            {languageLabel}
            {agent.gender ? ` · ${agent.gender}` : ""}
            {agent.accent ? ` · ${agent.accent}` : ""}
          </p>
        </div>
      </div>

      <p className="mt-3 line-clamp-2 min-h-[2.4em] text-[12.5px] leading-snug text-slate-600">
        {agent.personality ?? agent.openingMessage ?? "No personality set yet."}
      </p>

      <dl className="mt-3 grid grid-cols-4 gap-2 rounded-lg bg-slate-50 p-2.5">
        <Metric label="Calls" value={formatNumber(agent._count.calls)} />
        <Metric label="Campaigns" value={formatNumber(agent._count.campaigns)} />
        <Metric label="Questions" value={String(questions)} />
        <Metric label="Objections" value={String(objections)} />
      </dl>

      {mayManage && (
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="h-9 flex-1 rounded-btn bg-accent-blue text-[13px] font-semibold text-white transition-colors hover:bg-[#1B6CD8]"
          >
            Edit script
          </button>
          <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            title={agent.isActive ? "Take off duty" : "Put on duty"}
            aria-label={agent.isActive ? `Take ${agent.name} off duty` : `Put ${agent.name} on duty`}
            className="flex h-9 w-9 items-center justify-center rounded-btn border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-brand-navy disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
            ) : (
              <Power className="h-3.5 w-3.5" strokeWidth={2.2} />
            )}
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            disabled={busy}
            title="Duplicate"
            aria-label={`Duplicate ${agent.name}`}
            className="flex h-9 w-9 items-center justify-center rounded-btn border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-brand-navy disabled:opacity-40"
          >
            <Copy className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            title={
              agent._count.calls > 0
                ? "This agent has a call history — take it off duty instead"
                : "Delete"
            }
            aria-label={`Delete ${agent.name}`}
            className="flex h-9 w-9 items-center justify-center rounded-btn border border-slate-200 text-slate-400 transition-colors hover:border-alert-red/50 hover:bg-alert-red/[0.07] hover:text-alert-red disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
        </div>
      )}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 text-center">
      <dd className="tabular text-[14px] font-bold text-brand-navy">{value}</dd>
      <dt className="truncate text-[10.5px] text-slate-500">{label}</dt>
    </div>
  );
}
