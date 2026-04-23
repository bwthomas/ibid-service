/**
 * Config-schema validation tests. Runs against the default config that
 * ships with the harness + a minimal synthetic config. Uses vitest.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfig, EvalConfigSchema } from "../config-schema.js";

describe("EvalConfigSchema", () => {
  it("accepts the default config shipped in eval/configs/default.json", () => {
    const { config } = loadConfig(
      join(__dirname, "..", "configs", "default.json"),
    );
    expect(config.variants.length).toBeGreaterThan(0);
    expect(config.opsEnabled).toContain("extract_from_url");
    expect(config.baseline.enabled).toBe(false);
  });

  it("resolves relative corpus paths against the config's directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-config-"));
    try {
      const cfg = {
        corpus: { doi: "./sub/doi.jsonl" },
        opsEnabled: ["crossref_doi_lookup"],
        variants: [
          {
            name: "none",
            provider: "none",
            usdPerMtokIn: 0,
            usdPerMtokOut: 0,
          },
        ],
        resultsDir: "./out",
      };
      const path = join(dir, "cfg.json");
      writeFileSync(path, JSON.stringify(cfg));
      const { config } = loadConfig(path);
      expect(config.corpus.doi).toBe(join(dir, "sub/doi.jsonl"));
      expect(config.resultsDir).toBe(join(dir, "out"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects empty variants", () => {
    expect(() =>
      EvalConfigSchema.parse({
        corpus: {},
        opsEnabled: ["parse_ris"],
        variants: [],
      }),
    ).toThrow();
  });

  it("rejects unknown ops", () => {
    expect(() =>
      EvalConfigSchema.parse({
        corpus: {},
        opsEnabled: ["not_a_real_op"],
        variants: [
          { name: "x", provider: "none", usdPerMtokIn: 0, usdPerMtokOut: 0 },
        ],
      }),
    ).toThrow();
  });

  it("applies default usageWeights when omitted", () => {
    const parsed = EvalConfigSchema.parse({
      corpus: {},
      opsEnabled: ["extract_from_url"],
      variants: [
        { name: "x", provider: "none", usdPerMtokIn: 0, usdPerMtokOut: 0 },
      ],
    });
    expect(parsed.usageWeights.extract_from_url).toBeCloseTo(0.7);
  });
});
