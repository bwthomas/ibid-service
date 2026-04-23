import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    IBID_SERVICE_AUTH: "0123456789abcdef0123",
    ...extra,
  } as NodeJS.ProcessEnv;
}

describe("loadConfig — IBID_CACHE_ENABLED", () => {
  it("defaults to true when unset", () => {
    const cfg = loadConfig(env());
    expect(cfg.cache.enabled).toBe(true);
  });
  it("false when IBID_CACHE_ENABLED=false", () => {
    const cfg = loadConfig(env({ IBID_CACHE_ENABLED: "false" }));
    expect(cfg.cache.enabled).toBe(false);
  });
  it("true when IBID_CACHE_ENABLED=true", () => {
    const cfg = loadConfig(env({ IBID_CACHE_ENABLED: "true" }));
    expect(cfg.cache.enabled).toBe(true);
  });
});

describe("loadConfig — LLM provider selection", () => {
  it("provider=none when no creds present", () => {
    const cfg = loadConfig(env());
    expect(cfg.llm.provider).toBe("none");
  });

  it("picks Anthropic when only IBID_LLM_ANTHROPIC_API_KEY set", () => {
    const cfg = loadConfig(env({ IBID_LLM_ANTHROPIC_API_KEY: "sk-ant-test" }));
    if (cfg.llm.provider !== "anthropic") throw new Error("wrong provider");
    expect(cfg.llm.apiKey).toBe("sk-ant-test");
    expect(cfg.llm.model).toBe("claude-haiku-4-5-20251001");
  });

  it("picks Bedrock when AWS creds set (both access+secret)", () => {
    const cfg = loadConfig(env({
      AWS_ACCESS_KEY_ID: "AKIA-test",
      AWS_SECRET_ACCESS_KEY: "secret-test",
      AWS_REGION: "us-west-2",
    }));
    if (cfg.llm.provider !== "bedrock") throw new Error("wrong provider");
    expect(cfg.llm.region).toBe("us-west-2");
    expect(cfg.llm.accessKeyId).toBe("AKIA-test");
    expect(cfg.llm.modelId).toBe("us.anthropic.claude-haiku-4-5-20251001-v1:0");
    expect(cfg.llm.sessionToken).toBeUndefined();
  });

  it("honors IBID_LLM_BEDROCK_REGION over AWS_REGION", () => {
    const cfg = loadConfig(env({
      AWS_ACCESS_KEY_ID: "AKIA-test",
      AWS_SECRET_ACCESS_KEY: "secret-test",
      AWS_REGION: "us-east-1",
      IBID_LLM_BEDROCK_REGION: "us-west-2",
    }));
    if (cfg.llm.provider !== "bedrock") throw new Error("wrong provider");
    expect(cfg.llm.region).toBe("us-west-2");
  });

  it("honors IBID_LLM_BEDROCK_MODEL override (e.g. Nova Lite)", () => {
    const cfg = loadConfig(env({
      AWS_ACCESS_KEY_ID: "AKIA-test",
      AWS_SECRET_ACCESS_KEY: "secret-test",
      IBID_LLM_BEDROCK_MODEL: "us.amazon.nova-lite-v1:0",
    }));
    if (cfg.llm.provider !== "bedrock") throw new Error("wrong provider");
    expect(cfg.llm.modelId).toBe("us.amazon.nova-lite-v1:0");
  });

  it("passes through AWS_SESSION_TOKEN for STS credentials", () => {
    const cfg = loadConfig(env({
      AWS_ACCESS_KEY_ID: "AKIA-test",
      AWS_SECRET_ACCESS_KEY: "secret-test",
      AWS_SESSION_TOKEN: "sts-session-token",
    }));
    if (cfg.llm.provider !== "bedrock") throw new Error("wrong provider");
    expect(cfg.llm.sessionToken).toBe("sts-session-token");
  });

  it("Bedrock wins when both Bedrock and Anthropic configured", () => {
    const cfg = loadConfig(env({
      AWS_ACCESS_KEY_ID: "AKIA-test",
      AWS_SECRET_ACCESS_KEY: "secret-test",
      IBID_LLM_ANTHROPIC_API_KEY: "sk-ant-also-set",
    }));
    expect(cfg.llm.provider).toBe("bedrock");
  });

  it("ignores half-set AWS creds (only access key, no secret)", () => {
    const cfg = loadConfig(env({ AWS_ACCESS_KEY_ID: "AKIA-test" }));
    expect(cfg.llm.provider).toBe("none");
  });

  it("freetextRescue tuning env vars flow through to the picked provider", () => {
    const cfg = loadConfig(env({
      AWS_ACCESS_KEY_ID: "AKIA-test",
      AWS_SECRET_ACCESS_KEY: "secret-test",
      IBID_LLM_FREETEXT_MIN_SCORE: "42",
      IBID_LLM_FREETEXT_MAX_TOKENS: "256",
    }));
    if (cfg.llm.provider !== "bedrock") throw new Error("wrong provider");
    expect(cfg.llm.freetextRescue?.minScore).toBe(42);
    expect(cfg.llm.freetextRescue?.maxTokens).toBe(256);
  });
});

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
