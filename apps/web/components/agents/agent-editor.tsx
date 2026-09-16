"use client";

import { useEffect, useState } from "react";
import { GripVertical, Loader2, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import {
  agentsApi,
  ApiError,
  AGENT_LANGUAGES,
  type ApiAgent,
  type ObjectionResponse,
  type QualificationQuestion,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Tab = "voice" | "script" | "questions" | "objections" | "knowledge";

const TABS: { id: Tab; label: string }[] = [
  { id: "voice", label: "Voice" },
  { id: "script", label: "Script" },
  { id: "questions", label: "Questions" },
  { id: "objections", label: "Objections" },
  { id: "knowledge", label: "Knowledge" },
];

/**
 * Creates or edits an agent.
 *
 * Everything is held locally and sent in one PATCH on save, rather than saved per field.
 * A script is written as a whole — the opening line, the questions and the objections only
 * make sense together — and half-saving one would leave an agent live with a rewritten
 * opening and its old close.
 */
export function AgentEditor({
  open,
  agent,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Null creates a new agent. */
  agent: ApiAgent | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("voice");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("hi-IN");
  const [gender, setGender] = useState("female");
  const [accent, setAccent] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [personality, setPersonality] = useState("");
  const [openingMessage, setOpeningMessage] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [closingInstructions, setClosingInstructions] = useState("");
  const [knowledgeBase, setKnowledgeBase] = useState("");
  const [questions, setQuestions] = useState<QualificationQuestion[]>([]);
  const [objections, setObjections] = useState<ObjectionResponse[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab("voice");
    setError(null);
    setName(agent?.name ?? "");
    setLanguage(agent?.language ?? "hi-IN");
    setGender(agent?.gender ?? "female");
    setAccent(agent?.accent ?? "");
    setVoiceId(agent?.voiceId ?? "");
    setPersonality(agent?.personality ?? "");
    setOpeningMessage(agent?.openingMessage ?? "");
    setSystemPrompt(agent?.systemPrompt ?? "");
    setClosingInstructions(agent?.closingInstructions ?? "");
    setKnowledgeBase(agent?.knowledgeBase ?? "");
    setQuestions(agent?.qualificationQuestions ?? []);
    setObjections(agent?.objectionHandling ?? []);
  }, [open, agent]);

  async function save() {
    if (!name.trim()) {
      setTab("voice");
      setError("An agent needs a name.");
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      name: name.trim(),
      language,
      gender,
      accent: accent.trim() || undefined,
      voiceId: voiceId.trim() || undefined,
      personality: personality.trim() || undefined,
      openingMessage: openingMessage.trim() || undefined,
      systemPrompt: systemPrompt.trim() || undefined,
      closingInstructions: closingInstructions.trim() || undefined,
      knowledgeBase: knowledgeBase.trim() || undefined,
      // Blank rows are dropped rather than saved: an empty question would be read aloud
      // as a pause the prospect has to fill.
      qualificationQuestions: questions.filter((q) => q.question.trim().length > 0),
      objectionHandling: objections.filter(
        (o) => o.objection.trim().length > 0 && o.response.trim().length > 0,
      ),
    };

    try {
      if (agent) {
        await agentsApi.update(agent.id, payload);
        onSaved(`${payload.name} saved.`);
      } else {
        await agentsApi.create(payload);
        onSaved(`${payload.name} created. Turn it on when the script reads right.`);
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save the agent.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={agent ? `Edit ${agent.name}` : "New agent"}
      description="What this voice says on a call, and how it handles what it hears back."
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
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex h-10 items-center gap-2 rounded-btn bg-accent-blue px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#1B6CD8] disabled:bg-slate-200 disabled:text-slate-400"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />}
            {agent ? "Save agent" : "Create agent"}
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

      <div className="mb-4 flex gap-1 border-b border-slate-100">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors",
              tab === id
                ? "border-accent-blue text-accent-blue"
                : "border-transparent text-slate-500 hover:text-brand-navy",
            )}
          >
            {label}
            {id === "questions" && questions.length > 0 && (
              <span className="ml-1.5 text-[11px] text-slate-400">{questions.length}</span>
            )}
            {id === "objections" && objections.length > 0 && (
              <span className="ml-1.5 text-[11px] text-slate-400">{objections.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "voice" && (
        <div className="space-y-4">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Anjali"
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Language">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className={selectClass}
              >
                {AGENT_LANGUAGES.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Voice">
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className={selectClass}
              >
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="neutral">Neutral</option>
              </select>
            </Field>
            <Field label="Accent" hint="optional">
              <input
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                maxLength={60}
                placeholder="Mumbai"
                className={inputClass}
              />
            </Field>
          </div>

          <Field
            label="Provider voice ID"
            hint="optional"
            note="The voice to use at your text-to-speech provider. Leave it blank to use the workspace default configured in Settings."
          >
            <input
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              maxLength={120}
              placeholder="e.g. an ElevenLabs voice id"
              className={cn(inputClass, "tabular")}
            />
          </Field>

          <Field label="Personality" hint="optional">
            <input
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              maxLength={300}
              placeholder="Warm, unhurried, never pushy."
              className={inputClass}
            />
          </Field>
        </div>
      )}

      {tab === "script" && (
        <div className="space-y-4">
          <Field
            label="Opening message"
            note="The first thing said when the call connects. Keep it short — people decide in the first sentence."
          >
            <textarea
              value={openingMessage}
              onChange={(e) => setOpeningMessage(e.target.value)}
              rows={3}
              maxLength={2_000}
              placeholder="Hello, this is Anjali calling from Northwind Solutions. Do you have a moment?"
              className={textareaClass}
            />
          </Field>

          <Field
            label="System prompt"
            note="The standing instructions the model works under for the whole call."
          >
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={7}
              maxLength={8_000}
              placeholder="You are a sales representative for... Never claim to be human if asked directly."
              className={textareaClass}
            />
          </Field>

          <Field
            label="Closing instructions"
            note="How to end — what to confirm, and what to do if they want a call back."
          >
            <textarea
              value={closingInstructions}
              onChange={(e) => setClosingInstructions(e.target.value)}
              rows={3}
              maxLength={2_000}
              placeholder="Confirm the demo slot back to them, then thank them and end the call."
              className={textareaClass}
            />
          </Field>
        </div>
      )}

      {tab === "questions" && (
        <div className="space-y-3">
          <p className="text-[12.5px] leading-relaxed text-slate-500">
            What the agent should find out. Asked in this order; required ones are asked
            again if the answer was not clear.
          </p>

          {questions.length === 0 && (
            <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-[12.5px] text-slate-500">
              No questions yet. Without them the agent will talk, but not qualify.
            </p>
          )}

          {questions.map((question, index) => (
            <div key={question.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-start gap-2">
                <GripVertical
                  className="mt-2 h-4 w-4 shrink-0 text-slate-300"
                  strokeWidth={2}
                  aria-hidden
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <input
                    value={question.question}
                    onChange={(e) =>
                      setQuestions(patchAt(questions, index, { question: e.target.value }))
                    }
                    maxLength={500}
                    placeholder="How many people are on the team using this today?"
                    aria-label={`Question ${index + 1}`}
                    className={inputClass}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      value={question.captures ?? ""}
                      onChange={(e) =>
                        setQuestions(patchAt(questions, index, { captures: e.target.value }))
                      }
                      maxLength={120}
                      placeholder="Captures: team size"
                      aria-label={`What question ${index + 1} captures`}
                      className={cn(inputClass, "h-8 flex-1 text-[12px]")}
                    />
                    <label className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-slate-600">
                      <input
                        type="checkbox"
                        checked={question.required}
                        onChange={(e) =>
                          setQuestions(patchAt(questions, index, { required: e.target.checked }))
                        }
                        className="h-3.5 w-3.5 rounded border-slate-300 text-accent-blue focus:ring-accent-blue"
                      />
                      Required
                    </label>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setQuestions(questions.filter((_, i) => i !== index))}
                  aria-label={`Remove question ${index + 1}`}
                  className="mt-1 shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-alert-red/[0.08] hover:text-alert-red"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                </button>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() =>
              setQuestions([
                ...questions,
                { id: newId(), question: "", captures: "", required: false },
              ])
            }
            disabled={questions.length >= 30}
            className="inline-flex h-9 items-center gap-1.5 rounded-btn border border-slate-200 px-3 text-[13px] font-semibold text-accent-blue transition-colors hover:bg-slate-50 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
            Add question
          </button>
        </div>
      )}

      {tab === "objections" && (
        <div className="space-y-3">
          <p className="text-[12.5px] leading-relaxed text-slate-500">
            Things people say, and what to say back. The agent matches on meaning, not on
            the exact words.
          </p>

          {objections.length === 0 && (
            <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-[12.5px] text-slate-500">
              Nothing here yet. The agent will improvise, which is rarely what you want.
            </p>
          )}

          {objections.map((objection, index) => (
            <div key={objection.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
              <div className="flex items-start gap-2">
                <input
                  value={objection.objection}
                  onChange={(e) =>
                    setObjections(patchAt(objections, index, { objection: e.target.value }))
                  }
                  maxLength={500}
                  placeholder="It's too expensive"
                  aria-label={`Objection ${index + 1}`}
                  className={cn(inputClass, "font-semibold")}
                />
                <button
                  type="button"
                  onClick={() => setObjections(objections.filter((_, i) => i !== index))}
                  aria-label={`Remove objection ${index + 1}`}
                  className="mt-1 shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-alert-red/[0.08] hover:text-alert-red"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                </button>
              </div>
              <textarea
                value={objection.response}
                onChange={(e) =>
                  setObjections(patchAt(objections, index, { response: e.target.value }))
                }
                rows={2}
                maxLength={2_000}
                placeholder="Acknowledge it, then ask what they are comparing against."
                aria-label={`Response to objection ${index + 1}`}
                className={textareaClass}
              />
            </div>
          ))}

          <button
            type="button"
            onClick={() =>
              setObjections([...objections, { id: newId(), objection: "", response: "" }])
            }
            disabled={objections.length >= 50}
            className="inline-flex h-9 items-center gap-1.5 rounded-btn border border-slate-200 px-3 text-[13px] font-semibold text-accent-blue transition-colors hover:bg-slate-50 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
            Add objection
          </button>
        </div>
      )}

      {tab === "knowledge" && (
        <Field
          label="Knowledge base"
          note="Facts the agent may state: pricing, what is included, what is not. Anything not here, it should say it will find out rather than guess."
        >
          <textarea
            value={knowledgeBase}
            onChange={(e) => setKnowledgeBase(e.target.value)}
            rows={14}
            maxLength={20_000}
            placeholder={
              "Pricing: ₹4,999 per user per month, billed annually.\nOnboarding is included.\nWe do not offer a free tier."
            }
            className={cn(textareaClass, "font-mono text-[12px]")}
          />
        </Field>
      )}
    </Modal>
  );
}

const inputClass =
  "h-9 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[13px] text-brand-navy placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25";

const selectClass =
  "h-9 w-full rounded-btn border border-slate-200 bg-surface px-2.5 text-[13px] font-medium text-brand-navy focus:border-brand-green focus:outline-none";

const textareaClass =
  "scrollbar-thin w-full resize-y rounded-lg border border-slate-200 bg-surface p-3 text-[12.5px] leading-relaxed text-slate-700 placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25";

function Field({
  label,
  hint,
  note,
  children,
}: {
  label: string;
  hint?: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-slate-500">
        {label}
        {hint && <span className="ml-1 text-slate-400">({hint})</span>}
      </span>
      {children}
      {note && <span className="mt-1 block text-[11.5px] leading-snug text-slate-400">{note}</span>}
    </label>
  );
}

function patchAt<T>(list: T[], index: number, patch: Partial<T>): T[] {
  return list.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

/**
 * A local id for a script row.
 *
 * These only ever need to be unique within one agent's list — they are React keys and a
 * stable handle for edits, never a database key — so `crypto.randomUUID` where it exists
 * and a counter-plus-timestamp where it does not is enough.
 */
let counter = 0;
function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  counter += 1;
  return `row-${Date.now()}-${counter}`;
}
