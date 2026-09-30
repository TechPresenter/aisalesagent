import { keepAlive, runningOnVercel } from "./vercel";

/**
 * keepAlive is what stops Vercel suspending a function with an email or a webhook half
 * sent, so the part worth pinning down is that it really reaches Vercel's waitUntil — and
 * that it changes nothing for code that awaits the promise, or when not on Vercel.
 */

/** How @vercel/functions finds the running request: a getter on this global symbol. */
const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");
const globals = globalThis as unknown as Record<symbol, unknown>;

afterEach(() => {
  delete globals[REQUEST_CONTEXT];
  delete process.env.VERCEL;
});

describe("keepAlive", () => {
  it("registers the work with the Vercel request it runs in", async () => {
    const waitUntil = jest.fn();
    globals[REQUEST_CONTEXT] = { get: () => ({ waitUntil }) };

    const work = Promise.resolve("sent");
    await expect(keepAlive(work)).resolves.toBe("sent");

    expect(waitUntil).toHaveBeenCalledTimes(1);
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  });

  it("does nothing extra outside Vercel", async () => {
    await expect(keepAlive(Promise.resolve(42))).resolves.toBe(42);
  });

  it("returns the very promise it was given, failure included", async () => {
    const waitUntil = jest.fn();
    globals[REQUEST_CONTEXT] = { get: () => ({ waitUntil }) };

    const failing = Promise.reject(new Error("provider down"));
    const returned = keepAlive(failing);

    expect(returned).toBe(failing);
    await expect(returned).rejects.toThrow("provider down");
    // The copy handed to Vercel settles quietly, so it can never become an unhandled rejection.
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  });
});

describe("runningOnVercel", () => {
  it("follows the VERCEL variable Vercel sets in every function", () => {
    expect(runningOnVercel()).toBe(false);
    process.env.VERCEL = "1";
    expect(runningOnVercel()).toBe(true);
  });
});
