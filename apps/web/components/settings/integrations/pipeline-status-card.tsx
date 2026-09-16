"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { providersApi, type ProviderHealth } from "@/lib/api-client";
import { cn, formatDateTime } from "@/lib/utils";

const KIND_LABEL: Record<string, { title: string; blurb: string }> = {
  TELEPHONY: { title: "Telephony", blurb: "Places the calls and streams the audio." },
  SPEECH_TO_TEXT: {
    title: "Speech to text",
    blurb: "Turns call audio into the transcripts behind every summary.",
  },
  TEXT_TO_SPEECH: { title: "Text to speech", blurb: "Gives each AI agent its voice." },
  LLM: {
    title: "Language model",
    blurb: "Runs the conversation, the qualification and the call summary.",
  },
};

/**
 * What the calling pipeline is actually running on, from `GET /providers/health`.
 *
 * Kept beside the catalogue on purpose. Connecting Twilio or ElevenLabs above checks and
 * stores the account; this card answers the different question of what places calls right
 * now — the sandbox, until a live adapter exists — so nobody reads "Connected" on a
 * telephony card as "calls are real".
 */
export function PipelineStatusCard() {
  const [providers, setProviders] = useState<ProviderHealth[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    providersApi.health().then(
      (result) => setProviders(result.providers),
      () => setFailed(true),
    );
  }, []);

  return (
    <Card className="p-5">
      <CardHeader className="p-0">
        <CardTitle>Calling pipeline</CardTitle>
        {providers && (
          <Badge tone={providers.some((provider) => provider.usingSandbox) ? "amber" : "green"}>
            {providers.some((provider) => provider.usingSandbox) ? "Sandbox in use" : "Live"}
          </Badge>
        )}
      </CardHeader>
      <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">
        What AI calls run on right now. Sandbox means nothing leaves this server: calls are
        simulated and no audio is produced, whichever accounts are connected above.
      </p>

      {failed ? (
        <p className="mt-4 text-[13px] text-slate-500">Could not read the pipeline status.</p>
      ) : !providers ? (
        <p className="mt-4 text-[13px] text-slate-400">Loading…</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {providers.map((provider) => {
            const meta = KIND_LABEL[provider.kind] ?? { title: provider.kind, blurb: "" };
            return (
              <li key={provider.kind} className="flex flex-wrap items-start gap-3 py-3">
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
                  {provider.usingSandbox ? "Sandbox" : provider.configured ? "Live" : "Not configured"}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
