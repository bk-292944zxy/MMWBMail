import type {
  QuickFactFallback,
  QuickFactResponse,
  QuickFactResult
} from "@/lib/quickfact";
import { buildQuickFactFallback, fetchTavilyQuickFactBundle } from "@/lib/tavily-quickfact";
import { condenseQuickFactWithGPT } from "@/lib/quickfact-gpt";

function isHighlyUsableTavilyResult(result: QuickFactResult) {
  return Boolean(result.answer.trim()) && Boolean(result.sourceName?.trim()) && Boolean(result.sourceUrl?.trim());
}

function pickBestTavilyResult(results: QuickFactResult[]) {
  return results[0] ?? null;
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

  if (bundle.fallback && bundle.retrievalQuality === "empty") {
    return buildFallback(bundle.fallback);
  }

  const bestTavilyResult = pickBestTavilyResult(bundle.cleanResults);
  if (bestTavilyResult && isHighlyUsableTavilyResult(bestTavilyResult) && bundle.retrievalQuality === "strong") {
    return buildResponseFromResult(bestTavilyResult);
  }

  const gptResults = await condenseQuickFactWithGPT({
    query,
    queryType: bundle.queryType,
    retrievalConfidence: bundle.retrievalQuality,
    bundle
  });

  if (gptResults.length > 0) {
    return {
      results: gptResults
    };
  }

  if (bestTavilyResult) {
    return buildResponseFromResult(bestTavilyResult);
  }

  return buildFallback(bundle.fallback);
}

