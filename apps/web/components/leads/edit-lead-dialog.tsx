"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ApiError, leadsApi, type ApiLead } from "@/lib/api-client";
import { LEAD_STATUS } from "@/lib/status";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/types";

const FIELD =
  "h-10 w-full rounded-btn border border-slate-200 bg-surface px-3 text-[13.5px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25";

/**
 * Edits the fields `PATCH /leads/:id` accepts. Contact person, email and address are not
 * in that DTO yet, so they are not offered — a field that saves nowhere is worse than no
 * field at all.
 */
export function EditLeadDialog({
  open,
  onClose,
  onSaved,
  lead,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  lead: ApiLead;
}) {
  const [name, setName] = useState(lead.name);
  const [phone, setPhone] = useState(lead.phone);
  const [city, setCity] = useState(lead.city ?? "");
  const [status, setStatus] = useState<LeadStatus>(lead.status);
  const [score, setScore] = useState(String(lead.score));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(lead.name);
    setPhone(lead.phone);
    setCity(lead.city ?? "");
    setStatus(lead.status);
    setScore(String(lead.score));
    setError(null);
  }, [open, lead]);

  const scoreValue = Number(score);
  const valid =
    name.trim().length >= 2 &&
    phone.trim().length > 0 &&
    score.trim() !== "" &&
    Number.isInteger(scoreValue) &&
    scoreValue >= 0 &&
    scoreValue <= 100;

  async function submit() {
    // Only what changed, so saving cannot overwrite a field someone else set meanwhile.
    const patch: Parameters<typeof leadsApi.update>[1] = {};
    if (name.trim() !== lead.name) patch.name = name.trim();
    if (phone.trim() !== lead.phone) patch.phone = phone.trim();
    if (city.trim() !== (lead.city ?? "")) patch.city = city.trim();
    if (status !== lead.status) patch.status = status;
    if (scoreValue !== lead.score) patch.score = scoreValue;

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await leadsApi.update(lead.id, patch);
      onSaved(`${name.trim()} updated.`);
      onClose();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save the lead.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit lead"
      description="Changes are recorded on the lead's activity timeline."
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
            Save changes
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
          <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Lead name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={FIELD} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Phone</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              className={`tabular ${FIELD}`}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">City</span>
            <input value={city} onChange={(e) => setCity(e.target.value)} className={FIELD} />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as LeadStatus)}
              className={FIELD}
            >
              {LEAD_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {LEAD_STATUS[value].label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
              Lead score <span className="text-slate-400">(0–100)</span>
            </span>
            <input
              value={score}
              onChange={(e) => setScore(e.target.value.replace(/\D/g, "").slice(0, 3))}
              inputMode="numeric"
              className={`tabular ${FIELD}`}
            />
          </label>
        </div>
      </div>
    </Modal>
  );
}
