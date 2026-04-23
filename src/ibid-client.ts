/**
 * Shared `@bwthomas/ibid` client. Built once at server startup and
 * handed to every route. Wires the configured DOM adapter (linkedom),
 * pino child logger, shared LRU cache, and (when configured) an LLM
 * adapter — Anthropic-direct or AWS Bedrock, depending on which creds
 * the boot environment provides.
 *
 * LLM surfaces:
 *   - URL extraction (`extract_from_url`) — via `options.llm`, the
 *     existing `Llm` strategy in the extract chain.
 *   - Freetext search (`lookup-candidates/articleTitle`) — via a
 *     consumer-registered `CrossRefFreetext` adapter with `llm` wired
 *     through. The built-in core fallback is plain CrossRef; registering
 *     an LLM-enabled variant makes it the primary search adapter.
 *
 * Provider selection (see `resolveLlmConfig` in `config.ts` for env
 * semantics): Bedrock > Anthropic > none.
 */

import { createIbid } from "@bwthomas/ibid";
import { createDomAdapterFromParser } from "@bwthomas/ibid/dom-linkedom";
import { createAnthropicLlm } from "@bwthomas/ibid/llm-anthropic";
import { createBedrockLlm } from "@bwthomas/ibid/llm-bedrock";
import { createCrossRefFreetext } from "@bwthomas/ibid/article-crossref-freetext";
import type { CacheAdapter, LlmAdapter, Logger } from "@bwthomas/ibid";
import { parseHTML } from "linkedom";

import type { FreetextRescueConfig, ServiceConfig } from "./config.js";

export type IbidClient = ReturnType<typeof createIbid>;

/**
 * Construct the shared ibid client. Called once; the returned client is
 * thread-safe (strategies are pure functions, and every `extract()` starts
 * from a fresh Context).
 */
export function createServiceIbid(
  config: ServiceConfig,
  logger: Logger,
  cache: CacheAdapter,
): IbidClient {
  const dom = createDomAdapterFromParser(
    (html) => parseHTML(html) as { document: unknown },
  );
  const { llm, freetextRescue } = resolveLlm(config);

  // When LLM is configured, register an LLM-enabled freetext search
  // adapter as the primary article-search surface. `lookupCandidates`
  // core calls registered adapters first; the built-in plain-CrossRef
  // fallback only fires if none hit — in practice only on empty-result
  // queries where the LLM re-rank couldn't help anyway.
  const articleSearchAdapters = llm
    ? [
        createCrossRefFreetext({
          llm,
          userAgent: config.ibid.userAgent,
          llmRescue: {
            rescueMinScore: freetextRescue?.minScore,
            rescueMinTitleTokenOverlap: freetextRescue?.minTitleOverlap,
            maxCandidates: freetextRescue?.maxCandidates,
            maxTokens: freetextRescue?.maxTokens,
            temperature: freetextRescue?.temperature,
          },
        }),
      ]
    : [];

  return createIbid({
    dom,
    logger,
    cache,
    llm,
    articleSearchAdapters,
    userAgent: config.ibid.userAgent,
    timeoutMs: config.ibid.timeoutMs,
    crossrefEndpoint: config.ibid.crossrefEndpoint,
    citoidEndpoint: config.ibid.citoidEndpoint,
    translationServerEndpoint:
      config.ibid.translationServerEndpoint || undefined,
    strategyOverrides: config.ibid.strategyOverrides,
  });
}

/**
 * Materialize the configured LLM adapter (or `undefined` when no
 * provider is configured). Kept out of `createServiceIbid` so tests
 * can exercise provider selection in isolation.
 */
function resolveLlm(
  config: ServiceConfig,
): { llm: LlmAdapter | undefined; freetextRescue: FreetextRescueConfig | undefined } {
  if (config.llm.provider === "anthropic") {
    return {
      llm: createAnthropicLlm({
        apiKey: config.llm.apiKey,
        model: config.llm.model,
      }),
      freetextRescue: config.llm.freetextRescue,
    };
  }
  if (config.llm.provider === "bedrock") {
    return {
      llm: createBedrockLlm({
        region: config.llm.region,
        modelId: config.llm.modelId,
        credentials: {
          accessKeyId: config.llm.accessKeyId,
          secretAccessKey: config.llm.secretAccessKey,
          sessionToken: config.llm.sessionToken,
        },
      }),
      freetextRescue: config.llm.freetextRescue,
    };
  }
  return { llm: undefined, freetextRescue: undefined };
}
