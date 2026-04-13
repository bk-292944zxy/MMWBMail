import { getCurrentOwnerTavilyApiKey } from "@/lib/tavily-settings";
import type {
  QuickFactConfidence,
  QuickFactFallback,
  QuickFactResult
} from "@/lib/quickfact";

export type QuickFactQueryType =
  | "date"
  | "count"
  | "product"
  | "market_fact"
  | "role_or_name"
  | "general_fact";

export type TavilySearchResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
  publishedDate?: string;
};

type TavilySearchResponse = {
  answer?: string;
  results?: TavilySearchResult[];
};

type QuickFactTestEvaluationInput = {
  query: string;
  results: TavilySearchResult[];
  answer?: string | null;
};

export type QuickFactAnswerValidation = {
  acceptable: boolean;
  reasons: string[];
};

export type QuickFactStressCandidate = {
  title: string;
  url: string;
  sourceScore: number;
  relevanceScore: number;
  normalizedAnswer: string;
  accepted: boolean;
  reasons: string[];
};

export type QuickFactStressEvaluation = {
  normalizedQuery: string;
  queryType: QuickFactQueryType;
  retrievalQuality: QuickFactRetrievalQuality;
  cleanResults: QuickFactResult[];
  candidates: QuickFactStressCandidate[];
};

export type QuickFactRetrievalQuality = "strong" | "mixed" | "weak" | "empty";

export type TavilyQuickFactBundle = {
  query: string;
  normalizedQuery: string;
  queryType: QuickFactQueryType;
  answer: string | null;
  rawResults: TavilySearchResult[];
  cleanResults: QuickFactResult[];
  bestSource: TavilySearchResult | null;
  retrievalQuality: QuickFactRetrievalQuality;
  fallback?: QuickFactFallback;
};

const QUICKFACT_RESULT_LIMIT = 1;
const QUICKFACT_MAX_RESULTS = 4;
const QUICKFACT_EXCLUDED_DOMAINS = [
  "reddit.com",
  "quora.com",
  "medium.com",
  "substack.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "youtube.com",
  "stackexchange.com"
];
const HIGH_TRUST_DOMAIN_HINTS = [
  ".gov",
  ".edu",
  "wikipedia.org",
  "britannica.com",
  "github.com",
  "google.com",
  "apple.com",
  "amazon.com",
  "microsoft.com",
  "salesforce.com",
  "academyawards.com",
  "oscars.org"
];
const REPUTABLE_DOMAIN_HINTS = [
  "apnews.com",
  "reuters.com",
  "nytimes.com",
  "wsj.com",
  "bloomberg.com",
  "forbes.com",
  "investopedia.com",
  "sec.gov"
];
const TITLE_REJECTION_PATTERNS = [
  /\breddit\b/i,
  /\bquora\b/i,
  /\bforum\b/i,
  /\bdiscussion\b/i,
  /\bcommunity\b/i,
  /\bthread\b/i,
  /\bopinion\b/i,
  /\blist of\b/i,
  /\btop\s+\d+\b/i,
  /\bbest\b/i
];
const URL_REJECTION_PATTERNS = [
  /\/forum\//i,
  /\/forums\//i,
  /\/community\//i,
  /\/discussion\//i,
  /\/thread\//i,
  /\/comments\//i,
  /\/questions\//i
];
const FACT_SIGNAL_PATTERNS = [
  /\b\d{4}\b/,
  /\b\d+(?:,\d{3})*(?:\.\d+)?\b/,
  /\b\d+(?:\.\d+)?%\b/,
  /\bwas\b/i,
  /\bis\b/i,
  /\bare\b/i,
  /\bhas\b/i,
  /\bhad\b/i,
  /\breleased\b/i,
  /\bfounded\b/i,
  /\bmerged\b/i,
  /\bnewest\b/i,
  /\blatest\b/i,
  /\bcurrent\b/i,
  /\bmodel\b/i,
  /\blineup\b/i,
  /\bwent public\b/i,
  /\bipo\b/i,
  /\bsold\b/i,
  /\bemployees?\b/i
];
const QUICKFACT_NOISE_PATTERNS = [
  /live countdown/i,
  /share (it|this) with your friends/i,
  /click here/i,
  /learn more/i,
  /read more/i,
  /watch now/i,
  /sign up/i,
  /subscribe/i,
  /breaking news/i,
  /comments?/i,
  /votes?/i,
  /hours?, minutes?(?:,| and) seconds?/i,
  /follow us/i,
  /download now/i,
  /newsletter/i,
  /\bwritten by\b/i,
  /\bauthor\b/i,
  /\bcontributor\b/i,
  /\beditor\b/i,
  /\bfact-checked by\b/i,
  /\brevised by\b/i,
  /\bnavigation\b/i,
  /\btable of contents\b/i
];
const QUERY_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "with",
  "and",
  "or",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "who",
  "what",
  "when",
  "where",
  "why",
  "how",
  "much",
  "many",
  "often",
  "last",
  "latest",
  "current",
  "season"
]);
const HIGH_CONFIDENCE_TERM_CORRECTIONS: Record<string, string> = {
  cameros: "camaros",
  camero: "camaro"
};
const PARTIAL_SCOPE_PATTERNS = [
  /\bq[1-4]\b/i,
  /\bquarter\b/i,
  /\bmonth(?:ly)?\b/i,
  /\bstate\b/i,
  /\bregional?\b/i,
  /\bcity\b/i,
  /\bdealer(?:ship)?s?\b/i,
  /\btrim\b/i,
  /\bvariant\b/i
];
const NUMERIC_SALES_CONTEXT_PATTERN = /\b(sold|sales|units?|deliver(?:ed|ies)|registrations?)\b/i;
const NATIONAL_SCOPE_PATTERN = /\b(nationwide|national|u\.s\.|united states|in the us|in us)\b/i;
const PRICE_UNIT_PATTERN = /\$|\busd\b|\bdollars?\b/i;
const RATE_UNIT_PATTERN = /%|\bpercent(?:age)?\b|\brate\b/i;
const DATE_OR_SEASON_PATTERN =
  /\b20\d{2}\b|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b|\bseason\s+\d+\b/i;

