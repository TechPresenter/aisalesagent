"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ApiError, leadsApi, type LawfulBasis } from "@/lib/api-client";
import { LAWFUL_BASIS_OPTIONS } from "@/lib/lead-import";
import { normalisePhonePreview } from "@/lib/phone";
import { LEAD_SOURCE, LEAD_STATUS } from "@/lib/status";
import { LEAD_STATUSES, type LeadSource, type LeadStatus } from "@/lib/types";
import { usePermission } from "@/lib/use-session";

const FIELD =
  "h-10 w-full rounded-btn border border-slate-200 bg-surface px-3 text-[13.5px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25";

/**
 * Where a hand-entered lead can say it came from. Upload, Import, API and AI Found
 * describe machinery, not a person typing a lead in, so they are not offered here.
 */
const MANUAL_SOURCES: LeadSource[] = ["MANUAL", "REFERRAL", "WEBSITE", "SOCIAL_MEDIA"];

/**
 * Adds one lead by hand through `POST /leads` — the way in for the lead someone met at an
 * event or took a call from, which no import file will ever hold.
 *
 * Offers exactly the fields the create endpoint accepts, as the edit dialog does: a field
 * that saves nowhere is worse than no field. The number is checked as it is typed with
 * the same normalisation the import preview uses, and the server checks it again and
 * refuses a number the workspace already holds. On success the new lead opens, which is
 * both the confirmation and where the next thing (a call, a note) happens.
 */
export function AddLeadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [source, setSource] = useState<LeadSource>("MANUAL");
  const [status, setStatus] = useState<LeadStatus>("NEW");
  const [lawfulBasis, setLawfulBasis] = useState<LawfulBasis | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setPhone("");
    setCity("");
    setSource("MANUAL");
    setStatus("NEW");
    setLawfulBasis("");
    setError(null);
  }, [open]);

  const normalised = phone.trim() ? normalisePhonePreview(phone) : null;
  const phoneProblem = phone.trim() !== "" && normalised === null;
  const valid =
    name.trim().length >= 2 &&
    name.trim().length <= 200 &&
    normalised !== null &&
    phone.trim().length <= 32 &&
    city.trim().length <= 120;

  async function submit() {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const lead = await leadsApi.create({
        name: name.trim(),
        phone: phone.trim(),
        city: city.trim() || undefined,
        source,
        status,
        lawfulBasis: lawfulBasis || undefined,
      });
      onClose();
      router.push(`/leads/${lead.id}`);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.status === 403
            ? "Your role does not allow adding leads. Ask a workspace admin or manager."
            : cause.message
          : "We could not reach the server. Check your connection and try again.",
      );
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add lead"
      description="Add one lead by hand. To add many at once, import a CSV file."
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
            type="submit"
            form="add-lead-form"
            disabled={!valid || saving}
            className="inline-flex h-10 items-center gap-2 rounded-btn bg-brand-green px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#15A45D] disabled:bg-slate-200 disabled:text-slate-400"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />}
            Add lead
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

      <form
        id="add-lead-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
            Lead / company name <span className="text-alert-red">*</span>
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            required
            placeholder="e.g. Sharma Traders"
            className={FIELD}
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
              Phone <span className="text-alert-red">*</span>
            </span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              maxLength={32}
              required
              placeholder="+91 98765 43210"
              aria-invalid={phoneProblem}
              aria-describedby="add-lead-phone-hint"
              className={`tabular ${FIELD}`}
            />
            <span
              id="add-lead-phone-hint"
              className={`mt-1 block text-[11.5px] ${phoneProblem ? "text-[#C93B3B]" : "text-slate-500"}`}
            >
              {phoneProblem
                ? "This does not look like a phone number."
                : normalised
                  ? `Saved as +${normalised}`
                  : "Indian numbers can be entered with or without +91."}
            </span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">City</span>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              maxLength={120}
              className={FIELD}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Source</span>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as LeadSource)}
              className={FIELD}
            >
              {MANUAL_SOURCES.map((value) => (
                <option key={value} value={value}>
                  {LEAD_SOURCE[value].label}
                </option>
              ))}
            </select>
          </label>
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
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
            Why may we contact them?
          </span>
          <select
            value={lawfulBasis}
            onChange={(e) => setLawfulBasis(e.target.value as LawfulBasis | "")}
            className={FIELD}
          >
            <option value="">Not recorded</option>
            {LAWFUL_BASIS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </form>
    </Modal>
  );
}

/**
 * The two ways leads get into a workspace — Add Lead and Import — as one pair, used in
 * the Leads header and in the empty table. Each is shown only to a role that may use it,
 * so nobody is offered a button whose only outcome is a permission error. While the
 * session is still being read both show, rather than flashing in a frame later.
 */
export function LeadIntakeActions({ size = "lg" }: { size?: "md" | "lg" }) {
  const canCreate = usePermission("leads.create");
  const canImport = usePermission("leads.import");
  const [adding, setAdding] = useState(false);

  if (canCreate === false && canImport === false) return null;

  return (
    <>
      {canImport !== false && (
        <Button variant="secondary" size={size} asChild>
          <Link href="/leads/import">
            <Upload className="h-4 w-4" strokeWidth={2.2} />
            Import Leads
          </Link>
        </Button>
      )}
      {canCreate !== false && (
        <Button size={size} onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" strokeWidth={2.4} />
          Add Lead
        </Button>
      )}
      <AddLeadDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
