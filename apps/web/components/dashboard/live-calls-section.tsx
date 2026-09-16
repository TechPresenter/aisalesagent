"use client";

import { useCallback, useEffect, useState } from "react";
import { LiveCallsCard } from "@/components/dashboard/live-calls-card";
import { LiveCallPanel } from "@/components/dashboard/live-call-panel";
import { ApiError, callsApi } from "@/lib/api-client";
import { loadLiveCalls } from "@/lib/dashboard-data";
import type { ActionNotice } from "@/lib/lead-actions";
import type { LiveCall } from "@/lib/types";

/** How often the list is re-read. Durations tick locally in between. */
const POLL_MS = 10_000;

/**
 * Owns the live-call list and which row the operator is watching.
 *
 * Polls `GET /calls` for calls that have not finished; Phase 6 replaces the poll with the
 * tenant WebSocket channel, and the two child components stay as they are because they
 * take their data as props.
 *
 * Only CONNECTED and RINGING calls accrue time between polls — a DIALING row has not
 * connected yet, so its clock stays put (Working Flow §Flow 7).
 */
export function LiveCallsSection() {
  const [calls, setCalls] = useState<LiveCall[]>([]);
  const [live, setLive] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [notice, setNotice] = useState<ActionNotice | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await loadLiveCalls();
      setCalls(next.calls);
      setLive(next.source === "api");
    } catch {
      // Keep the last list on screen; the next poll tries again.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(poll);
  }, [refresh]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      setCalls((prev) =>
        prev.map((call) =>
          call.status === "CONNECTED" || call.status === "RINGING"
            ? { ...call, duration: call.duration + 1 }
            : call,
        ),
      );
    }, 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // A call can drop off the list between polls, so fall back rather than render nothing.
  const selected = calls.find((call) => call.id === selectedId) ?? calls[0];

  const endCall = async (call: LiveCall) => {
    setEnding(true);
    try {
      await callsApi.hangUp(call.id);
      setNotice({ tone: "ok", text: `Call to ${call.clinicName} ended.` });
      await refresh();
    } catch (cause) {
      setNotice({
        tone: "bad",
        text: cause instanceof ApiError ? cause.message : "Could not end the call.",
      });
    } finally {
      setEnding(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
      <LiveCallsCard
        calls={calls}
        selectedId={selected?.id ?? ""}
        onSelect={(call) => setSelectedId(call.id)}
      />
      <LiveCallPanel
        call={selected}
        onEnd={live ? endCall : undefined}
        ending={ending}
        notice={notice}
      />
    </div>
  );
}