const QUICKFACT_TAVILY_TIMEOUT_MS = 7000;

function applyHighConfidenceCorrections(query: string) {
  let next = query;

  Object.entries(HIGH_CONFIDENCE_TERM_CORRECTIONS).forEach(([misspelling, correction]) => {
    const pattern = new RegExp(`\\b${misspelling}\\b`, "gi");
    next = next.replace(pattern, correction);
  });

  return next;
}

function normalizeTimePhrases(query: string) {
  let next = query;
  const nowYear = new Date().getFullYear();
  const lastYear = nowYear - 1;

  if (/\blast year\b/i.test(next) && !/\b20\d{2}\b/.test(next)) {
    next = next.replace(/\blast year\b/gi, `in ${lastYear}`);
  }

  if (/\bthis year\b/i.test(next) && !/\b20\d{2}\b/.test(next)) {
    next = next.replace(/\bthis year\b/gi, `in ${nowYear}`);
  }

  return next;
}

export function normalizeQuickFactQuery(query: string) {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }

  let rewritten = normalizeTimePhrases(applyHighConfidenceCorrections(normalized));
  if (/\bwho won\b/i.test(rewritten)) {
    rewritten = rewritten.replace(/\blast\b/gi, "most recent");
    if (!/\bwinner\b/i.test(rewritten)) {
      rewritten = `${rewritten} winner`;
    }
  }

  if (/\baverage price\b/i.test(rewritten) && !/\bcurrent\b/i.test(rewritten)) {
    rewritten = `${rewritten} current price`;
  }

  return rewritten.replace(/\s+/g, " ").trim();
}

function isTimeSensitiveQuery(query: string) {
  return /\b(20\d{2}|most recent|latest|current|this year|last year|season)\b/i.test(query);
}

