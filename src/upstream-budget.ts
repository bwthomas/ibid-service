/**
 * Per-upstream token-bucket rate limiter. SPEC §6.
 *
 * One bucket per external dependency the package can call: CrossRef, Citoid,
 * OpenLibrary. When `/extract` receives an input whose kind maps to an
 * upstream whose bucket is empty, the service responds 429 with `Retry-After`
 * instead of burning through the budget and getting rate-limited by the
 * upstream itself.
 *
 * Refill model: continuous (not windowed). `capacity` tokens max, refilled
 * at `refillPerSec` tokens/second. Per-instance state only — 2 service tasks
 * behind the load balancer means 2× the per-instance rate in aggregate. Good
 * enough; Redis coordination is out of scope for v0.1.
 */

export type Upstream = "crossref" | "citoid" | "openlibrary";

export interface TokenBucket {
  tryConsume(tokens?: number): { consumed: boolean; retryAfterSec: number };
  state(): { tokens: number; capacity: number };
}

export function createTokenBucket(
  capacity: number,
  refillPerSec: number,
  now: () => number = Date.now,
): TokenBucket {
  let tokens = capacity;
  let lastRefill = now();
  const refill = () => {
    const current = now();
    const elapsedSec = (current - lastRefill) / 1000;
    if (elapsedSec > 0) {
      tokens = Math.min(capacity, tokens + elapsedSec * refillPerSec);
      lastRefill = current;
    }
  };
  return {
    tryConsume(tokenCount = 1) {
      refill();
      if (tokens >= tokenCount) {
        tokens -= tokenCount;
        return { consumed: true, retryAfterSec: 0 };
      }
      const shortfall = tokenCount - tokens;
      return {
        consumed: false,
        retryAfterSec: Math.max(1, Math.ceil(shortfall / refillPerSec)),
      };
    },
    state: () => ({ tokens, capacity }),
  };
}

export interface UpstreamBudget {
  check(upstream: Upstream): { ok: true } | {
    ok: false;
    retryAfterSec: number;
    upstream: Upstream;
  };
  state(): Record<Upstream, { tokens: number; capacity: number }>;
}

export interface UpstreamCaps {
  crossref: { capacity: number; refillPerSec: number };
  citoid: { capacity: number; refillPerSec: number };
  openlibrary: { capacity: number; refillPerSec: number };
}

export function createUpstreamBudget(caps: UpstreamCaps): UpstreamBudget {
  const buckets: Record<Upstream, TokenBucket> = {
    crossref: createTokenBucket(caps.crossref.capacity, caps.crossref.refillPerSec),
    citoid: createTokenBucket(caps.citoid.capacity, caps.citoid.refillPerSec),
    openlibrary: createTokenBucket(
      caps.openlibrary.capacity,
      caps.openlibrary.refillPerSec,
    ),
  };
  return {
    check(upstream: Upstream) {
      const r = buckets[upstream].tryConsume();
      return r.consumed
        ? { ok: true }
        : { ok: false, retryAfterSec: r.retryAfterSec, upstream };
    },
    state: () => ({
      crossref: buckets.crossref.state(),
      citoid: buckets.citoid.state(),
      openlibrary: buckets.openlibrary.state(),
    }),
  };
}

/**
 * Heuristic: given an `ExtractInput.kind`, which upstream is likely needed.
 * Conservative — returns `null` for kinds that don't reliably map to a
 * single upstream (html, text, ris, easybib can all involve multiple or
 * none, so we don't gate them).
 */
export function upstreamForInputKind(kind: string): Upstream | null {
  switch (kind) {
    case "doi":
      return "crossref";
    case "url":
      return "citoid";
    case "isbn":
      return "openlibrary";
    default:
      return null;
  }
}
