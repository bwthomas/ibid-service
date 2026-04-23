import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    IBID_SERVICE_AUTH: "0123456789abcdef0123",
    ...extra,
  } as NodeJS.ProcessEnv;
}

describe("loadConfig — strategyOverrides", () => {
  it("is empty by default", () => {
    const cfg = loadConfig(env());
    expect(cfg.ibid.strategyOverrides).toEqual({});
  });

  it("parses IBID_STRATEGY_CITOID_URL_FALLBACK=true", () => {
    const cfg = loadConfig(env({ IBID_STRATEGY_CITOID_URL_FALLBACK: "true" }));
    expect(cfg.ibid.strategyOverrides).toEqual({
      CitoidUrl: { fallback: true },
    });
  });

  it("parses IBID_STRATEGY_LLM_ENABLED=false", () => {
    const cfg = loadConfig(env({ IBID_STRATEGY_LLM_ENABLED: "false" }));
    expect(cfg.ibid.strategyOverrides).toEqual({ Llm: { enabled: false } });
  });

  it("combines multiple fields on one strategy", () => {
    const cfg = loadConfig(
      env({
        IBID_STRATEGY_CITOID_URL_FALLBACK: "true",
        IBID_STRATEGY_CITOID_URL_MIN_CURRENT_BEST_CONFIDENCE: "40",
      }),
    );
    expect(cfg.ibid.strategyOverrides).toEqual({
      CitoidUrl: { fallback: true, minCurrentBestConfidence: 40 },
    });
  });

  it("ignores unrecognized strategy names silently at env layer", () => {
    // Env vars for non-existent strategies aren't surfaced; the library
    // will warn if the name reaches it via an explicit config, but env
    // parsing only looks at the known built-in list.
    const cfg = loadConfig(env({ IBID_STRATEGY_NOT_A_REAL_ENABLED: "false" }));
    expect(cfg.ibid.strategyOverrides).toEqual({});
  });

  it("tokenizes camelCase → SNAKE_CASE correctly", () => {
    const cfg = loadConfig(
      env({
        IBID_STRATEGY_CROSS_REF_DOI_ENABLED: "false",
        IBID_STRATEGY_SCHEMA_ORG_LD_JSON_FALLBACK: "true",
      }),
    );
    expect(cfg.ibid.strategyOverrides).toEqual({
      CrossRefDoi: { enabled: false },
      SchemaOrgLdJson: { fallback: true },
    });
  });
});
