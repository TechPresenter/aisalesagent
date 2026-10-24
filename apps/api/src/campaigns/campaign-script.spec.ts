import { MAX_CALL_SCRIPT_LENGTH, scriptFromAgent, type AgentScriptSource } from "./campaign-script";

const EMPTY: AgentScriptSource = {
  openingMessage: null,
  qualificationQuestions: null,
  objectionHandling: null,
  closingInstructions: null,
};

describe("scriptFromAgent", () => {
  it("writes the opening, questions, objections and closing in the order a call uses them", () => {
    const script = scriptFromAgent({
      openingMessage: "  Hello, this is Asha from Acme. Do you have two minutes?  ",
      qualificationQuestions: [
        { id: "q1", question: "What are you using today?", required: true },
        { id: "q2", question: "Who else decides?", required: false },
      ],
      objectionHandling: [
        { id: "o1", objection: "Too expensive", response: "Plans start small and scale with use." },
      ],
      closingInstructions: "Offer a demo slot this week.",
    });

    // The same fixture and expectation as apps/web/lib/campaign-setup.spec.ts, which
    // prefills the campaign page with this text.
    expect(script).toBe(
      [
        "Opening",
        "Hello, this is Asha from Acme. Do you have two minutes?",
        "",
        "Questions to ask",
        "1. What are you using today? (must ask)",
        "2. Who else decides?",
        "",
        "If they object",
        '- "Too expensive": Plans start small and scale with use.',
        "",
        "Closing",
        "Offer a demo slot this week.",
      ].join("\n"),
    );
  });

  it("leaves out the parts the agent does not have", () => {
    expect(scriptFromAgent({ ...EMPTY, closingInstructions: "Book the demo." })).toBe(
      "Closing\nBook the demo.",
    );
  });

  it("reads questions stored in the old bare-string shape", () => {
    expect(
      scriptFromAgent({ ...EMPTY, qualificationQuestions: ["Budget?", "", "Timeline?"] }),
    ).toBe("Questions to ask\n1. Budget?\n2. Timeline?");
  });

  it("is null for an agent with no script at all, so nothing empty is stored", () => {
    expect(scriptFromAgent(EMPTY)).toBeNull();
    expect(
      scriptFromAgent({ ...EMPTY, openingMessage: "   ", qualificationQuestions: [] }),
    ).toBeNull();
  });

  it("fits the campaign's limit by dropping whole lines from the end", () => {
    const objections = Array.from({ length: 50 }, (_, index) => ({
      id: `o${index}`,
      objection: `Objection ${index}`,
      response: "x".repeat(1_000),
    }));
    const script = scriptFromAgent({ ...EMPTY, objectionHandling: objections });

    expect(script).not.toBeNull();
    expect(script!.length).toBeLessThanOrEqual(MAX_CALL_SCRIPT_LENGTH);
    expect(
      script!.split("\n").every((line) => line === "If they object" || line.endsWith("x")),
    ).toBe(true);
  });
});