function extractDomain(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function extractSourceName(result: TavilySearchResult) {
  const domain = extractDomain(result.url ?? "");
  if (domain) {
    return domain.replace(/^www\./, "");
  }

  return result.title?.trim() || "Source";
}

function isExcludedDomain(domain: string) {
  return QUICKFACT_EXCLUDED_DOMAINS.some(
    (excluded) => domain === excluded || domain.endsWith(`.${excluded}`)
  );
}

function isHighTrustDomain(domain: string) {
  return HIGH_TRUST_DOMAIN_HINTS.some(
    (hint) => domain === hint || domain.endsWith(`.${hint}`) || domain.endsWith(hint)
  );
}

function isReputableDomain(domain: string) {
  return REPUTABLE_DOMAIN_HINTS.some(
    (hint) => domain === hint || domain.endsWith(`.${hint}`) || domain.endsWith(hint)
  );
}

function toCompactAnswer(text: string) {
  const normalized = sanitizeForSentenceSplit(text).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  const sentences = normalized.match(/[^.!?]+[.!?]?/g) ?? [normalized];
  return sentences
    .map((sentence) => restoreSentenceSplitArtifacts(sentence.trim()))
    .filter(Boolean)
    .slice(0, 2)
    .join(" ")
    .trim();
}

function splitSentences(text: string) {
  const normalized = sanitizeForSentenceSplit(text);
  return (normalized.match(/[^.!?]+[.!?]?/g) ?? [normalized])
    .map((sentence) => restoreSentenceSplitArtifacts(sentence.trim()))
    .filter(Boolean);
}

function normalizeCommonAbbreviations(text: string) {
  return text
    .replace(/\bU\.\s*S\.(?=\s|$)/gi, "US")
    .replace(/\bU\.\s*K\.(?=\s|$)/gi, "UK");
}

function sanitizeForSentenceSplit(text: string) {
  return normalizeCommonAbbreviations(text).replace(/(\d)\.(\d)/g, "$1__QF_DECIMAL__$2");
}

function restoreSentenceSplitArtifacts(text: string) {
  return text.replace(/__QF_DECIMAL__/g, ".");
}

export function classifyQuickFactQuery(query: string): QuickFactQueryType {
  const normalized = query.toLowerCase();

  if (/\bwhen\b|\bwhat year\b|\bdate\b|\breleased\b|\bfounded\b|\bmerged\b|\bgo public\b/.test(normalized)) {
    return "date";
  }

  if (/\bhow many\b|\bnumber of\b|\bcount\b|\bpopulation\b/.test(normalized)) {
    return /\bsold\b|\bsales\b|\brevenue\b|\bmarket\b/.test(normalized) ? "market_fact" : "count";
  }

  if (/\bnewest\b|\blatest\b|\bcurrent\b|\bmodel\b|\bversion\b|\blineup\b/.test(normalized)) {
    return "product";
  }

  if (/\bsold\b|\bsales\b|\brevenue\b|\bmarket\b|\bshare\b|\branking\b|\brand\b/.test(normalized)) {
    return "market_fact";
  }

  if (/\bwho is\b|\bwhat is\b|\btitle\b|\brole\b|\bdefinition\b|\bcalled\b|\bname of\b/.test(normalized)) {
    return "role_or_name";
  }

  return "general_fact";
}

function looksTooBroadForQuickFact(query: string) {
  const normalized = query.toLowerCase();
  return (
    normalized.length > 120 ||
    /\bcompare\b|\banalyze\b|\bpros and cons\b|\bwhy\b|\bstrategy\b|\bresearch\b|\bdeep dive\b|\bforecast\b/.test(
      normalized
    )
  );
}

function looksLikeWeakResult(result: TavilySearchResult) {
  const title = result.title?.trim() ?? "";
  const url = result.url?.trim() ?? "";
  return (
    TITLE_REJECTION_PATTERNS.some((pattern) => pattern.test(title)) ||
    URL_REJECTION_PATTERNS.some((pattern) => pattern.test(url))
  );
}

function hasFactLikeAnswer(text: string) {
  return FACT_SIGNAL_PATTERNS.some((pattern) => pattern.test(text));
}

function stripNoisePhrases(text: string) {
  let next = text;
  QUICKFACT_NOISE_PATTERNS.forEach((pattern) => {
    next = next.replace(pattern, "");
  });

  return next.replace(/\s+/g, " ").trim();
}

function extractQueryKeywords(query: string) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s$%.-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !QUERY_STOPWORDS.has(token));
}

function countKeywordHits(text: string, keywords: string[]) {
  if (keywords.length === 0) {
    return 0;
  }

  const normalizedText = text.toLowerCase();
  let hits = 0;
  keywords.forEach((keyword) => {
    if (normalizedText.includes(keyword)) {
      hits += 1;
    }
  });
  return hits;
}

function isLikelyBylineOrNavigation(text: string) {
  const normalized = text.toLowerCase();
  return (
    /\bby\s+[a-z]/i.test(text) ||
    /\bwritten by\b/.test(normalized) ||
    /\bauthor\b/.test(normalized) ||
    /\bcontributor\b/.test(normalized) ||
    /\bfact-checked by\b/.test(normalized) ||
    /\btable of contents\b/.test(normalized) ||
    /\bmenu\b/.test(normalized) ||
    /\bprivacy policy\b/.test(normalized)
  );
}

function queryDemandsWinner(query: string) {
  const normalized = query.toLowerCase();
  return /\bwho won\b/.test(normalized) || /\bwinner\b/.test(normalized);
}

function queryDemandsPrice(query: string) {
  const normalized = query.toLowerCase();
  return /\bprice\b/.test(normalized) || /\bcost\b/.test(normalized);
}

