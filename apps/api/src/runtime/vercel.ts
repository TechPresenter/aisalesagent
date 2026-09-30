import { waitUntil } from "@vercel/functions";

/**
 * True when the API is running as a Vercel Function rather than a long-lived server.
 *
 * Vercel sets VERCEL=1 in every build and function it runs. Two things are different there:
 * no timer outlives the request that started it, and a function may be suspended as soon
 * as its response has been sent.
 */
export function runningOnVercel(): boolean {
  return Boolean(process.env.VERCEL);
}

/**
 * Lets work finish after the response that started it has gone.
 *
 * Several services answer the caller first and finish their work afterwards — webhooks,
 * chat and CRM delivery, calendar sync, email — so a slow third party never holds up a
 * request. A long-running server simply carries on with that work. On Vercel the function
 * could be suspended with it half done; registering it with `waitUntil` keeps the
 * invocation alive until it settles. Outside Vercel `waitUntil` does nothing, so local
 * development behaves exactly as before.
 *
 * Returns the promise it was given, so a caller that does await it sees no difference.
 */
export function keepAlive<T>(work: Promise<T>): Promise<T> {
  // Only the settling matters to waitUntil. Success and failure stay with whoever holds
  // `work`; this copy absorbs a rejection so the registration itself never surfaces as an
  // unhandled one.
  waitUntil(
    work.then(
      () => undefined,
      () => undefined,
    ),
  );
  return work;
}
