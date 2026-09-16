"use client";

import { useEffect, useState } from "react";
import { Loader2, PhoneOff } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AGENT_LANGUAGES,
  agentsApi,
  callSettingsApi,
  type ApiAgent,
  type CallSettings,
  type CallSettingsPatch,
  type VoicemailBehavior,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** Monday first, the way a working week is read; Sunday is 0 in the stored array. */
const DAYS: { value: number; label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const VOICEMAIL: { value: VoicemailBehavior; label: string }[] = [
  { value: "HANG_UP", label: "Hang up" },
  { value: "LEAVE_MESSAGE", label: "Leave a message" },
  { value: "RETRY_LATER", label: "Try again later" },
];

const FIELD =
  "h-11 w-full rounded-btn border border-slate-200 bg-surface px-3 text-[13.5px] text-brand-navy focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25 disabled:bg-slate-50 disabled:text-slate-500";

/** Numeric inputs are held as text so a field can be empty while it is being retyped. */
interface Form {
  callingEnabled: boolean;
  defaultAiAgentId: string;
  defaultLanguage: string;
  callerId: string;
  timezone: string;
  callWindowStart: number;
  callWindowEnd: number;
  callDays: number[];
  maxCallsPerDay: string;
  maxAttemptsPerLead: string;
  retryDelayMinutes: string;
  ringTimeoutSeconds: string;
  maxCallSeconds: string;
  silenceTimeoutSeconds: string;
  voicemailBehavior: VoicemailBehavior;
  recordingEnabled: boolean;
  transcriptionEnabled: boolean;
  aiAnalysisEnabled: boolean;
  dncEnabled: boolean;
  recordingAnnouncement: boolean;
  consentRequired: boolean;
  blockedNumbers: string;
  allowedCountries: string;
  minimumBalanceRequired: string;
  stopWhenCreditsLow: boolean;
  lowCreditThreshold: string;
}

function toForm(settings: CallSettings): Form {
  return {
    callingEnabled: settings.callingEnabled,
    defaultAiAgentId: settings.defaultAiAgentId ?? "",
    defaultLanguage: settings.defaultLanguage,
    callerId: settings.callerId ?? "",
    timezone: settings.timezone,
    callWindowStart: settings.callWindowStart,
    callWindowEnd: settings.callWindowEnd,
    callDays: [...settings.callDays].sort((a, b) => a - b),
    maxCallsPerDay: settings.maxCallsPerDay === null ? "" : String(settings.maxCallsPerDay),
    maxAttemptsPerLead: String(settings.maxAttemptsPerLead),
    retryDelayMinutes: String(settings.retryDelayMinutes),
    ringTimeoutSeconds: String(settings.ringTimeoutSeconds),
    maxCallSeconds: String(settings.maxCallSeconds),
    silenceTimeoutSeconds: String(settings.silenceTimeoutSeconds),
    voicemailBehavior: settings.voicemailBehavior,
    recordingEnabled: settings.recordingEnabled,
    transcriptionEnabled: settings.transcriptionEnabled,
    aiAnalysisEnabled: settings.aiAnalysisEnabled,
    dncEnabled: settings.dncEnabled,
    recordingAnnouncement: settings.recordingAnnouncement,
    consentRequired: settings.consentRequired,
    blockedNumbers: settings.blockedNumbers.join("\n"),
    allowedCountries: settings.allowedCountries.join(", "),
    minimumBalanceRequired: String(settings.minimumBalanceRequired),
    stopWhenCreditsLow: settings.stopWhenCreditsLow,
    lowCreditThreshold: String(settings.lowCreditThreshold),
  };
}

/** An emptied number box means "leave it as it was", not "zero". */
function int(value: string, fallback: number): number {
  const parsed = Number(value);
  return value.trim() !== "" && Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function toPatch(form: Form, current: CallSettings): CallSettingsPatch {
  return {
    callingEnabled: form.callingEnabled,
    defaultAiAgentId: form.defaultAiAgentId || null,
    defaultLanguage: form.defaultLanguage,
    callerId: form.callerId.trim() || null,
    timezone: form.timezone.trim() || current.timezone,
    callWindowStart: form.callWindowStart,
    callWindowEnd: form.callWindowEnd,
    callDays: form.callDays,
    maxCallsPerDay:
      form.maxCallsPerDay.trim() === "" ? null : int(form.maxCallsPerDay, 1),
    maxAttemptsPerLead: int(form.maxAttemptsPerLead, current.maxAttemptsPerLead),
    retryDelayMinutes: int(form.retryDelayMinutes, current.retryDelayMinutes),
    ringTimeoutSeconds: int(form.ringTimeoutSeconds, current.ringTimeoutSeconds),
    maxCallSeconds: int(form.maxCallSeconds, current.maxCallSeconds),
    silenceTimeoutSeconds: int(form.silenceTimeoutSeconds, current.silenceTimeoutSeconds),
    voicemailBehavior: form.voicemailBehavior,
    recordingEnabled: form.recordingEnabled,
    transcriptionEnabled: form.transcriptionEnabled,
    aiAnalysisEnabled: form.aiAnalysisEnabled,
    dncEnabled: form.dncEnabled,
    recordingAnnouncement: form.recordingAnnouncement,
    consentRequired: form.consentRequired,
    blockedNumbers: form.blockedNumbers
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    allowedCountries: form.allowedCountries
      .split(",")
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean),
    minimumBalanceRequired: int(form.minimumBalanceRequired, current.minimumBalanceRequired),
    stopWhenCreditsLow: form.stopWhenCreditsLow,
    lowCreditThreshold: int(form.lowCreditThreshold, current.lowCreditThreshold),
  };
}

const minutesToTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const timeToMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
};

