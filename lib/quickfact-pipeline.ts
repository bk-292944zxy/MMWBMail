import type {
  QuickFactFallback,
  QuickFactResponse,
  QuickFactResult
} from "@/lib/quickfact";
import {
  buildQuickFactFallback,
  fetchTavilyQuickFactBundle,
  validateQuickFactAnswer
} from "@/lib/tavily-quickfact";
import { condenseQuickFactWithGPT } from "@/lib/quickfact-gpt";

function isHighlyUsableTavilyResult(result: QuickFactResult) {
  return Boolean(result.answer.trim()) && Boolean(result.sourceName?.trim()) && Boolean(result.sourceUrl?.trim());
}

function pickBestTavilyResult(results: QuickFactResult[]) {
  return results[0] ?? null;
}

function isResultVetted(result: QuickFactResult, query: string, queryType: Parameters<typeof validateQuickFactAnswer>[2]) {
  return validateQuickFactAnswer(result.answer, query, queryType).acceptable;
}

function buildResponseFromResult(result: QuickFactResult): QuickFactResponse {
  return {
    results: [result]
  };
}

function buildFallback(bundleFallback?: QuickFactFallback): QuickFactResponse {
  return {
    results: [],
    fallback: bundleFallback ?? buildQuickFactFallback("no_clean_fact")
  };
}

export async function runQuickFactPipeline(query: string): Promise<QuickFactResponse> {
  const bundle = await fetchTavilyQuickFactBundle(query);
  const evaluationQuery = bundle.normalizedQuery || query;

  if (bundle.fallback && bundle.retrievalQuality === "empty") {
    return buildFallback(bundle.fallback);
  }

  const bestTavilyResult = pickBestTavilyResult(bundle.cleanResults);
  if (
    bestTavilyResult &&
    isHighlyUsableTavilyResult(bestTavilyResult) &&
    bundle.retrievalQuality === "strong" &&
    isResultVetted(bestTavilyResult, evaluationQuery, bundle.queryType)
  ) {
    return buildResponseFromResult(bestTavilyResult);
  }

  const gptResults = await condenseQuickFactWithGPT({
    query,
    queryType: bundle.queryType,
    retrievalConfidence: bundle.retrievalQuality,
    bundle
  });

  const vettedGptResult = gptResults.find((result) =>
    isResultVetted(result, evaluationQuery, bundle.queryType)
  );

  if (vettedGptResult) {
    return {
      results: [vettedGptResult]
    };
  }

  if (
    bestTavilyResult &&
    isResultVetted(bestTavilyResult, evaluationQuery, bundle.queryType)
  ) {
    return buildResponseFromResult(bestTavilyResult);
  }

  return buildFallback(bundle.fallback);
}
