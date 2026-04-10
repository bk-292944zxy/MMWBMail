import type { MailDetail, MailSummary } from "./mail-types";

export const ESP_DOMAINS = [
  "mailchimp.com",
  "mandrillapp.com",
  "rsgsv.net",
  "mcsv.net",
  "sendgrid.net",
  "sendgrid.com",
  "amazonses.com",
  "amazonaws.com",
  "mailgun.org",
  "mailgun.net",
  "sparkpostmail.com",
  "sp.sparkpostmail.com",
  "klaviyo.com",
  "klaviyomail.com",
  "constantcontact.com",
  "r.constantcontact.com",
  "campaignmonitor.com",
  "cmail20.com",
  "cmail19.com",
  "hubspot.com",
  "hs-email.com",
  "hubspotemail.net",
  "salesforce.com",
  "exacttarget.com",
  "marketo.net",
  "marketo.com",
  "brevo.com",
  "sendinblue.com",
  "mailerlite.com",
  "mlsend.com",
  "convertkit.com",
  "ck.page",
  "beehiiv.com",
  "substack.com",
  "listrakbi.com",
  "eloqua.com",
  "pardot.com",
  "iterable.com",
  "drip.com",
  "activecampaign.com",
  "postmarkapp.com",
  "mailersend.com",
  "zohomail.com",
  "sailthru.com",
  "responsys.com",
  "emarsys.com",
  "dotdigital.com"
] as const;

export const BRAND_DOMAINS: Record<string, string[]> = {
  paypal: ["paypal.com"],
  apple: ["apple.com", "icloud.com", "appleid.apple.com"],
  google: ["google.com", "gmail.com", "googlemail.com"],
  microsoft: ["microsoft.com", "outlook.com", "hotmail.com", "live.com", "msn.com"],
  amazon: ["amazon.com", "amazonaws.com", "amazon.co.uk", "amazon.ca"],
  netflix: ["netflix.com"],
  chase: ["chase.com", "jpmorgan.com"],
  "bank of america": ["bankofamerica.com"],
  "wells fargo": ["wellsfargo.com"],
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "meta.com", "facebookmail.com"],
  twitter: ["twitter.com", "x.com"],
  linkedin: ["linkedin.com", "e.linkedin.com"],
  verizon: ["verizon.com", "verizonwireless.com"],
  att: ["att.com"],
  irs: ["irs.gov", "irs.treasury.gov"],
  fedex: ["fedex.com"],
  ups: ["ups.com"],
  usps: ["usps.com", "usps.gov"],
  walmart: ["walmart.com"],
  target: ["target.com"],
  bestbuy: ["bestbuy.com"],
  costco: ["costco.com"],
  "home depot": ["homedepot.com"],
  lowes: ["lowes.com"],
  ebay: ["ebay.com"],
  "american express": ["americanexpress.com", "aexp.com"],
  amex: ["americanexpress.com", "aexp.com"],
  citibank: ["citi.com", "citicards.com", "citibank.com"],
  "capital one": ["capitalone.com"],
  discover: ["discover.com", "discovercard.com"],
  "blue cross": ["bcbs.com", "bluecrossblueshield.com", "anthem.com"],
  blueshield: ["bcbs.com", "blueshield.com", "bluecrossblueshield.com"],
  "blue shield": ["bcbs.com", "blueshield.com", "bluecrossblueshield.com"],
  "united health": ["unitedhealthcare.com", "uhc.com"],
  aetna: ["aetna.com"],
  humana: ["humana.com"],
  "state farm": ["statefarm.com"],
  geico: ["geico.com"],
  allstate: ["allstate.com"],
  progressive: ["progressive.com"],
  usaa: ["usaa.com"],
  "social security": ["ssa.gov"],
  medicare: ["medicare.gov", "cms.gov"],
  dropbox: ["dropbox.com"],
  zoom: ["zoom.us", "zoom.com"],
  slack: ["slack.com"],
  adobe: ["adobe.com"],
  docusign: ["docusign.com"],
  intuit: ["intuit.com", "turbotax.com", "quickbooks.com"],
  turbotax: ["turbotax.com", "intuit.com"],
  coinbase: ["coinbase.com"],
  stripe: ["stripe.com"],
  shopify: ["shopify.com"],
  norton: ["norton.com", "nortonlifelock.com"],
  mcafee: ["mcafee.com"],
  dhl: ["dhl.com"],
  delta: ["delta.com"],
  "united airlines": ["united.com"],
  "american airlines": ["aa.com", "americanairlines.com"],
  southwest: ["southwest.com"],
  marriott: ["marriott.com"],
  hilton: ["hilton.com"],
  expedia: ["expedia.com"],
  airbnb: ["airbnb.com"]
};

const SECOND_LEVEL_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "gov.uk",
  "ac.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.jp",
  "com.br",
  "com.mx"
]);

