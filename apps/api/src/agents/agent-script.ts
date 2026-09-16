import type { Prisma } from "@prisma/client";

/**
 * One question the agent is told to get an answer to. Stored as JSON on the agent rather
 * than as its own table: they are ordered, edited as a block, and never queried
 * individually.
 */
export interface QualificationQuestion {
  id: string;
  question: string;
  /** What the answer is for — "budget", "timeline", "authority". Free text on purpose. */
  captures?: string;
  required: boolean;
}

/** A thing prospects say, and what the agent should say back. */
export interface ObjectionResponse {
  id: string;
  objection: string;
  response: string;
}

/**
 * Reads a script list out of a JSON column, whatever shape it is in.
 *
 * These columns are `Json?`, so the database will hold anything: an early seed wrote
 * questions as bare strings, a hand-edited row could hold nulls, and a future version may
 * add fields. The alternative to normalising here is what actually happened — the editor
 * received `["What are you using today?"]`, looked for `.question` on a string, found
 * `undefined`, and rendered three empty rows that looked like an empty script rather than
 * a parsing failure. Saving that screen would then have wiped a real script.
 *
 * So: anything unreadable is dropped, anything half-readable is filled in, and the caller
 * always gets the current shape.
 */
export function readQuestions(value: Prisma.JsonValue | null): QualificationQuestion[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry, index): QualificationQuestion[] => {
    if (typeof entry === "string") {
      const question = entry.trim();
      return question ? [{ id: `q${index + 1}`, question, required: false }] : [];
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];

    const row = entry as Record<string, unknown>;
    const question = typeof row.question === "string" ? row.question.trim() : "";
    if (!question) return [];

    return [
      {
        id: typeof row.id === "string" && row.id ? row.id : `q${index + 1}`,
        question,
        captures: typeof row.captures === "string" ? row.captures : undefined,
        required: row.required === true,
      },
    ];
  });
}

export function readObjections(value: Prisma.JsonValue | null): ObjectionResponse[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry, index): ObjectionResponse[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];

    const row = entry as Record<string, unknown>;
    // Tolerates the shape an early seed used, where the two halves were `objection` and
    // `reply` rather than `objection` and `response`.
    const objection = typeof row.objection === "string" ? row.objection.trim() : "";
    const response =
      typeof row.response === "string"
        ? row.response.trim()
        : typeof row.reply === "string"
          ? row.reply.trim()
          : "";
    if (!objection || !response) return [];

    return [
      {
        id: typeof row.id === "string" && row.id ? row.id : `o${index + 1}`,
        objection,
        response,
      },
    ];
  });
}
