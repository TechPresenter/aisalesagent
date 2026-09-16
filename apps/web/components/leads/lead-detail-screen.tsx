"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { LeadDetailView, type LeadDetailActions } from "@/components/leads/lead-detail-view";
import { EditLeadDialog } from "@/components/leads/edit-lead-dialog";
import { AddFollowUpDialog } from "@/components/followups/add-follow-up-dialog";
import { AddNoteDialog } from "@/components/notes/add-note-dialog";
import { ApiError, leadsApi, transcriptsApi } from "@/lib/api-client";
import { placeCall } from "@/lib/lead-actions";
import { fetchLeadDetail, type LeadDetailResult } from "@/lib/leads-repository";
import { cn } from "@/lib/utils";

type Dialog = "edit" | "note" | "follow-up" | "delete" | null;

type LoadState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; result: LeadDetailResult };

/**
 * Feature List §2 — the lead detail page, reading the lead the URL names from the API.
 *
 * It used to look the id up in the seed set, so every lead the Leads table listed from
 * the database opened a 404. It now loads the real record with its history, and every
 * action on the page writes back through the endpoints the rest of the app uses.
 */
export function LeadDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [calling, setCalling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const load = useCallback(async () => {
    try {
      const result = await fetchLeadDetail(id);
      setState(result ? { status: "ready", result } : { status: "missing" });
    } catch (cause) {
      setState({
        status: "error",
        message: cause instanceof ApiError ? cause.message : "Could not load this lead.",
      });
    }
  }, [id]);

  useEffect(() => {
    setState({ status: "loading" });
    void load();
  }, [load]);

  // Stable identities: the dialogs reset their fields whenever `lead` or `onClose`
  // changes, so a fresh object on every render would wipe what the user is typing.
  const close = useCallback(() => setDialog(null), []);
  const leadId = state.status === "ready" ? state.result.lead.id : undefined;
  const leadName = state.status === "ready" ? state.result.lead.name : undefined;
  const leadRef = useMemo(
    () => (leadId && leadName ? { id: leadId, name: leadName } : undefined),
    [leadId, leadName],
  );

  const done = useCallback(
    (text: string) => {
      setNotice({ tone: "ok", text });
      void load();
    },
    [load],
  );

  const fail = (cause: unknown, fallback: string) =>
    setNotice({ tone: "bad", text: cause instanceof ApiError ? cause.message : fallback });

  if (state.status === "loading") {
    return (
      <Frame>
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" strokeWidth={2.2} />
        <p className="text-[13.5px] text-slate-500">Loading lead&hellip;</p>
      </Frame>
    );
  }

  if (state.status === "missing") {
    return (
      <Frame>
        <h1 className="text-[18px] font-bold text-brand-navy">Lead not found</h1>
        <p className="max-w-sm text-[13.5px] text-slate-500">
          It may have been deleted, or it belongs to a different workspace.
        </p>
      </Frame>
    );
  }

  if (state.status === "error") {
    return (
      <Frame>
        <p className="text-[13.5px] text-[#C93B3B]">{state.message}</p>
        <button
          type="button"
          onClick={() => {
            setState({ status: "loading" });
            void load();
          }}
          className="h-10 rounded-btn border border-slate-200 px-4 text-[13.5px] font-semibold text-brand-navy transition-colors hover:bg-slate-50"
        >
          Try again
        </button>
      </Frame>
    );
  }

  const { lead, record, previousId, nextId, source } = state.result;

  // Seed data has nothing to write to, so its controls render disabled rather than pretend.
  const actions: LeadDetailActions | undefined = record
    ? {
        calling,
        onCallNow: async () => {
          setCalling(true);
          const result = await placeCall(lead);
          setCalling(false);
          if (result.tone === "ok") done(result.text);
          else setNotice(result);
        },
        onScheduleFollowUp: () => setDialog("follow-up"),
        onAddNote: () => setDialog("note"),
        onEdit: () => setDialog("edit"),
        onDelete: () => setDialog("delete"),
        onTagsChange: async (tags) => {
          try {
            await leadsApi.update(lead.id, {
              customFields: { ...(record.customFields ?? {}), tags },
            });
            void load();
          } catch (cause) {
            fail(cause, "Could not save the tags.");
            throw cause;
          }
        },
        loadTranscript: (transcriptId) => transcriptsApi.segments(transcriptId),
      }
    : undefined;

  const remove = async () => {
    setDeleting(true);
    try {
      await leadsApi.remove(lead.id);
      router.push("/leads");
    } catch (cause) {
      setDeleting(false);
      setDialog(null);
      fail(cause, "Could not delete the lead.");
    }
  };

  return (
    <>
      {notice && (
        <div
          role="status"
          className={cn(
            "mb-4 rounded-btn px-4 py-2.5 text-[13px] font-medium",
            notice.tone === "ok"
              ? "bg-brand-green/[0.1] text-deep-green"
              : "bg-alert-red/[0.09] text-[#C93B3B]",
          )}
        >
          {notice.text}
        </div>
      )}

      {source === "seed" && (
        <p className="mb-4 rounded-btn bg-warning-amber/[0.1] px-4 py-2.5 text-[13px] font-medium text-[#B4761A]">
          Showing sample data — the API is not reachable, so this lead cannot be changed.
        </p>
      )}

      <LeadDetailView lead={lead} previousId={previousId} nextId={nextId} actions={actions} />

      {record && (
        <>
          <EditLeadDialog open={dialog === "edit"} onClose={close} onSaved={done} lead={record} />
          <AddNoteDialog open={dialog === "note"} onClose={close} onCreated={done} lead={leadRef} />
          <AddFollowUpDialog
            open={dialog === "follow-up"}
            onClose={close}
            onCreated={done}
            lead={leadRef}
          />
          <Modal
            open={dialog === "delete"}
            onClose={close}
            size="sm"
            title="Delete this lead?"
            description={`${lead.name} will be removed from your workspace.`}
            footer={
              <>
                <button
                  type="button"
                  onClick={close}
                  className="h-10 rounded-btn border border-slate-200 px-4 text-[13.5px] font-semibold text-brand-navy transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={deleting}
                  className="inline-flex h-10 items-center gap-2 rounded-btn bg-alert-red px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#C93B3B] disabled:opacity-60"
                >
                  {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />}
                  Delete lead
                </button>
              </>
            }
          >
            <p className="text-[13px] leading-relaxed text-slate-600">This cannot be undone.</p>
          </Modal>
        </>
      )}
    </>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Link
        href="/leads"
        className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-accent-blue hover:underline"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={2.4} />
        Back to Leads
      </Link>
      <Card className="mt-4 flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        {children}
      </Card>
    </>
  );
}