function queryDemandsRateOrStat(query: string) {
  const normalized = query.toLowerCase();
  return /\bhow often\b/.test(normalized) || /\brate\b/.test(normalized) || /\bstat(?:istic)?\b/.test(normalized);
}

function queryDemandsNumericTotal(query: string, queryType: QuickFactQueryType) {
  return (
    queryType === "count" ||
    queryType === "market_fact" ||
    /\bhow many\b|\bnumber of\b|\btotal\b/i.test(query)
  );
}

function queryDemandsNationalSales(query: string) {
  return NATIONAL_SCOPE_PATTERN.test(query) && NUMERIC_SALES_CONTEXT_PATTERN.test(query);
}

function extractNumericValues(text: string) {
  const matches = text.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g) ?? [];
  return matches
    .map((raw) => Number.parseFloat(raw.replace(/,/g, "")))
    .filter((value) => Number.isFinite(value));
}

function extractExpectedYear(query: string) {
  const yearMatch = query.match(/\b(20\d{2})\b/);
  if (!yearMatch) {
    return null;
  }
  const year = Number.parseInt(yearMatch[1], 10);
  return Number.isFinite(year) ? year : null;
}

function extractYears(text: string) {
  const matches = text.match(/\b(19|20)\d{2}\b/g) ?? [];
  return matches
    .map((raw) => Number.parseInt(raw, 10))
    .filter((value) => Number.isFinite(value));
}

function validateWinnerAnswer(answer: string) {
  const hasWinnerCue = /\b(won|winner|was)\b/i.test(answer);
  const hasNameLikeEntity = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/.test(answer);
  return hasWinnerCue || hasNameLikeEntity;
}

function validatePriceUnits(answer: string, query: string) {
  if (!PRICE_UNIT_PATTERN.test(answer)) {
    return false;
  }

  const packMatch = query.match(/\b(\d+)\s*[- ]?(?:pack|count|ct)\b/i);
  if (!packMatch) {
    return true;
  }

  const packSize = packMatch[1];
  const packPattern = new RegExp(`\\b${packSize}\\s*[- ]?(?:pack|count|ct)\\b`, "i");
  return packPattern.test(answer) || /\bfor\s+\$/.test(answer);
}

function isSuspiciousNationalTotal(answer: string, query: string, queryType: QuickFactQueryType) {
  if (!queryDemandsNumericTotal(query, queryType) || !queryDemandsNationalSales(query)) {
    return false;
  }

  const values = extractNumericValues(answer);
  const primaryValue = values[0];
  if (typeof primaryValue !== "number") {
    return true;
  }

  if (primaryValue > 0 && primaryValue < 2000) {
    return true;
  }

  if (PARTIAL_SCOPE_PATTERNS.some((pattern) => pattern.test(answer))) {
    return true;
  }

  return false;
}

export function validateQuickFactAnswer(
  answer: string,
  query: string,
  queryType: QuickFactQueryType
): QuickFactAnswerValidation {
  const cleaned = stripNoisePhrases(answer).trim();
  if (!cleaned) {
    return { acceptable: false, reasons: ["empty_answer"] };
  }

  const reasons: string[] = [];
  if (isLikelyBylineOrNavigation(cleaned)) {
    reasons.push("navigation_or_byline");
  }

  if (queryDemandsNumericTotal(query, queryType) && extractNumericValues(cleaned).length === 0) {
    reasons.push("missing_numeric_value");
  }

  if (queryDemandsNationalSales(query) && !NATIONAL_SCOPE_PATTERN.test(cleaned)) {
    reasons.push("missing_national_scope");
  }

  if (isSuspiciousNationalTotal(cleaned, query, queryType)) {
    reasons.push("implausible_national_total");
  }

  if (queryDemandsPrice(query) && !validatePriceUnits(cleaned, query)) {
    reasons.push("missing_price_units");
  }

  if (queryDemandsRateOrStat(query) && !RATE_UNIT_PATTERN.test(cleaned)) {
    reasons.push("missing_stat_units");
  }

  const expectedYear = extractExpectedYear(query);
  const requiresExplicitTimeContext = isTimeSensitiveQuery(query) && !queryDemandsPrice(query);
  if (requiresExplicitTimeContext) {
    if (!DATE_OR_SEASON_PATTERN.test(cleaned)) {
      reasons.push("missing_time_context");
    }
    if (expectedYear !== null && !new RegExp(`\\b${expectedYear}\\b`).test(cleaned)) {
      reasons.push("missing_expected_year");
    }
  }

  if (/\b(most recent|latest|current)\b/i.test(query) && !queryDemandsPrice(query)) {
    const years = extractYears(cleaned);
    if (years.length > 0) {
      const freshestYear = Math.max(...years);
      if (freshestYear < new Date().getFullYear() - 2) {
        reasons.push("stale_time_context");
      }
    }
  }

  if (queryDemandsWinner(query) && !validateWinnerAnswer(cleaned)) {
    reasons.push("missing_winner_identity");
  }

  const blockingReasons = new Set([
    "empty_answer",
    "navigation_or_byline",
    "missing_numeric_value",
    "missing_national_scope",
    "implausible_national_total",
    "missing_price_units",
    "missing_stat_units",
    "missing_time_context",
    "missing_expected_year",
    "stale_time_context",
    "missing_winner_identity"
  ]);

  return {
    acceptable: !reasons.some((reason) => blockingReasons.has(reason)),
    reasons
  };
}