const ESCAPED_NON_ALNUM = /[^a-z0-9]+/g;
const SUSPICIOUS_TLDS = new Set([
  "xyz",
  "info",
  "online",
  "click",
  "live",
  "top",
  "tk",
  "ml",
  "ga",
  "cf"
]);
const HIGH_RISK_PHISHING_TERMS = [
  "secure",
  "alert",
  "verify",
  "verification",
  "confirm",
  "update",
  "support",
  "billing",
  "account",
  "login",
  "signin",
  "service",
  "refund",
  "parcel",
  "delivery",
  "customer",
  "tax",
  "invoice",
  "payment"
] as const;
const SOFT_BRAND_MISMATCH_TERMS = ["notice", "offers", "team"] as const;

function normalizeHost(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }

  const withoutMailbox = trimmed.includes("@") ? trimmed.split("@").pop() ?? trimmed : trimmed;
  const withoutProtocol = withoutMailbox.replace(/^[a-z]+:\/\//i, "");
  return withoutProtocol.split("/")[0]?.split(":")[0]?.replace(/\.$/, "") ?? "";
}

function normalizeBrandKey(value: string) {
  return value.toLowerCase().replace(ESCAPED_NON_ALNUM, "");
}

function tokenizeBrandableText(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

const BRAND_MATCH_ALIASES: Record<string, string[]> = {
  att: ["att", "at&t", "at and t"]
};

function getBrandMatchAliases(brand: string): string[] {
  return BRAND_MATCH_ALIASES[brand] ?? [brand];
}

function hasTokenPhraseMatch(tokens: string[], phraseTokens: string[]) {
  if (tokens.length === 0 || phraseTokens.length === 0 || phraseTokens.length > tokens.length) {
    return false;
  }

  for (let start = 0; start <= tokens.length - phraseTokens.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < phraseTokens.length; offset += 1) {
      if (tokens[start + offset] !== phraseTokens[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return true;
    }
  }

  return false;
}

function levenshteinDistance(left: string, right: string) {
  if (left === right) {
    return 0;
  }

  if (!left.length) {
    return right.length;
  }

  if (!right.length) {
    return left.length;
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1).fill(0);

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;

    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + cost
      );
    }

    for (let column = 0; column <= right.length; column += 1) {
      previous[column] = current[column];
    }
  }

  return previous[right.length];
}

export function extractSLD(domain: string): string {
  const host = normalizeHost(domain);
  const parts = host.split(".").filter(Boolean);

  if (parts.length === 0) {
    return "";
  }

  if (parts.length === 1) {
    return parts[0];
  }

  const lastTwo = parts.slice(-2).join(".");
  if (SECOND_LEVEL_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts[parts.length - 3];
  }

  if (parts[parts.length - 1] === "gov") {
    return parts[parts.length - 2];
  }

  if (
    parts.length >= 3 &&
    parts[parts.length - 1].length === 2 &&
    ["co", "com", "org", "net", "gov", "ac"].includes(parts[parts.length - 2])
  ) {
    return parts[parts.length - 3];
  }

  return parts[parts.length - 2];
}

export function isEspDomain(domain: string): boolean {
  const host = normalizeHost(domain);
  if (!host) {
    return false;
  }

  const parts = host.split(".").filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    const candidate = parts.slice(index).join(".");
    if ((ESP_DOMAINS as readonly string[]).includes(candidate)) {
      return true;
    }
  }

  return false;
}

export function matchesBrand(displayName: string): string | null {
  const displayTokens = tokenizeBrandableText(displayName);
  if (displayTokens.length === 0) {
    return null;
  }

  const brandKeys = Object.keys(BRAND_DOMAINS).sort((left, right) => right.length - left.length);
  for (const brand of brandKeys) {
    for (const alias of getBrandMatchAliases(brand)) {
      const aliasTokens = tokenizeBrandableText(alias);
      if (hasTokenPhraseMatch(displayTokens, aliasTokens)) {
        return brand;
      }
    }
  }

  return null;
}

export function getKnownDomainsForBrand(brand: string): string[] {
  return BRAND_DOMAINS[brand] ?? [];
}

export function getLegitimateDomainsForBrand(brand: string): string[] {
  return getKnownDomainsForBrand(brand);
}

export function getDomainFromEmail(email: string) {
  const [, domain = ""] = email.trim().toLowerCase().split("@");
  return domain;
}

