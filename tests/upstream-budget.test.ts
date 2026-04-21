import { describe, it, expect } from "vitest";

import {
  createTokenBucket,
  createUpstreamBudget,
  upstreamForInputKind,
} from "../src/upstream-budget.js";

describe("createTokenBucket", () => {
  it("starts full and consumes down to empty", () => {
    const b = createTokenBucket(3, 0);
    expect(b.tryConsume().consumed).toBe(true);
    expect(b.tryConsume().consumed).toBe(true);
    expect(b.tryConsume().consumed).toBe(true);
    expect(b.tryConsume().consumed).toBe(false);
  });

  it("reports retry-after when empty", () => {
    const b = createTokenBucket(1, 2); // refill 2/sec
    b.tryConsume(); // empty
    const r = b.tryConsume();
    expect(r.consumed).toBe(false);
    expect(r.retryAfterSec).toBe(1); // need 1 token @ 2/sec → 0.5s → ceil 1
  });

  it("refills by elapsed time", () => {
    let now = 0;
    const b = createTokenBucket(10, 10, () => now);
    // Drain.
    for (let i = 0; i < 10; i++) b.tryConsume();
    expect(b.tryConsume().consumed).toBe(false);
    // 2 seconds pass → should have 10 tokens back (capped).
    now += 2000;
    expect(b.tryConsume().consumed).toBe(true);
    expect(b.state().tokens).toBeGreaterThan(8); // ~9 after consume of 1
  });

  it("caps refill at capacity", () => {
    let now = 0;
    const b = createTokenBucket(5, 10, () => now);
    now += 10_000; // 10 seconds = 100 tokens worth of refill
    b.tryConsume(0); // trigger refill without consuming
    expect(b.state().tokens).toBe(5);
  });
});

describe("createUpstreamBudget", () => {
  it("gates per upstream independently", () => {
    const budget = createUpstreamBudget({
      crossref: { capacity: 1, refillPerSec: 0 },
      citoid: { capacity: 1, refillPerSec: 0 },
      openlibrary: { capacity: 1, refillPerSec: 0 },
    });
    // Drain crossref.
    expect(budget.check("crossref").ok).toBe(true);
    expect(budget.check("crossref").ok).toBe(false);
    // Citoid is untouched.
    expect(budget.check("citoid").ok).toBe(true);
    expect(budget.check("openlibrary").ok).toBe(true);
  });

  it("exposes per-bucket state for metrics", () => {
    const budget = createUpstreamBudget({
      crossref: { capacity: 10, refillPerSec: 10 },
      citoid: { capacity: 20, refillPerSec: 20 },
      openlibrary: { capacity: 5, refillPerSec: 5 },
    });
    const s = budget.state();
    expect(s.crossref.capacity).toBe(10);
    expect(s.citoid.capacity).toBe(20);
    expect(s.openlibrary.capacity).toBe(5);
  });
});

describe("upstreamForInputKind", () => {
  it.each([
    ["doi", "crossref"],
    ["url", "citoid"],
    ["isbn", "openlibrary"],
  ] as const)("%s -> %s", (kind, upstream) => {
    expect(upstreamForInputKind(kind)).toBe(upstream);
  });

  it.each(["html", "text", "ris", "easybib", "other"])(
    "returns null for non-gated kind: %s",
    (kind) => {
      expect(upstreamForInputKind(kind)).toBeNull();
    },
  );
});