function isQueryAnswerLike(sentence: string, query: string) {
  const normalized = sentence.toLowerCase();

  if (queryDemandsWinner(query)) {
    return /\b(winner|won|was)\b/.test(normalized);
  }

  if (queryDemandsPrice(query)) {
    return /\$|\busd\b|\bprice\b|\bcost\b|\bfor\b/.test(normalized);
  }

  if (queryDemandsRateOrStat(query)) {
    return /%|\bpercent\b|\brate\b|\bsurvey\b|\breport(?:ed|s)?\b|\bstudy\b/.test(normalized);
  }

  return hasFactLikeAnswer(sentence);
}

function formatQueryAwareAnswer(
  queryType: QuickFactQueryType,
  _query: string,
  text: string
) {
  const sentences = splitSentences(text);

  if (queryType === "product") {
    return toCompactAnswer(sentences[0] ?? text);
  }

  return toCompactAnswer(sentences.slice(0, 2).join(" "));
}

function normalizeQuickFactAnswer(
  raw: string,
  query: string,
  queryType: QuickFactQueryType
) {
  const cleaned = stripNoisePhrases(raw);
  if (!cleaned) {
    return "";
  }

  const keywords = extractQueryKeywords(query);
  const factSentences = splitSentences(cleaned).filter(
    (sentence) =>
      !isLikelyBylineOrNavigation(sentence) &&
      !QUICKFACT_NOISE_PATTERNS.some((pattern) => pattern.test(sentence)) &&
      (isQueryAnswerLike(sentence, query) ||
        queryType === "product" ||
        queryType === "role_or_name" ||
        queryType === "general_fact") &&
      (keywords.length === 0 || countKeywordHits(sentence, keywords) > 0)
  );

  const candidate = factSentences.slice(0, 2).join(" ").trim();
  if (!candidate) {
    return "";
  }

  const normalizedAnswer = formatQueryAwareAnswer(queryType, query, candidate).trim();
  if (!normalizedAnswer) {
    return "";
  }

  const validation = validateQuickFactAnswer(normalizedAnswer, query, queryType);
  if (!validation.acceptable) {
    return "";
  }

  return normalizedAnswer;
}

function scoreSource(result: TavilySearchResult) {
  const domain = extractDomain(result.url ?? "");
  if (!domain || isExcludedDomain(domain) || looksLikeWeakResult(result)) {
    return -1;
  }

  const highTrustBoost = isHighTrustDomain(domain) ? 0.45 : 0;
  const reputableBoost = !highTrustBoost && isReputableDomain(domain) ? 0.22 : 0;
  return (result.score ?? 0) + highTrustBoost + reputableBoost;
}

function scoreResultRelevance(
  result: TavilySearchResult,
  query: string,
  queryType: QuickFactQueryType
) {
  const title = (result.title ?? "").trim();
  const snippet = (result.content ?? "").trim();
  const combined = `${title} ${snippet}`.trim();
  if (!combined) {
    return -1;
  }

  const keywords = extractQueryKeywords(query);
  const keywordHits = countKeywordHits(combined, keywords);
  const keywordScore =
    keywords.length === 0 ? 0.2 : Math.min(1, keywordHits / Math.max(1, Math.min(keywords.length, 3)));

  const directAnswerBoost = isQueryAnswerLike(snippet, query) ? 0.4 : 0;
  const temporalScore = scoreTemporalRelevance(result, query);
  const bylinePenalty = isLikelyBylineOrNavigation(snippet) ? 0.6 : 0;
  const weakSnippetPenalty =
    snippet.length > 0 && !hasFactLikeAnswer(snippet) && queryType !== "general_fact" ? 0.2 : 0;
  const snippetValidation = validateQuickFactAnswer(snippet, query, queryType);
  const validationPenalty = snippetValidation.reasons.reduce((total, reason) => {
    switch (reason) {
      case "implausible_national_total":
      case "missing_expected_year":
      case "stale_time_context":
      case "missing_winner_identity":
        return total + 0.9;
      case "missing_price_units":
      case "missing_stat_units":
      case "missing_national_scope":
      case "missing_time_context":
      case "missing_numeric_value":
        return total + 0.45;
      case "navigation_or_byline":
        return total + 0.7;
      default:
        return total + 0.2;
    }
  }, 0);

  return keywordScore + directAnswerBoost + temporalScore - bylinePenalty - weakSnippetPenalty - validationPenalty;
}

