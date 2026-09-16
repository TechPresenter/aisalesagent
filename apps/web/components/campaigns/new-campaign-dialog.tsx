"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import {
  agentsApi,
  ApiError,
  campaignsApi,
  type ApiAgent,
  type CampaignType,
} from "@/lib/api-client";
import { CAMPAIGN_TYPE } from "@/lib/campaign-display";

const FIELD =
  "h-10 w-full rounded-btn border border-slate-200 bg-surface px-3 text-[13.5px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25";

/** Types that dial, and so can take an AI agent. */
const CALLING_TYPES: CampaignType[] = ["AI_CALLING", "MULTI_CHANNEL"];

/**
 * Feature List §4 — create a campaign. It is created as a draft: activating it is a
 * separate step the server checks — an agent assigned, leads attached — before it will
 * dial anyone, so nothing here can start calls by accident.
 */
export function NewCampaignDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<CampaignType>("AI_CALLING");
  const [agentId, setAgentId] = useState("");
  const [audience, setAudience] = useState("");
  const [description, setDescription] = useState("");
  const [agents, setAgents] = useState<ApiAgent[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setType("AI_CALLING");
    setAgentId("");
    setAudience("");
    setDescription("");
    setError(null);
    agentsApi
      .list({ activeOnly: true })
      .then(setAgents)
      .catch(() => setAgents([]));
  }, [open]);

  const canPickAgent = CALLING_TYPES.includes(type);
  const valid = name.trim().length >= 2;

  async function submit() {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const campaign = await campaignsApi.create({
        name: name.trim(),
        type,
        description: description.trim() || undefined,
        targetAudience: audience.trim() || undefined,
        aiAgentId: canPickAgent && agentId ? agentId : undefined,
      });
      onCreated(`"${campaign.name}" created as a draft.`);
      onClose();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not create the campaign.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New campaign"
      description="Campaigns start as drafts. Nothing is dialled until you activate one."
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-btn border border-slate-200 px-4 text-[13.5px] font-semibold text-brand-navy transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!valid || saving}
            className="inline-flex h-10 items-center gap-2 rounded-btn bg-brand-green px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#15A45D] disabled:bg-slate-200 disabled:text-slate-400"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />}
            Create campaign
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

      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
            placeholder="e.g. Q4 Dental Clinics — Mumbai"
            className={FIELD}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as CampaignType)}
              className={FIELD}
            >
              {(Object.keys(CAMPAIGN_TYPE) as CampaignType[]).map((value) => (
                <option key={value} value={value}>
                  {CAMPAIGN_TYPE[value].label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
              AI agent <span className="text-slate-400">(optional)</span>
            </span>
            <select
              value={canPickAgent ? agentId : ""}
              onChange={(e) => setAgentId(e.target.value)}
              disabled={!canPickAgent}
              className={`${FIELD} disabled:bg-slate-50 disabled:text-slate-400`}
            >
              <option value="">{canPickAgent ? "Choose later" : "Not used for this type"}</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
            Target audience <span className="text-slate-400">(optional)</span>
          </span>
          <input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            maxLength={500}
            placeholder="e.g. Dental clinics with 2+ chairs"
            className={FIELD}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
            Description <span className="text-slate-400">(optional)</span>
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="What this campaign is for..."
            className="scrollbar-thin w-full resize-y rounded-lg border border-slate-200 bg-surface p-3 text-[13px] leading-relaxed text-slate-700 placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25"
          />
        </label>
      </div>
    </Modal>
  );
}
