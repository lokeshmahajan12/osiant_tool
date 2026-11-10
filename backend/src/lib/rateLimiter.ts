/**
 * Simple in-memory token-bucket rate limiter used to keep provider requests
 * inside per-provider quotas (per process). Also exposes quota usage for the
 * dashboard's provider health view.
 */
interface Bucket {
  tokens: number;
  lastRefill: number;
  hits: number;
  rejects: number;
}

class TokenBucket {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number
  ) {}

  private get(name: string): Bucket {
    let b = this.buckets.get(name);
    if (!b) {
      b = { tokens: this.capacity, lastRefill: Date.now(), hits: 0, rejects: 0 };
      this.buckets.set(name, b);
    }
    return b;
  }

  private refill(b: Bucket): void {
    const now = Date.now();
    const elapsed = now - b.lastRefill;
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerMs);
    b.lastRefill = now;
  }

  /** Try to consume one token. Returns true if allowed. */
  acquire(name: string): boolean {
    const b = this.get(name);
    this.refill(b);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      b.hits += 1;
      return true;
    }
    b.rejects += 1;
    return false;
  }

  async wait(name: string, maxWaitMs = 15_000): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < maxWaitMs) {
      if (this.acquire(name)) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }

  usage(name: string): { used: number; rejected: number } {
    const b = this.buckets.get(name);
    return { used: b?.hits ?? 0, rejected: b?.rejects ?? 0 };
  }
}

/** A shared bucket that allows `max` requests per `windowMs`. */
export class FixedWindowLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number
  ) {}

  hit(name: string): boolean {
    const now = Date.now();
    let b = this.buckets.get(name);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(name, b);
    }
    b.count += 1;
    return b.count <= this.max;
  }

  remaining(name: string): number {
    const b = this.buckets.get(name);
    if (!b || b.resetAt <= Date.now()) return this.max;
    return Math.max(0, this.max - b.count);
  }
}

/** Per-provider limiter. Providers acquire a token before each HTTP call. */
export const providerLimiter = new TokenBucket(10, 10 / 60_000); // 10 req/min per provider, refilled continuously

export { TokenBucket };
