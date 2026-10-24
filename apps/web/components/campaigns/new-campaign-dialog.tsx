"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import {
  agentsApi,
  ApiError,
  campaignsApi,
  type ApiAgent,
  type CampaignType,
} from "@/lib/api-client";
import { CAMPAIGN_TYPE } from "@/lib/campaign-display";
import { CALLING_TYPES, WEEK_DAYS, timeToMinutes, timezoneOptions } from "@/lib/campaign-setup";
import { cn } from "@/lib/utils";

const FIELD =
  "h-10 w-full rounded-btn border border-slate-200 bg-surface px-3 text-[13.5px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25";

/** The optional schedule, as typed. Empty fields follow the workspace's call settings. */
interface ScheduleFields {
  timezone: string;
  windowStart: string;
  windowEnd: string;
  callDays: number[];
  startDate: string;
  endDate: string;
}

const EMPTY_SCHEDULE: ScheduleFields = {
  timezone: "",
  windowStart: "",
  windowEnd: "",
  callDays: [],
  startDate: "",
  endDate: "",
};

/** Why the API would refuse this schedule, in its words; null when it would not. */
function scheduleProblem(schedule: ScheduleFields): string | null {
  const start = schedule.windowStart ? timeToMinutes(schedule.windowStart) : null;
  const end = schedule.windowEnd ? timeToMinutes(schedule.windowEnd) : null;
  if ((start === null) !== (end === null)) {
    return "Set both ends of the calling window, or leave both empty to use the workspace's hours.";
  }
  if (start !== null && end !== null && end <= start) {
    return "The calling window must end after it starts.";
  }
  if (schedule.startDate && schedule.endDate && schedule.endDate <= schedule.startDate) {
    return "The end date must be after the start date.";
  }
  return null;
}

/**
 * Feature List §4 — create a campaign. It is created as a draft: activating it is a
 * separate step the server checks — an agent, a script and leads — before it will dial
 * anyone, so nothing here can start calls by accident.
 *
 * The schedule is optional and folded away: every part of it left empty follows the
 * workspace's call settings. Once created, the campaign's own page opens, which is where
 * its script and leads are set up and where it is activated.
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
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<CampaignType>("AI_CALLING");
  const [agentId, setAgentId] = useState("");
  const [audience, setAudience] = useState("");
  const [description, setDescription] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleFields>(EMPTY_SCHEDULE);
  const [agents, setAgents] = useState<ApiAgent[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const zones = useMemo(() => (open ? timezoneOptions() : []), [open]);

  useEffect(() => {
    if (!open) return;
    setName("");
    setType("AI_CALLING");
    setAgentId("");
    setAudience("");
    setDescription("");
    setShowSchedule(false);
    setSchedule(EMPTY_SCHEDULE);
    setError(null);
    agentsApi
      .list({ activeOnly: true })
      .then(setAgents)
      .catch(() => setAgents([]));
  }, [open]);

  const canPickAgent = CALLING_TYPES.includes(type);
  const valid = name.trim().length >= 2;
  const editSchedule = <K extends keyof ScheduleFields>(key: K, value: ScheduleFields[K]) =>
    setSchedule((current) => ({ ...current, [key]: value }));

  async function submit() {
    if (!valid) return;
    const problem = scheduleProblem(schedule);
    if (problem) {
      setShowSchedule(true);
      setError(problem);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const campaign = await campaignsApi.create({
        name: name.trim(),
        type,
        description: description.trim() || undefined,
        targetAudience: audience.trim() || undefined,
        aiAgentId: canPickAgent && agentId ? agentId : undefined,
        timezone: schedule.timezone || undefined,
        callWindowStart: schedule.windowStart
          ? (timeToMinutes(schedule.windowStart) ?? undefined)
          : undefined,
        callWindowEnd: schedule.windowEnd
          ? (timeToMinutes(schedule.windowEnd) ?? undefined)
          : undefined,
        callDays: schedule.callDays.length > 0 ? schedule.callDays : undefined,
        startDate: schedule.startDate || undefined,
        endDate: schedule.endDate || undefined,
      });
      onCreated(`"${campaign.name}" created as a draft.`);
      onClose();
      // Straight to its page: a new campaign still needs its script checked and its leads
      // added before it can be activated, and that is where both happen.
      router.push(`/campaigns/${campaign.id}`);
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
            placeholder="e.g. Q4 Outbound — Mumbai"
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
        {canPickAgent && agentId && (
          <p className="-mt-2 text-[11.5px] text-slate-400">
            The agent&rsquo;s script becomes the campaign&rsquo;s, to edit on the next page.
          </p>
        )}

        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
            Target audience <span className="text-slate-400">(optional)</span>
          </span>
          <input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            maxLength={500}
            placeholder="e.g. Companies with 20 to 200 employees"
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

        <div className="rounded-btn border border-slate-200">
          <button
            type="button"
            onClick={() => setShowSchedule((shown) => !shown)}
            aria-expanded={showSchedule}
            className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left"
          >
            <span>
              <span className="block text-[13px] font-semibold text-brand-navy">
                Schedule <span className="font-normal text-slate-400">(optional)</span>
              </span>
              <span className="block text-[11.5px] text-slate-500">
                Left empty, the campaign calls on the workspace&rsquo;s hours and days.
              </span>
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-slate-400 transition-transform",
                showSchedule && "rotate-180",
              )}
              strokeWidth={2.2}
            />
          </button>

          {showSchedule && (
            <div className="space-y-3 border-t border-slate-100 px-3.5 pb-3.5 pt-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
                    Timezone
                  </span>
                  <select
                    value={schedule.timezone}
                    onChange={(e) => editSchedule("timezone", e.target.value)}
                    className={FIELD}
                  >
                    <option value="">Workspace timezone</option>
                    {zones.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
                    Calls from
                  </span>
                  <input
                    type="time"
                    value={schedule.windowStart}
                    onChange={(e) => editSchedule("windowStart", e.target.value)}
                    className={`tabular ${FIELD}`}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Until</span>
                  <input
                    type="time"
                    value={schedule.windowEnd}
                    onChange={(e) => editSchedule("windowEnd", e.target.value)}
                    className={`tabular ${FIELD}`}
                  />
                </label>
              </div>

              <fieldset>
                <legend className="mb-1.5 text-[12px] font-medium text-slate-500">Days</legend>
                <div className="flex flex-wrap gap-1.5">
                  {WEEK_DAYS.map((day) => {
                    const active = schedule.callDays.includes(day.value);
                    return (
                      <label
                        key={day.value}
                        className={cn(
                          "flex cursor-pointer items-center rounded-btn border px-2.5 py-1.5 text-[12px] font-semibold transition-colors focus-within:ring-2 focus-within:ring-brand-green/25",
                          active
                            ? "border-brand-green bg-brand-green/[0.08] text-deep-green"
                            : "border-slate-200 text-slate-500 hover:bg-slate-50",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={() =>
                            editSchedule(
                              "callDays",
                              active
                                ? schedule.callDays.filter((value) => value !== day.value)
                                : [...schedule.callDays, day.value].sort((a, b) => a - b),
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

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
                    Start date
                  </span>
                  <input
                    type="date"
                    value={schedule.startDate}
                    onChange={(e) => editSchedule("startDate", e.target.value)}
                    className={`tabular ${FIELD}`}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
                    End date
                  </span>
                  <input
                    type="date"
                    value={schedule.endDate}
                    min={schedule.startDate || undefined}
                    onChange={(e) => editSchedule("endDate", e.target.value)}
                    className={`tabular ${FIELD}`}
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
