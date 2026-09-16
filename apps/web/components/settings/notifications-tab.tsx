"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  notificationsApi,
  type NotificationChannel,
  type NotificationFrequency,
  type NotificationPreference,
} from "@/lib/api-client";

/** The channels offered. SMS and push are in the enum but have no sender behind them. */
const CHANNELS: { value: NotificationChannel; label: string }[] = [
  { value: "IN_APP", label: "In-app" },
  { value: "EMAIL", label: "Email" },
  { value: "WHATSAPP", label: "WhatsApp" },
];

const FREQUENCIES: { value: NotificationFrequency; label: string }[] = [
  { value: "INSTANT", label: "As it happens" },
  { value: "DAILY_DIGEST", label: "Daily digest" },
  { value: "WEEKLY_DIGEST", label: "Weekly digest" },
];

const TYPE_LABEL: Record<string, string> = {
  NEW_LEAD: "New lead added",
  INTERESTED_LEAD: "Lead marked interested",
  DEMO_BOOKED: "Demo booked",
  FOLLOWUP_DUE: "Follow-up due",
  FOLLOWUP_OVERDUE: "Follow-up overdue",
  CALL_COMPLETED: "Call completed",
  CALL_FAILED: "Call failed",
  CREDITS_LOW: "Credits running low",
  CREDITS_EXHAUSTED: "Credits exhausted",
  EXPORT_READY: "Export ready",
  SYSTEM_ALERT: "System alert",
};

/**
 * Feature List §14 — Settings → Notifications: which events reach you, and how.
 *
 * The choices are stored per person per event type, as the schema models them, and the
 * in-app channel is honoured: switching one off here stops it appearing under the bell.
 * Email and WhatsApp have no sender behind them, which the note below says outright —
 * a preference screen that implies delivery is a promise the app cannot keep.
 */
export function NotificationsTab({
  onSaved,
  onError,
}: {
  onSaved: (message: string) => void;
  onError: (cause: unknown) => void;
}) {
  const [preferences, setPreferences] = useState<NotificationPreference[] | null>(null);
  const [saved, setSaved] = useState<NotificationPreference[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    notificationsApi.preferences().then(
      (rows) => {
        setPreferences(rows);
        setSaved(rows);
      },
      () => setFailed(true),
    );
  }, []);

  const dirty = JSON.stringify(preferences) !== JSON.stringify(saved);

  function toggleChannel(type: string, channel: NotificationChannel) {
    setPreferences((rows) =>
      (rows ?? []).map((row) =>
        row.type === type
          ? {
              ...row,
              channels: row.channels.includes(channel)
                ? row.channels.filter((entry) => entry !== channel)
                : [...row.channels, channel],
            }
          : row,
      ),
    );
  }

  function setFrequency(type: string, frequency: NotificationFrequency) {
    setPreferences((rows) =>
      (rows ?? []).map((row) => (row.type === type ? { ...row, frequency } : row)),
    );
  }

  async function save() {
    if (!preferences || !dirty) return;
    setSaving(true);
    try {
      const stored = await notificationsApi.savePreferences(preferences);
      setPreferences(stored);
      setSaved(stored);
      onSaved("Notification preferences saved.");
    } catch (cause) {
      onError(cause);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <CardTitle>Notifications</CardTitle>
      <p className="mt-1 text-[13px] text-slate-500">
        Choose which events reach you, and how.
      </p>

      {failed ? (
        <p className="mt-4 text-[13px] text-slate-500">Could not load your preferences.</p>
      ) : !preferences ? (
        <p className="mt-4 text-[13px] text-slate-400">Loading…</p>
      ) : (
        <>
          <div className="scrollbar-thin mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left">
              <thead>
                <tr className="bg-slate-50/80">
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Event
                  </th>
                  {CHANNELS.map((channel) => (
                    <th
                      key={channel.value}
                      scope="col"
                      className="whitespace-nowrap px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                    >
                      {channel.label}
                    </th>
                  ))}
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                  >
                    How often
                  </th>
                </tr>
              </thead>
              <tbody>
                {preferences.map((row) => (
                  <tr key={row.type} className="border-t border-slate-100">
                    <td className="px-3 py-2.5 text-[12.5px] font-medium text-brand-navy">
                      {TYPE_LABEL[row.type] ?? row.type}
                    </td>
                    {CHANNELS.map((channel) => (
                      <td key={channel.value} className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={row.channels.includes(channel.value)}
                          onChange={() => toggleChannel(row.type, channel.value)}
                          aria-label={`${channel.label} for ${TYPE_LABEL[row.type] ?? row.type}`}
                          className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-[#19B969]"
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2.5">
                      <select
                        value={row.frequency}
                        onChange={(event) =>
                          setFrequency(row.type, event.target.value as NotificationFrequency)
                        }
                        aria-label={`Frequency for ${TYPE_LABEL[row.type] ?? row.type}`}
                        className="h-9 w-full rounded-btn border border-slate-200 bg-surface px-2 text-[12.5px] text-brand-navy focus:border-brand-green focus:outline-none"
                      >
                        {FREQUENCIES.map((frequency) => (
                          <option key={frequency.value} value={frequency.value}>
                            {frequency.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-[12.5px] leading-relaxed text-slate-500">
            In-app notifications are delivered now — they appear under the bell in the header.
            Email and WhatsApp have no sender configured yet, so those choices are saved for
            when one is, rather than quietly doing nothing under a switch that looks on.
          </p>

          <div className="mt-4 flex justify-end">
            <Button
              className="h-11 bg-accent-blue hover:bg-[#1B6CD8]"
              onClick={() => void save()}
              disabled={!dirty || saving}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
              Save Changes
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
