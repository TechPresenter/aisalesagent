"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, LayoutGrid, Webhook } from "lucide-react";
import { Card } from "@/components/ui/card";
import { AppsPanel } from "@/components/settings/integrations/apps-panel";
import { ApiKeysPanel } from "@/components/settings/integrations/api-keys-panel";
import { WebhooksPanel } from "@/components/settings/integrations/webhooks-panel";
import {
  integrationsApi,
  type IntegrationItem,
  type IntegrationsOverview,
} from "@/lib/api-client";
import { usePermission } from "@/lib/use-session";
import { cn } from "@/lib/utils";

type Section = "apps" | "webhooks" | "keys";

const SECTIONS: { value: Section; label: string; icon: typeof Webhook }[] = [
  { value: "apps", label: "Apps", icon: LayoutGrid },
  { value: "webhooks", label: "Webhooks", icon: Webhook },
  { value: "keys", label: "API keys", icon: KeyRound },
];

/**
 * Feature List §14 — Settings → Integrations: the app catalogue, outbound webhooks, and
 * API keys for the REST API.
 *
 * Each section is gated by its own permission, as the API gates it: seeing the catalogue
 * is `integrations.view`, changing it `integrations.manage`, and webhooks and API keys
 * each have theirs — both start at Admin, because each decides where workspace data goes.
 */
export function IntegrationsTab({
  onSaved,
  onError,
}: {
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [section, setSection] = useState<Section>("apps");
  const [overview, setOverview] = useState<IntegrationsOverview | null>(null);
  const [failed, setFailed] = useState(false);

  const canView = usePermission("integrations.view");
  const canManage = usePermission("integrations.manage") === true;
  const canWebhooks = usePermission("webhooks.manage") === true;
  const canKeys = usePermission("apikeys.manage") === true;

  useEffect(() => {
    if (canView !== true) return;
    integrationsApi.overview().then(setOverview, () => setFailed(true));
  }, [canView]);

  const replaceItem = useCallback((item: IntegrationItem) => {
    setOverview((current) =>
      current
        ? {
            ...current,
            items: current.items.map((entry) => (entry.provider === item.provider ? item : entry)),
          }
        : current,
    );
  }, []);

  if (canView === false) {
    return (
      <Card className="p-5">
        <p className="text-[13px] text-slate-500">Your role does not include access to integrations.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Integration sections"
        className="inline-flex rounded-btn border border-slate-200 bg-surface p-1 shadow-card"
      >
        {SECTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={section === value}
            onClick={() => setSection(value)}
            className={cn(
              "inline-flex items-center gap-2 rounded-[8px] px-3.5 py-2 text-[13px] font-semibold transition-colors",
              section === value ? "bg-brand-navy text-white" : "text-slate-500 hover:text-brand-navy",
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={2} />
            {label}
          </button>
        ))}
      </div>

      {section === "apps" &&
        (failed ? (
          <Card className="p-5">
            <p className="text-[13px] text-slate-500">Could not load the integrations.</p>
          </Card>
        ) : !overview ? (
          <Card className="p-5">
            <p className="text-[13px] text-slate-400">Loading integrations…</p>
          </Card>
        ) : (
          <AppsPanel overview={overview} canManage={canManage} onItemChanged={replaceItem} onNotice={onSaved} />
        ))}

      {section === "webhooks" && (
        <WebhooksPanel
          events={overview?.events ?? []}
          canManage={canWebhooks}
          onNotice={onSaved}
          onError={onError}
        />
      )}

      {section === "keys" && <ApiKeysPanel canManage={canKeys} onNotice={onSaved} onError={onError} />}
    </div>
  );
}