/**
 * Feature List §14 — Settings → Call Settings.
 *
 * These are the rules the dialer and the calling gates read before every call: the window,
 * the retry policy, the compliance flags, and the switch that decides whether any of it
 * rings a real phone. Until this screen existed they could only be changed in the database.
 *
 * The compliance defaults are conservative on purpose — a workspace has to opt *out* of
 * announcing that a call is recorded — so the wording here explains what each one turns
 * off rather than presenting them as ordinary toggles.
 */
export function CallSettingsTab({
  canManage,
  onSaved,
  onError,
}: {
  canManage: boolean;
  onSaved: (message: string) => void;
  onError: (cause: unknown) => void;
}) {
  const [settings, setSettings] = useState<CallSettings | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [agents, setAgents] = useState<ApiAgent[]>([]);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    callSettingsApi.get().then(
      (loaded) => {
        setSettings(loaded);
        setForm(toForm(loaded));
      },
      () => setFailed(true),
    );
    agentsApi
      .list({ activeOnly: true })
      .then(setAgents)
      .catch(() => setAgents([]));
  }, []);

  if (failed) {
    return (
      <Card className="p-5 text-[13px] text-slate-500">
        Could not load the calling rules. Your role may not include calling access.
      </Card>
    );
  }

  if (!settings || !form) {
    return <Card className="p-5 text-[13px] text-slate-400">Loading…</Card>;
  }

  const edit = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(settings));
  const disabled = !canManage;

  async function save() {
    if (!form || !settings || !dirty) return;
    setSaving(true);
    try {
      const updated = await callSettingsApi.update(toPatch(form, settings));
      setSettings(updated);
      setForm(toForm(updated));
      onSaved("Call settings saved.");
    } catch (cause) {
      onError(cause);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {!form.callingEnabled && (
        <p className="flex items-start gap-2.5 rounded-btn bg-warning-amber/[0.1] px-4 py-3 text-[13px] font-medium leading-relaxed text-[#B4761A]">
          <PhoneOff className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} />
          AI calling is switched off, so nothing dials — campaigns stay queued and Call Now is
          refused. The switch below is what turns it on.
        </p>
      )}

      <Card className="p-5">
        <CardHeader className="p-0">
          <CardTitle>AI calling</CardTitle>
          <Badge tone={form.callingEnabled ? "green" : "gray"}>
            {form.callingEnabled ? "On" : "Off"}
          </Badge>
        </CardHeader>

        <div className="mt-4 space-y-3">
          <Toggle
            label="Let this workspace place AI calls"
            hint="Off means nothing is dialled, whatever a campaign says."
            checked={form.callingEnabled}
            onChange={(value) => edit("callingEnabled", value)}
            disabled={disabled}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Default AI agent" hint="Used when a campaign does not name one.">
              <select
                value={form.defaultAiAgentId}
                onChange={(event) => edit("defaultAiAgentId", event.target.value)}
                disabled={disabled}
                className={FIELD}
              >
                <option value="">No default</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Default language">
              <select
                value={form.defaultLanguage}
                onChange={(event) => edit("defaultLanguage", event.target.value)}
                disabled={disabled}
                className={FIELD}
              >
                {AGENT_LANGUAGES.map((language) => (
                  <option key={language.value} value={language.value}>
                    {language.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Caller ID" hint="The number shown to the person being called.">
              <input
                value={form.callerId}
                onChange={(event) => edit("callerId", event.target.value)}
                disabled={disabled}
                placeholder="+91 98765 43210"
                className={`tabular ${FIELD}`}
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <CardTitle>When calls go out</CardTitle>
        <p className="mt-1 text-[13px] text-slate-500">
          Outside this window the dialer skips a lead rather than queuing it.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Timezone" hint="The clock the window is read in.">
            <input
              value={form.timezone}
              onChange={(event) => edit("timezone", event.target.value)}
              disabled={disabled}
              placeholder="Asia/Kolkata"
              className={FIELD}
            />
          </Field>
          <Field label="From">
            <input
              type="time"
              value={minutesToTime(form.callWindowStart)}
              onChange={(event) => edit("callWindowStart", timeToMinutes(event.target.value))}
              disabled={disabled}
              className={`tabular ${FIELD}`}
            />
          </Field>
          <Field label="Until">
            <input
              type="time"
              value={minutesToTime(form.callWindowEnd)}
              onChange={(event) => edit("callWindowEnd", timeToMinutes(event.target.value))}
              disabled={disabled}
              className={`tabular ${FIELD}`}
            />
          </Field>
        </div>

        <fieldset className="mt-4">
          <legend className="mb-1.5 text-[12.5px] font-medium text-slate-600">Days</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((day) => {
              const active = form.callDays.includes(day.value);
              return (
                <label
                  key={day.value}
                  className={cn(
                    "flex cursor-pointer items-center gap-1.5 rounded-btn border px-3 py-2 text-[12.5px] font-semibold transition-colors",
                    active
                      ? "border-brand-green bg-brand-green/[0.08] text-deep-green"
                      : "border-slate-200 text-slate-500 hover:bg-slate-50",
                    disabled && "cursor-not-allowed opacity-60",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    disabled={disabled}
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
        </fieldset>
      </Card>

      <Card className="p-5">
        <CardTitle>Attempts and retries</CardTitle>
        <p className="mt-1 text-[13px] text-slate-500">
          How persistent the dialer is with one lead — and where persistence stops.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Attempts per lead">
            <input
              value={form.maxAttemptsPerLead}
              onChange={(event) => edit("maxAttemptsPerLead", event.target.value)}
              disabled={disabled}
              inputMode="numeric"
              className={`tabular ${FIELD}`}
            />
          </Field>
          <Field label="Wait between attempts" hint="Minutes.">
            <input
              value={form.retryDelayMinutes}
              onChange={(event) => edit("retryDelayMinutes", event.target.value)}
              disabled={disabled}
              inputMode="numeric"
              className={`tabular ${FIELD}`}
            />
          </Field>
          <Field label="Calls per day" hint="Blank means no cap.">
            <input
              value={form.maxCallsPerDay}
              onChange={(event) => edit("maxCallsPerDay", event.target.value)}
              disabled={disabled}
              inputMode="numeric"
              placeholder="No cap"
              className={`tabular ${FIELD}`}
            />
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <CardTitle>How each call is handled</CardTitle>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Ring for" hint="Seconds before giving up.">
            <input
              value={form.ringTimeoutSeconds}
              onChange={(event) => edit("ringTimeoutSeconds", event.target.value)}
              disabled={disabled}
              inputMode="numeric"
              className={`tabular ${FIELD}`}
            />
          </Field>
          <Field label="Maximum call length" hint="Seconds. Caps what one call can cost.">
            <input
              value={form.maxCallSeconds}
              onChange={(event) => edit("maxCallSeconds", event.target.value)}
              disabled={disabled}
              inputMode="numeric"
              className={`tabular ${FIELD}`}
            />
          </Field>
          <Field label="Hang up after silence" hint="Seconds.">
            <input
              value={form.silenceTimeoutSeconds}
              onChange={(event) => edit("silenceTimeoutSeconds", event.target.value)}
              disabled={disabled}
              inputMode="numeric"
              className={`tabular ${FIELD}`}
            />
          </Field>
          <Field label="On voicemail">
            <select
              value={form.voicemailBehavior}
              onChange={(event) =>
                edit("voicemailBehavior", event.target.value as VoicemailBehavior)
              }
              disabled={disabled}
              className={FIELD}
            >
              {VOICEMAIL.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <CardTitle>Recording and AI</CardTitle>
        <div className="mt-4 space-y-3">
          <Toggle
            label="Record calls"
            hint="Recordings are what transcripts and summaries are made from."
            checked={form.recordingEnabled}
            onChange={(value) => edit("recordingEnabled", value)}
            disabled={disabled}
          />
          <Toggle
            label="Transcribe recordings"
            checked={form.transcriptionEnabled}
            onChange={(value) => edit("transcriptionEnabled", value)}
            disabled={disabled}
          />
          <Toggle
            label="Summarise and score with AI"
            hint="Turns each transcript into the summary, sentiment and lead score."
            checked={form.aiAnalysisEnabled}
            onChange={(value) => edit("aiAnalysisEnabled", value)}
            disabled={disabled}
          />
        </div>
      </Card>

      <Card className="p-5">
        <CardTitle>Compliance</CardTitle>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
          These decide who may be called and what they are told. Switching one off is a
          decision about the law where you are calling, not a preference.
        </p>

        <div className="mt-4 space-y-3">
          <Toggle
            label="Respect do-not-call lists"
            hint="Skips any lead marked do-not-call, and any number on the blocked list."
            checked={form.dncEnabled}
            onChange={(value) => edit("dncEnabled", value)}
            disabled={disabled}
          />
          <Toggle
            label="Announce that the call is recorded"
            hint="The agent says so at the start of every recorded call."
            checked={form.recordingAnnouncement}
            onChange={(value) => edit("recordingAnnouncement", value)}
            disabled={disabled}
          />
          <Toggle
            label="Require consent before continuing"
            hint="The agent stops unless the person agrees to carry on."
            checked={form.consentRequired}
            onChange={(value) => edit("consentRequired", value)}
            disabled={disabled}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Blocked numbers" hint="One per line. Never dialled.">
            <textarea
              value={form.blockedNumbers}
              onChange={(event) => edit("blockedNumbers", event.target.value)}
              disabled={disabled}
              rows={4}
              placeholder="+91 98765 43210"
              className="tabular scrollbar-thin w-full resize-y rounded-btn border border-slate-200 bg-surface p-3 text-[13px] leading-relaxed text-brand-navy focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25 disabled:bg-slate-50 disabled:text-slate-500"
            />
          </Field>
          <Field
            label="Allowed countries"
            hint="Two-letter codes, comma separated. Empty allows every country."
          >
            <textarea
              value={form.allowedCountries}
              onChange={(event) => edit("allowedCountries", event.target.value)}
              disabled={disabled}
              rows={4}
              placeholder="IN, AE"
              className="scrollbar-thin w-full resize-y rounded-btn border border-slate-200 bg-surface p-3 text-[13px] leading-relaxed text-brand-navy focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25 disabled:bg-slate-50 disabled:text-slate-500"
            />
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <CardTitle>Credit guards</CardTitle>
        <p className="mt-1 text-[13px] text-slate-500">
          What stops a campaign before the wallet is empty.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Minimum balance to start a call">
            <input
              value={form.minimumBalanceRequired}
              onChange={(event) => edit("minimumBalanceRequired", event.target.value)}
              disabled={disabled}
              inputMode="numeric"
              className={`tabular ${FIELD}`}
            />
          </Field>
          <Field label="Warn below">
            <input
              value={form.lowCreditThreshold}
              onChange={(event) => edit("lowCreditThreshold", event.target.value)}
              disabled={disabled}
              inputMode="numeric"
              className={`tabular ${FIELD}`}
            />
          </Field>
        </div>

        <div className="mt-3">
          <Toggle
            label="Stop dialling when credits run low"
            hint="Halts a dialer run rather than letting it fail call by call."
            checked={form.stopWhenCreditsLow}
            onChange={(value) => edit("stopWhenCreditsLow", value)}
            disabled={disabled}
          />
        </div>
      </Card>

      {disabled ? (
        <p className="rounded-lg bg-slate-50 p-3 text-[12.5px] text-slate-500">
          Your role can see the calling rules but not change them.
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {dirty && (
            <button
              type="button"
              onClick={() => setForm(toForm(settings))}
              className="h-11 rounded-btn border border-slate-200 px-4 text-[13.5px] font-semibold text-brand-navy transition-colors hover:bg-slate-50"
            >
              Discard changes
            </button>
          )}
          <Button
            className="h-11 bg-accent-blue hover:bg-[#1B6CD8]"
            onClick={() => void save()}
            disabled={!dirty || saving}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
            Save Changes
          </Button>
        </div>
      )}
    </div>
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

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:bg-slate-50",
        disabled && "cursor-not-allowed opacity-60 hover:bg-transparent",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 accent-[#19B969]"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-brand-navy">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-relaxed text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}