export function formatBrandName(brand: string) {
  return brand.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function isLegitimateBrandDomain(domain: string, legitimateDomains: string[]) {
  return legitimateDomains.some(
    (legitimateDomain) =>
      domain === legitimateDomain.toLowerCase() ||
      domain.endsWith(`.${legitimateDomain.toLowerCase()}`)
  );
}

export function isClearlyPhishing(
  domain: string,
  brand: string,
  authResultsDmarc?: "pass" | "fail" | "none"
): boolean {
  const host = normalizeHost(domain);
  const sld = extractSLD(host);
  const brandKey = normalizeBrandKey(brand);

  if (!host || !sld || !brandKey) {
    return false;
  }

  if (authResultsDmarc === "fail") {
    return true;
  }

  const tld = host.split(".").filter(Boolean).pop() ?? "";
  const suspiciousTld = SUSPICIOUS_TLDS.has(tld);
  const sldNormalized = normalizeBrandKey(sld);
  const tokens = sld
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const containsBrand = sldNormalized.includes(brandKey);
  const misspellsBrand = tokens.some((token) => {
    if (token.length < Math.max(4, brandKey.length - 2)) {
      return false;
    }

    if (token === brandKey) {
      return false;
    }

    return levenshteinDistance(token, brandKey) <= 2;
  });
  const hasHighRiskTerm = HIGH_RISK_PHISHING_TERMS.some((term) => sldNormalized.includes(term));
  const hasSoftRiskTerm = SOFT_BRAND_MISMATCH_TERMS.some((term) => sldNormalized.includes(term));

  if (misspellsBrand) {
    return true;
  }

  if (suspiciousTld && (containsBrand || hasHighRiskTerm || hasSoftRiskTerm)) {
    return true;
  }

  if (containsBrand && hasHighRiskTerm) {
    return true;
  }

  return false;
}

export function findBrandBySld(domain: string): string | null {
  const sld = normalizeBrandKey(extractSLD(domain));
  if (!sld) {
    return null;
  }

  for (const brand of Object.keys(BRAND_DOMAINS)) {
    if (normalizeBrandKey(brand) === sld) {
      return brand;
    }
  }

  return null;
}

export function detectSpoof(
  msg: Pick<MailSummary, "from" | "fromAddress"> & {
    authResultsDmarc?: string;
  }
): { isSpoofed: boolean; reason: string } {
  if (!msg.fromAddress || !msg.from) {
    return { isSpoofed: false, reason: "" };
  }

  const brand = matchesBrand(msg.from);
  const sendingDomain = getDomainFromEmail(msg.fromAddress);

  if (!brand || !sendingDomain) {
    return { isSpoofed: false, reason: "" };
  }

  if (isEspDomain(sendingDomain)) {
    return { isSpoofed: false, reason: "" };
  }

  const legitimateDomains = getLegitimateDomainsForBrand(brand);
  const legitimate = isLegitimateBrandDomain(sendingDomain, legitimateDomains);

  if (msg.authResultsDmarc === "fail" && !legitimate) {
    return {
      isSpoofed: true,
      reason: `This message failed DMARC authentication — the sending server was not authorized to send on behalf of ${formatBrandName(
        brand
      )}. This is a strong indicator of spoofing.`
    };
  }

  if (
    !legitimate &&
    isClearlyPhishing(
      sendingDomain,
      brand,
      msg.authResultsDmarc as "pass" | "fail" | "none" | undefined
    )
  ) {
    return {
      isSpoofed: true,
      reason: `This message claims to be from ${msg.from.replace(/<.*>/, "").trim()} but was sent from ${msg.fromAddress} — a domain unrelated to ${formatBrandName(
        brand
      )}. This is a common phishing pattern. Do not click any links or provide personal information.`
    };
  }

  return { isSpoofed: false, reason: "" };
}

export function detectUnverifiedSender(
  msg: Pick<MailSummary, "from" | "fromAddress"> & {
    authResultsDmarc?: string;
    authResultsSpf?: string;
  },
  domainVerification?: {
    isEsp?: boolean;
    dmarcPolicy?: string | null;
    trancoRank?: number | null;
  } | null
): { isUnverified: boolean; reason: string; signals: string[] } {
  if (detectSpoof(msg).isSpoofed || !msg.fromAddress || !msg.from) {
    return { isUnverified: false, reason: "", signals: [] };
  }

  const sendingDomain = getDomainFromEmail(msg.fromAddress);
  const brand = matchesBrand(msg.from);
  const signals: string[] = [];

  if (brand && sendingDomain) {
    const legitimateDomains = getLegitimateDomainsForBrand(brand);
    const legitimate = isLegitimateBrandDomain(sendingDomain, legitimateDomains);
    const espDomain = domainVerification?.isEsp ?? isEspDomain(sendingDomain);

    if (!legitimate && !espDomain) {
      signals.push("Display name matches a known brand");
      signals.push("Unrecognized sending domain");
    }
  }

  if (msg.authResultsDmarc === "fail") {
    signals.push("DMARC authentication failed");
  }

  if (msg.authResultsSpf === "fail") {
    signals.push("SPF authentication failed");
  }

  if (
    domainVerification &&
    signals.length > 0 &&
    (domainVerification.dmarcPolicy === "reject" ||
      domainVerification.dmarcPolicy === "quarantine")
  ) {
    signals.push(`DMARC policy: ${domainVerification.dmarcPolicy}`);
  }

  if (domainVerification && signals.length > 0 && domainVerification.trancoRank == null) {
    signals.push("Low-reputation sending domain");
  }

  const uniqueSignals = Array.from(new Set(signals));

  if (uniqueSignals.length === 0) {
    return { isUnverified: false, reason: "", signals: [] };
  }

  if (brand && sendingDomain) {
    return {
      isUnverified: true,
      reason: `This message claims to be from ${formatBrandName(
        brand
      )} but was sent from ${sendingDomain}, which has no verified connection to that organization.`,
      signals: uniqueSignals
    };
  }

  return {
    isUnverified: true,
    reason:
      "This message failed sender verification checks, so the sender identity could not be confirmed.",
    signals: uniqueSignals
  };
}
