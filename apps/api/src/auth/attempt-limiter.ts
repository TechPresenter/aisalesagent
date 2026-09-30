/**
 * A small fixed-window counter: at most `limit` hits per key per `windowMs`.
 *
 * In memory, so each API instance counts on its own and a restart forgets. That is the
 * right weight for what it guards — resend buttons and verification-code guesses, where
 * the goal is to stop a flood rather than to be exact. Sign-in lockout, which has to
 * survive restarts, is stored on the user row instead.
 */
export class AttemptLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Counts an attempt. False when this key has already used its allowance. */
  hit(key: string, now = Date.now()): boolean {
    this.sweep(now);
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (entry.count >= this.limit) return false;
    entry.count += 1;
    return true;
  }

  /** Seconds until this key may try again; 0 when it may try now. */
  retryAfterSeconds(key: string, now = Date.now()): number {
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now || entry.count < this.limit) return 0;
    return Math.ceil((entry.resetAt - now) / 1000);
  }

  clear(key: string): void {
    this.entries.delete(key);
  }

  /** Drops expired entries now and then, so the map does not grow with every address ever seen. */
  private sweep(now: number): void {
    if (this.entries.size < 1000) return;
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }
}