function scoreTemporalRelevance(result: TavilySearchResult, query: string) {
  if (!isTimeSensitiveQuery(query)) {
    return 0;
  }

  const joined = `${result.title ?? ""} ${result.content ?? ""} ${result.published_date ?? result.publishedDate ?? ""}`;
  const years = extractYears(joined);
  const expectedYear = extractExpectedYear(query);

  if (expectedYear !== null) {
    if (years.includes(expectedYear)) {
      return 0.55;
    }
    if (years.length > 0) {
      return -0.45;
    }
    return -0.2;
  }

  if (years.length === 0) {
    return -0.15;
  }

  const freshestYear = Math.max(...years);
  const age = new Date().getFullYear() - freshestYear;
  if (age <= 1) {
    return 0.45;
  }
  if (age <= 2) {
    return 0.25;
  }
  if (age <= 4) {
    return 0;
  }
  return -0.45;
}

function inferConfidence(result: TavilySearchResult): QuickFactConfidence {
  const domain = extractDomain(result.url ?? "");
  if (isHighTrustDomain(domain)) {
    return "high";
  }

  if (isReputableDomain(domain) || (result.score ?? 0) >= 0.72) {
    return "high";
  }

  if ((result.score ?? 0) >= 0.45) {
    return "medium";
  }

  return "low";
}

function normalizeResult(
  result: TavilySearchResult,
  query: string,
  queryType: QuickFactQueryType,
  fallbackAnswer?: string
): QuickFactResult | null {
  const sourceUrl = result.url?.trim() ?? "";
  if (!sourceUrl) {
    return null;
  }

  const domain = extractDomain(sourceUrl);
  if (!domain || isExcludedDomain(domain) || looksLikeWeakResult(result)) {
    return null;
  }

  const answer = normalizeQuickFactAnswer(result.content || fallbackAnswer || "", query, queryType);
  if (!answer || !hasFactLikeAnswer(answer)) {
    return null;
  }

  const validation = validateQuickFactAnswer(answer, query, queryType);
  if (!validation.acceptable) {
    return null;
  }

  return {
    answer,
    sourceName: extractSourceName(result),
    sourceUrl,
    sourceDate: result.published_date || result.publishedDate || undefined,
    confidence: inferConfidence(result)
  };
}

export function buildQuickFactFallback(reason: QuickFactFallback["reason"]): QuickFactFallback {
  switch (reason) {
    case "too_broad":
      return {
        reason,
        message: "This looks better suited for a broader search.",
        actionLabel: "Search more broadly"
      };
    case "backend_error":
    case "timeout":
    case "no_clean_fact":
    default:
      return {
        reason,
        message: "I couldn't find a clean quick fact for that.",
        actionLabel: "Search more broadly"
      };
  }
}

async function runTavilySearch(query: string, queryType: QuickFactQueryType, fallbackPass = false) {
  const apiKey = await getCurrentOwnerTavilyApiKey();
  const requiresDeeperRetrieval =
    fallbackPass ||
    isTimeSensitiveQuery(query) ||
    queryType === "market_fact" ||
    queryType === "product" ||
    queryDemandsNumericTotal(query, queryType);
  const maxResults = fallbackPass ? 7 : requiresDeeperRetrieval ? 6 : QUICKFACT_MAX_RESULTS;
  const searchDepth = requiresDeeperRetrieval ? "advanced" : "basic";

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), QUICKFACT_TAVILY_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        query,
        topic: "general",
        search_depth: searchDepth,
        max_results: maxResults,
        include_answer: "basic",
        include_raw_content: false,
        include_images: false,
        exclude_domains: QUICKFACT_EXCLUDED_DOMAINS
      }),
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error("QuickFact provider request failed.");
    }

    return (await response.json().catch(() => null)) as TavilySearchResponse | null;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function rankResults(
  payload: TavilySearchResponse | null,
  query: string,
  queryType: QuickFactQueryType
) {
  return (payload?.results ?? [])
    .filter((result) => {
      const domain = extractDomain(result.url ?? "");
      return Boolean(result.url) && Boolean(domain) && !isExcludedDomain(domain);
    })
    .sort((left, right) => {
      const rightScore = scoreSource(right) + scoreResultRelevance(right, query, queryType);
      const leftScore = scoreSource(left) + scoreResultRelevance(left, query, queryType);
      return rightScore - leftScore;
    });
}

