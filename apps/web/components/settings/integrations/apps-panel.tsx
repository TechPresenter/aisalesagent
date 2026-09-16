"use client";

import { useCallback, useMemo, useState } from "react";
import { CircleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import type {
  IntegrationCategory,
  IntegrationItem,
  IntegrationsOverview,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ConnectDialog } from "./connect-dialog";
import { PipelineStatusCard } from "./pipeline-status-card";
import { CATEGORY_META, ConnectionBadge, IntegrationLogo, featureSummary } from "./shared";

type Filter = IntegrationCategory | "ALL" | "CONNECTED";

/**
 * Settings → Integrations → Apps: every third party in the catalogue, by category.
 *
 * Each card says in a phrase what the integration takes part in once connected ("Syncs
 * new leads", "Checks and stores credentials"), so the difference between a CRM that
 * really receives leads and a telephony account that is only stored for later is visible
 * before anyone opens a dialog.
 */
export function AppsPanel({
  overview,
  canManage,
  onItemChanged,
  onNotice,
}: {
  overview: IntegrationsOverview;
  canManage: boolean;
  onItemChanged: (item: IntegrationItem) => void;
  onNotice: (text: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [openProvider, setOpenProvider] = useState<string | null>(null);

  const open = overview.items.find((item) => item.provider === openProvider) ?? null;
  const closeDialog = useCallback(() => setOpenProvider(null), []);

  const connected = overview.items.filter((item) => item.connection !== null);
  const attention = connected.filter(
    (item) => item.connection && item.connection.status !== "CONNECTED",
  );

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return overview.items.filter((item) => {
      if (filter === "CONNECTED" && !item.connection) return false;
      if (filter !== "ALL" && filter !== "CONNECTED" && item.category !== filter) return false;
      if (!term) return true;
      return (
        item.name.toLowerCase().indexOf(term) >= 0 ||
        item.description.toLowerCase().indexOf(term) >= 0 ||
        CATEGORY_META[item.category].label.toLowerCase().indexOf(term) >= 0
      );
    });
  }, [overview.items, query, filter]);

  const chips: { value: Filter; label: string; count: number }[] = [
    { value: "ALL", label: "All", count: overview.items.length },
    { value: "CONNECTED", label: "Connected", count: connected.length },
    ...overview.categories.map((category) => ({
      value: category as Filter,
      label: CATEGORY_META[category].label,
      count: overview.items.filter((item) => item.category === category).length,
    })),
  ];

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold tracking-tight text-brand-navy">Apps</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
              Connect the tools your team already uses. Credentials are checked with the vendor
              before they are saved, and stored encrypted.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={connected.length > 0 ? "green" : "gray"}>{connected.length} connected</Badge>
            {attention.length > 0 && <Badge tone="red">{attention.length} need attention</Badge>}
            <Badge tone={overview.encryptionReady ? "green" : "amber"}>
              {overview.encryptionReady ? "Encryption ready" : "Encryption key missing"}
            </Badge>
          </div>
        </div>

        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search integrations…"
          className="mt-4"
        />

        <div role="tablist" aria-label="Filter integrations" className="scrollbar-thin -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {chips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              role="tab"
              aria-selected={filter === chip.value}
              onClick={() => setFilter(chip.value)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                filter === chip.value
                  ? "border-accent-blue bg-accent-blue text-white"
                  : "border-slate-200 text-slate-600 hover:border-slate-300 hover:text-brand-navy",
              )}
            >
              {chip.label}
              <span
                className={cn(
                  "tabular text-[11px] font-medium",
                  filter === chip.value ? "text-white/80" : "text-slate-400",
                )}
              >
                {chip.count}
              </span>
            </button>
          ))}
        </div>
      </Card>

      {visible.length === 0 ? (
        <Card className="p-8 text-center text-[13px] text-slate-500">
          {filter === "CONNECTED" && !query
            ? "Nothing is connected yet. Pick an app from All to get started."
            : "No integration matches that search."}
        </Card>
      ) : (
        overview.categories
          .filter((category) => visible.some((item) => item.category === category))
          .map((category) => (
            <section key={category} aria-labelledby={`category-${category}`}>
              <div className="mb-2 px-1">
                <h3 id={`category-${category}`} className="text-[14px] font-bold text-brand-navy">
                  {CATEGORY_META[category].label}
                </h3>
                <p className="text-[12.5px] text-slate-500">{CATEGORY_META[category].blurb}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {visible
                  .filter((item) => item.category === category)
                  .map((item) => (
                    <IntegrationCard
                      key={item.provider}
                      item={item}
                      canManage={canManage}
                      onOpen={() => setOpenProvider(item.provider)}
                    />
                  ))}
              </div>
            </section>
          ))
      )}

      <PipelineStatusCard />

      <ConnectDialog
        item={open}
        events={overview.events}
        oauthRedirectUri={overview.oauthRedirectUri}
        encryptionReady={overview.encryptionReady}
        canManage={canManage}
        onClose={closeDialog}
        onChanged={(item, notice) => {
          onItemChanged(item);
          if (notice) onNotice(notice);
        }}
      />
    </div>
  );
}

function IntegrationCard({
  item,
  canManage,
  onOpen,
}: {
  item: IntegrationItem;
  canManage: boolean;
  onOpen: () => void;
}) {
  const connection = item.connection;
  const troubled = connection !== null && connection.status !== "CONNECTED";

  return (
    <div
      className={cn(
        "flex flex-col rounded-card border bg-surface p-4 shadow-card transition-colors",
        troubled ? "border-alert-red/40" : "border-slate-200/70 hover:border-slate-300",
      )}
    >
      <div className="flex items-start gap-3">
        <IntegrationLogo name={item.name} color={item.color} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold text-brand-navy">{item.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <ConnectionBadge item={item} />
            {!connection && !(item.auth === "oauth" && item.oauthReady === false) && (
              <span className="text-[11.5px] text-slate-400">Not connected</span>
            )}
          </div>
        </div>
      </div>

      <p className="mt-2.5 line-clamp-2 min-h-[2.6em] text-[12.5px] leading-snug text-slate-500">
        {item.description}
      </p>

      {connection?.account && (
        <p className="mt-2 truncate text-[12px] font-medium text-slate-600" title={connection.account}>
          {connection.account}
        </p>
      )}
      {troubled && connection?.lastError && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-[#C93B3B]">
          <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          <span className="line-clamp-2">{connection.lastError}</span>
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-3.5">
        <span className="truncate text-[11.5px] font-medium text-slate-400">{featureSummary(item)}</span>
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            "h-8 shrink-0 rounded-btn px-3 text-[12.5px] font-semibold transition-colors",
            connection
              ? "border border-slate-300 text-brand-navy hover:bg-slate-50"
              : canManage
                ? "bg-brand-green text-white hover:bg-[#15A45D]"
                : "border border-slate-300 text-brand-navy hover:bg-slate-50",
          )}
        >
          {connection ? "Manage" : canManage ? "Connect" : "Details"}
        </button>
      </div>
    </div>
  );
}
