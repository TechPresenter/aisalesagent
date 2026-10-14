import type { AiAgent } from "@prisma/client";
import { readObjections, readQuestions } from "../agents/agent-script";

/** The longest call script a campaign accepts (CreateCampaignDto.callScript). */
export const MAX_CALL_SCRIPT_LENGTH = 20_000;

/** The parts of an agent its script is written from. */
export type AgentScriptSource = Pick<
  AiAgent,
  "openingMessage" | "qualificationQuestions" | "objectionHandling" | "closingInstructions"
>;

/**
 * An agent's script as the plain text a campaign stores in `callScript`: the opening
 * line, the qualification questions, the objection answers and the closing, in the order
 * a call uses them. `null` when the agent has none of them, so the caller keeps whatever
 * it had rather than storing an empty script.
 *
 * Activation refuses an AI campaign without a script, and the create dialog never asked
 * for one, so every campaign a person made was blocked until someone found an API that
 * would take a script. Copying the agent's in when a campaign names an agent and has no
 * script of its own is what a person would have typed anyway, and they can edit it.
 *
 * The web app builds the same text to prefill the campaign page's script box
 * (apps/web/lib/campaign-setup.ts). Change both, or the box and the saved script disagree.
 */
export function scriptFromAgent(agent: AgentScriptSource): string | null {
  const sections: string[] = [];

  const opening = agent.openingMessage?.trim();
  if (opening) sections.push(`Opening\n${opening}`);

  const questions = readQuestions(agent.qualificationQuestions);
  if (questions.length > 0) {
    const lines = questions.map(
      (entry, index) => `${index + 1}. ${entry.question}${entry.required ? " (must ask)" : ""}`,
    );
    sections.push(`Questions to ask\n${lines.join("\n")}`);
  }

  const objections = readObjections(agent.objectionHandling);
  if (objections.length > 0) {
    const lines = objections.map((entry) => `- "${entry.objection}": ${entry.response}`);
    sections.push(`If they object\n${lines.join("\n")}`);
  }

  const closing = agent.closingInstructions?.trim();
  if (closing) sections.push(`Closing\n${closing}`);

  if (sections.length === 0) return null;
  return fitScript(sections.join("\n\n"));
}

/**
 * An agent may hold more than a campaign script may (dozens of long objection answers),
 * so a script past the limit loses whole lines from the end rather than stopping
 * mid-sentence.
 */
function fitScript(script: string): string {
  if (script.length <= MAX_CALL_SCRIPT_LENGTH) return script;
  const cut = script.slice(0, MAX_CALL_SCRIPT_LENGTH);
  const lastBreak = cut.lastIndexOf("\n");
  return (lastBreak > 0 ? cut.slice(0, lastBreak) : cut).trimEnd();
}
