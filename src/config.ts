/**
 * Env-derived service configuration. SPEC §7.
 *
 * Fail-fast: refuse to start without a shared secret. Tests pass a fake
 * secret via `TEST_IBID_SERVICE_AUTH`, keeping production defaults strict.
 */

export interface ServiceConfig {
  port: number;
  authSecret: string;
  logLevel: "debug" | "info" | "warn" | "error";
  bodyLimitBytes: number;
  requestTimeoutMs: number;
  ibid: {
    userAgent: string;
    crossrefEndpoint: string;
    citoidEndpoint: string;
    /** Optional self-hosted Zotero translation-server endpoint. Empty → unset. */
    translationServerEndpoint: string;
    timeoutMs: number;
    /**
     * Per-strategy overrides passed through to ibid's `strategyOverrides`.
     * Env-driven; each entry keyed by strategy name. Default: empty.
     *
     * Env-var pattern for each strategy:
     *   IBID_STRATEGY_<NAME>_ENABLED=false
     *   IBID_STRATEGY_<NAME>_FALLBACK=true
     *   IBID_STRATEGY_<NAME>_MIN_CURRENT_BEST_CONFIDENCE=40
     *
     * e.g. `IBID_STRATEGY_CITOID_URL_FALLBACK=true` to move CitoidUrl
     * into ibid's fallback tier (see ibid SPEC §8.1.1.1 for mechanism).
     */
    strategyOverrides: Record<
      string,
      { enabled?: boolean; fallback?: boolean; minCurrentBestConfidence?: number }
    >;
  };
  cache: {
    enabled: boolean;
    max: number;
    ttlMs: number;
  };
  budget: {
    crossref: { capacity: number; refillPerSec: number };
    citoid: { capacity: number; refillPerSec: number };
    openlibrary: { capacity: number; refillPerSec: number };
  };
  llm:
    | {
        provider: "anthropic";
        apiKey: string;
        model: string;
        /**
         * Tuning knobs for freetext-search LLM rescue. All optional —
         * `undefined` → the library's defaults in
         * `@bwthomas/ibid/article-crossref-freetext`.
         */
        freetextRescue?: {
          minScore?: number;
          minTitleOverlap?: number;
          maxCandidates?: number;
          maxTokens?: number;
          temperature?: number;
        };
      }
    | { provider: "none" };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const authSecret = env.IBID_SERVICE_AUTH ?? env.TEST_IBID_SERVICE_AUTH;
  if (!authSecret || authSecret.length < 16) {
    throw new Error(
      "IBID_SERVICE_AUTH must be set to a 16+ character secret before startup",
    );
  }
  const anthropicKey = env.IBID_LLM_ANTHROPIC_API_KEY;
  return {
    port: Number(env.PORT ?? 3000),
    authSecret,
    logLevel: (env.LOG_LEVEL as ServiceConfig["logLevel"]) ?? "info",
    bodyLimitBytes: Number(env.BODY_LIMIT_BYTES ?? 2 * 1024 * 1024),
    requestTimeoutMs: Number(env.REQUEST_TIMEOUT_MS ?? 10_000),
    ibid: {
      userAgent:
        env.IBID_USER_AGENT ??
        "ibid-service/0.1.0 (+https://github.com/bwthomas/ibid-service)",
      crossrefEndpoint:
        env.IBID_CROSSREF_ENDPOINT ?? "https://api.crossref.org",
      citoidEndpoint:
        env.IBID_CITOID_ENDPOINT ??
        "https://en.wikipedia.org/api/rest_v1/data/citation",
      translationServerEndpoint: env.IBID_TRANSLATION_SERVER_URL ?? "",
      timeoutMs: Number(env.IBID_TIMEOUT_MS ?? 5_000),
      strategyOverrides: parseStrategyOverrides(env),
    },
    cache: {
      enabled: boolOrUndef(env.IBID_CACHE_ENABLED) ?? true,
      max: Number(env.IBID_CACHE_MAX ?? 10_000),
      ttlMs: Number(env.IBID_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000),
    },
    budget: {
      crossref: {
        capacity: Number(env.IBID_BUDGET_CROSSREF_CAPACITY ?? 50),
        refillPerSec: Number(env.IBID_BUDGET_CROSSREF_REFILL_PER_SEC ?? 50),
      },
      citoid: {
        capacity: Number(env.IBID_BUDGET_CITOID_CAPACITY ?? 30),
        refillPerSec: Number(env.IBID_BUDGET_CITOID_REFILL_PER_SEC ?? 30),
      },
      openlibrary: {
        capacity: Number(env.IBID_BUDGET_OPENLIBRARY_CAPACITY ?? 20),
        refillPerSec: Number(env.IBID_BUDGET_OPENLIBRARY_REFILL_PER_SEC ?? 20),
      },
    },
    llm: anthropicKey
      ? {
          provider: "anthropic",
          apiKey: anthropicKey,
          model: env.IBID_LLM_ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
          freetextRescue: {
            minScore: numOrUndef(env.IBID_LLM_FREETEXT_MIN_SCORE),
            minTitleOverlap: numOrUndef(env.IBID_LLM_FREETEXT_MIN_OVERLAP),
            maxCandidates: numOrUndef(env.IBID_LLM_FREETEXT_MAX_CANDIDATES),
            maxTokens: numOrUndef(env.IBID_LLM_FREETEXT_MAX_TOKENS),
            temperature: numOrUndef(env.IBID_LLM_FREETEXT_TEMPERATURE),
          },
        }
      : { provider: "none" },
  };
}

function numOrUndef(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function boolOrUndef(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === "") return undefined;
  const v = raw.toLowerCase().trim();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return undefined;
}

/**
 * Parse `IBID_STRATEGY_<NAME>_<FIELD>` env vars into a
 * `strategyOverrides` dictionary. Strategy name is the literal ibid
 * strategy `name`; env var token converts `CitoidUrl` ↔ `CITOID_URL`.
 *
 * Recognized suffixes: `_ENABLED`, `_FALLBACK`, `_MIN_CURRENT_BEST_CONFIDENCE`.
 */
function parseStrategyOverrides(
  env: NodeJS.ProcessEnv,
): Record<
  string,
  { enabled?: boolean; fallback?: boolean; minCurrentBestConfidence?: number }
> {
  // Known built-in strategy names → ENV token form.
  const known = [
    "CrossRefDoi",
    "DoiInHtml",
    "Highwire",
    "CitoidDoi",
    "TranslationServer",
    "CitoidUrl",
    "ImageExtractor",
    "SchemaOrgLdJson",
    "SchemaOrgMicrodata",
    "MetaTagFallback",
    "IsbnAdapterChain",
    "OpenLibraryIsbn",
    "UrlFallback",
    "Llm",
  ] as const;
  const out: Record<
    string,
    { enabled?: boolean; fallback?: boolean; minCurrentBestConfidence?: number }
  > = {};
  for (const name of known) {
    const token = name
      .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toUpperCase();
    const enabled = boolOrUndef(env[`IBID_STRATEGY_${token}_ENABLED`]);
    const fallback = boolOrUndef(env[`IBID_STRATEGY_${token}_FALLBACK`]);
    const minConf = numOrUndef(
      env[`IBID_STRATEGY_${token}_MIN_CURRENT_BEST_CONFIDENCE`],
    );
    if (enabled !== undefined || fallback !== undefined || minConf !== undefined) {
      out[name] = {};
      if (enabled !== undefined) out[name].enabled = enabled;
      if (fallback !== undefined) out[name].fallback = fallback;
      if (minConf !== undefined) out[name].minCurrentBestConfidence = minConf;
    }
  }
  return out;
}
