import { readObjections, readQuestions } from "./agent-script";

/**
 * These columns are `Json?`, so nothing at the database level constrains what is in them.
 * The failure this guards against is not a crash — it is three blank rows in the editor
 * that look like an empty script, and a save that then wipes a real one.
 */
describe("readQuestions", () => {
  it("reads the current shape", () => {
    expect(
      readQuestions([
        { id: "q1", question: "How many seats?", captures: "seats", required: true },
      ]),
    ).toEqual([{ id: "q1", question: "How many seats?", captures: "seats", required: true }]);
  });

  it("reads bare strings, which an early seed wrote", () => {
    expect(readQuestions(["What are you using today?", "How many people?"])).toEqual([
      { id: "q1", question: "What are you using today?", required: false },
      { id: "q2", question: "How many people?", required: false },
    ]);
  });

  it("invents an id for a row that has none, so React keys stay stable per position", () => {
    expect(readQuestions([{ question: "No id here", required: true }])).toEqual([
      { id: "q1", question: "No id here", captures: undefined, required: true },
    ]);
  });

  it("drops rows with no question text rather than rendering an empty field", () => {
    expect(readQuestions([{ id: "a", question: "   ", required: true }, "", null])).toEqual([]);
  });

  it("treats a missing required flag as not required, never as truthy", () => {
    expect(readQuestions([{ question: "Q", required: "yes" }])[0].required).toBe(false);
    expect(readQuestions([{ question: "Q" }])[0].required).toBe(false);
    expect(readQuestions([{ question: "Q", required: true }])[0].required).toBe(true);
  });

  it("ignores a captures value that is not text", () => {
    expect(readQuestions([{ question: "Q", captures: 42, required: false }])[0].captures)
      .toBeUndefined();
  });

  it("returns an empty list for null, an object, or a string", () => {
    expect(readQuestions(null)).toEqual([]);
    expect(readQuestions({ question: "not a list" })).toEqual([]);
    expect(readQuestions("nope")).toEqual([]);
  });

  it("keeps the order it was given — the agent asks them in this sequence", () => {
    const questions = readQuestions(["first", "second", "third"]);
    expect(questions.map((q) => q.question)).toEqual(["first", "second", "third"]);
  });

  it("numbers ids by original position, not by surviving position", () => {
    // The blank row is dropped, but the row after it keeps the id its position implies —
    // renumbering would silently reassign ids on every read.
    const questions = readQuestions(["", "second"]);
    expect(questions).toEqual([{ id: "q2", question: "second", required: false }]);
  });
});

describe("readObjections", () => {
  it("reads the current shape", () => {
    expect(
      readObjections([{ id: "o1", objection: "Too expensive", response: "Ask what against." }]),
    ).toEqual([{ id: "o1", objection: "Too expensive", response: "Ask what against." }]);
  });

  it("accepts `reply` as a synonym for `response`", () => {
    expect(readObjections([{ objection: "Busy", reply: "Offer to call back." }])).toEqual([
      { id: "o1", objection: "Busy", response: "Offer to call back." },
    ]);
  });

  it("drops a half-filled pair — an objection with no answer is worse than none", () => {
    expect(
      readObjections([
        { objection: "Too expensive", response: "" },
        { objection: "", response: "Something" },
      ]),
    ).toEqual([]);
  });

  it("ignores strings, which are never a valid objection row", () => {
    expect(readObjections(["Too expensive"])).toEqual([]);
  });

  it("returns an empty list for null", () => {
    expect(readObjections(null)).toEqual([]);
  });
});