function dedupeRawResults(results: TavilySearchResult[]) {
  const seen = new Set<string>();
  const deduped: TavilySearchResult[] = [];

  results.forEach((result) => {
    const key = `${result.url ?? ""}|${(result.content ?? "").slice(0, 220)}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    deduped.push(result);
  });

  return deduped;
}

function chooseBestSource(results: TavilySearchResult[]) {
  return results.find((result) => scoreSource(result) >= 0) ?? null;
}

function determineRetrievalQuality(bundle: {
  rawResults: TavilySearchResult[];
  cleanResults: QuickFactResult[];
  answer: string | null;
}): QuickFactRetrievalQuality {
  const hasAnswerEvidence = Boolean(bundle.answer?.trim());

  if (bundle.rawResults.length === 0 && !hasAnswerEvidence) {
    return "empty";
  }

  if (bundle.cleanResults.length === 0) {
    return hasAnswerEvidence ? "weak" : "empty";
  }

  const topClean = bundle.cleanResults[0];
  const topRaw = bundle.rawResults[0];
  const strongAnswer = Boolean(bundle.answer?.trim()) || topClean.answer.length <= 140;
  const strongSource = topRaw ? scoreSource(topRaw) >= 0.7 && inferConfidence(topRaw) === "high" : false;

  if (strongAnswer && strongSource && topClean.confidence === "high") {
    return "strong";
  }

  return "mixed";
}

function extractFactsFromPayload(
  payload: TavilySearchResponse | null,
  query: string,
  queryType: QuickFactQueryType
) {
  const rankedResults = rankResults(payload, query, queryType);

  const facts: QuickFactResult[] = [];
  for (const result of rankedResults) {
    if (scoreSource(result) < 0) {
      continue;
    }

    const normalized = normalizeResult(result, query, queryType, payload?.answer);
    if (!normalized) {
      continue;
    }

    if (queryType === "count" && normalized.confidence === "low") {
      continue;
    }

    facts.push(normalized);
    if (facts.length >= QUICKFACT_RESULT_LIMIT) {
      break;
    }
  }

  return facts;
}

function toCleanAnswerFallback(
  cleanResults: QuickFactResult[],
  _queryType: QuickFactQueryType,
  _query: string
) {
  const first = cleanResults[0];
  if (!first) {
    return "";
  }

  return first.answer;
}

function buildRetrievalQueries(normalizedQuery: string, queryType: QuickFactQueryType) {
  const queries: string[] = [];
  const pushQuery = (value: string) => {
    const compact = value.replace(/\s+/g, " ").trim();
    if (!compact) {
      return;
    }
    if (!queries.some((existing) => existing.toLowerCase() === compact.toLowerCase())) {
      queries.push(compact);
    }
  };

  pushQuery(normalizedQuery);

  if (queryDemandsNationalSales(normalizedQuery)) {
    pushQuery(`${normalizedQuery} official U.S. annual total sales`);
  } else if (queryDemandsNumericTotal(normalizedQuery, queryType)) {
    pushQuery(`${normalizedQuery} official total`);
  }

  if (queryDemandsWinner(normalizedQuery)) {
    pushQuery(`${normalizedQuery} official winner`);
  }

  if (queryDemandsPrice(normalizedQuery)) {
    pushQuery(`${normalizedQuery} USD price`);
  }

  if (queryDemandsRateOrStat(normalizedQuery)) {
    pushQuery(`${normalizedQuery} survey percentage`);
  }

  return queries.slice(0, 2);
}

function shouldRunSecondPass(params: {
  normalizedQuery: string;
  queryType: QuickFactQueryType;
  cleanResults: QuickFactResult[];
  retrievalQuality: QuickFactRetrievalQuality;
  hasSecondQuery: boolean;
}) {
  if (!params.hasSecondQuery) {
    return false;
  }

  if (params.cleanResults.length === 0 || params.retrievalQuality === "weak" || params.retrievalQuality === "empty") {
    return true;
  }

  if (params.retrievalQuality === "strong") {
    return false;
  }

  return (
    queryDemandsNumericTotal(params.normalizedQuery, params.queryType) ||
    queryDemandsWinner(params.normalizedQuery) ||
    queryDemandsPrice(params.normalizedQuery) ||
    queryDemandsRateOrStat(params.normalizedQuery) ||
    isTimeSensitiveQuery(params.normalizedQuery)
  );
}

function combinePayloads(payloads: Array<TavilySearchResponse | null>) {
  const answers = payloads
    .map((payload) => payload?.answer?.trim() ?? "")
    .filter((value) => Boolean(value));
  const results = dedupeRawResults(
    payloads.flatMap((payload) => payload?.results ?? [])
  );

  return {
    answer: answers[0] || undefined,
    results
  } satisfies TavilySearchResponse;
}

export function evaluateQuickFactStressCase(input: QuickFactTestEvaluationInput): QuickFactStressEvaluation {
  const normalizedQuery = normalizeQuickFactQuery(input.query);
  const query = normalizedQuery || input.query.trim();
  const queryType = classifyQuickFactQuery(query);
  const payload: TavilySearchResponse = {
    answer: input.answer ?? undefined,
    results: input.results
  };
  const rankedResults = rankResults(payload, query, queryType);
  const cleanResults = extractFactsFromPayload(payload, query, queryType);
  const answer = toCleanAnswerFallback(cleanResults, queryType, query) || payload.answer?.trim() || null;
  const retrievalQuality = determineRetrievalQuality({
    rawResults: rankedResults,
    cleanResults,
    answer
  });

  const candidates = rankedResults.slice(0, 5).map((result) => {
    const normalizedAnswer = normalizeQuickFactAnswer(result.content || payload.answer || "", query, queryType);
    const validation = validateQuickFactAnswer(
      normalizedAnswer || result.content || "",
      query,
      queryType
    );

    return {
      title: result.title?.trim() ?? "",
      url: result.url?.trim() ?? "",
      sourceScore: scoreSource(result),
      relevanceScore: scoreResultRelevance(result, query, queryType),
      normalizedAnswer,
      accepted: validation.acceptable,
      reasons: validation.reasons
    };
  });

  return {
    normalizedQuery,
    queryType,
    retrievalQuality,
    cleanResults,
    candidates
  };
}

export async function fetchTavilyQuickFactBundle(query: string): Promise<TavilyQuickFactBundle> {
  const normalizedQuery = normalizeQuickFactQuery(query);
  if (!normalizedQuery || looksTooBroadForQuickFact(normalizedQuery)) {
    return {
      query,
      normalizedQuery,
      queryType: classifyQuickFactQuery(normalizedQuery || query),
      answer: null,
      rawResults: [],
      cleanResults: [],
      bestSource: null,
      retrievalQuality: "empty",
      fallback: buildQuickFactFallback("too_broad")
    };
  }

  const queryType = classifyQuickFactQuery(normalizedQuery);
  const retrievalQueries = buildRetrievalQueries(normalizedQuery, queryType);
  const firstPayload = await runTavilySearch(retrievalQueries[0], queryType, false);
  let combinedPayload = combinePayloads([firstPayload]);
  let rawResults = rankResults(combinedPayload, normalizedQuery, queryType);
  let cleanResults = extractFactsFromPayload(combinedPayload, normalizedQuery, queryType);
  let answer = toCleanAnswerFallback(cleanResults, queryType, normalizedQuery) || combinedPayload.answer?.trim() || null;
  let retrievalQuality = determineRetrievalQuality({
    rawResults,
    cleanResults,
    answer
  });

  if (
    shouldRunSecondPass({
      normalizedQuery,
      queryType,
      cleanResults,
      retrievalQuality,
      hasSecondQuery: retrievalQueries.length > 1
    })
  ) {
    const secondPayload = await runTavilySearch(retrievalQueries[1], queryType, true);
    combinedPayload = combinePayloads([firstPayload, secondPayload]);
    rawResults = rankResults(combinedPayload, normalizedQuery, queryType);
    cleanResults = extractFactsFromPayload(combinedPayload, normalizedQuery, queryType);
    answer = toCleanAnswerFallback(cleanResults, queryType, normalizedQuery) || combinedPayload.answer?.trim() || null;
    retrievalQuality = determineRetrievalQuality({
      rawResults,
      cleanResults,
      answer
    });
  }

  const bestSource = chooseBestSource(rawResults);

  if (cleanResults.length === 0) {
    return {
      query,
      normalizedQuery,
      queryType,
      answer,
      rawResults,
      cleanResults,
      bestSource,
      retrievalQuality,
      fallback: buildQuickFactFallback("no_clean_fact")
    };
  }

  return {
    query,
    normalizedQuery,
    queryType,
    answer,
    rawResults,
    cleanResults,
    bestSource,
    retrievalQuality
  };
}
