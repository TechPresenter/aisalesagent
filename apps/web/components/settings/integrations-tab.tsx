"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { providersApi, type ProviderHealth } from "@/lib/api-client";
import { cn, formatDateTime } from "@/lib/utils";

const KIND_LABEL: Record<string, { title: string; blurb: string }> = {
  TELEPHONY: {
    title: "Telephony",
    blurb: "Places the calls and streams the audio.",
  },
  SPEECH_TO_TEXT: {
    title: "Speech to text",
    blurb: "Turns call audio into the transcripts behind every summary.",
  },
  TEXT_TO_SPEECH: {
    title: "Text to speech",
    blurb: "Gives each AI agent its voice.",
  },
  LLM: {
    title: "Language model",
    blurb: "Runs the conversation, the qualification and the call summary.",
  },
};

/**
 * Feature List §14 — Settings → Integrations.
 *
 * Read-only, and deliberately so: `GET /providers/health` reports what each provider is
 * and whether it answers, but there is no endpoint that stores credentials yet. A form
 * that accepted an API key and dropped it would be worse than a page that says where the
 * keys go today.
 */
export function IntegrationsTab() {
  const [state, setState] = useState<{
    encryptionReady: boolean;
    providers: ProviderHealth[];
  } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    providersApi.health().then(setState, () => setFailed(true));
  }, []);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <CardHeader className="p-0">
          <CardTitle>AI &amp; telephony providers</CardTitle>
          {state && (
            <Badge tone={state.encryptionReady ? "green" : "amber"}>
              {state.encryptionReady ? "Credential storage ready" : "Encryption key missing"}
            </Badge>
          )}
        </CardHeader>

        {failed ? (
          <p className="mt-4 text-[13px] text-slate-500">
            Could not read provider status. Your role may not include integrations access.
          </p>
        ) : !state ? (
          <p className="mt-4 text-[13px] text-slate-400">Loading…</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {state.providers.map((provider) => {
              const meta = KIND_LABEL[provider.kind] ?? { title: provider.kind, blurb: "" };
              return (
                <li key={provider.kind} className="flex flex-wrap items-start gap-3 py-3.5">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                      provider.reachable ? "bg-brand-green" : "bg-alert-red",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-brand-navy">{meta.title}</p>
                    <p className="text-[12.5px] text-slate-500">{meta.blurb}</p>
                    {provider.detail && (
                      <p className="mt-1 text-[12px] text-[#C93B3B]">{provider.detail}</p>
                    )}
                    <p className="tabular mt-1 text-[11.5px] text-slate-400">
                      {provider.provider} · checked {formatDateTime(provider.checkedAt)}
                    </p>
                  </div>
                  <Badge tone={provider.usingSandbox ? "amber" : provider.configured ? "green" : "gray"}>
                    {provider.usingSandbox
                      ? "Sandbox"
                      : provider.configured
                        ? (provider.configuredProvider ?? "Connected")
                        : "Not configured"}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <CardTitle>Connecting a real provider</CardTitle>
        <div className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-slate-600">
          <p>
            Sandbox means nothing leaves this machine: calls are simulated, and no audio or
            transcript is produced. Until a provider is connected, the AI Calling console says
            so on every call it shows.
          </p>
          <p>
            Credentials are stored encrypted against{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11.5px]">
              CREDENTIALS_ENCRYPTION_KEY
            </code>
            , which is why the badge above reports whether that key is present. The screen for
            entering them is not built yet — the provider records are created through the API.
          </p>
          <p>
            CRM, calendar and WhatsApp Business integrations are in the data model but have no
            endpoints yet, so they are not listed here rather than shown as switches that would
            not connect anything.
          </p>
        </div>
      </Card>
    </div>
  );
}
