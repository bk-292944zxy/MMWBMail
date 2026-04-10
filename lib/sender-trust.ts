export type SenderTrustResolution = "trusted" | "verified" | "unverified" | "unknown";

export const TRUSTED_DOMAIN_ROOTS = [
  "linkedin.com",
  "github.com",
  "google.com",
  "apple.com",
  "amazon.com",
  "microsoft.com",
  "stripe.com",
  "slack.com",
  "dropbox.com",
  "zoom.us",
  "docusign.net",
  "paypal.com",
  "intuit.com",
  "indeed.com",
  "atlassian.com"
] as const;

export function normalizeDomain(domain?: string | null) {
  return (domain ?? "").trim().toLowerCase().replace(/^@+/, "").replace(/\.$/, "");
}

export function isTrustedDomain(domain: string) {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) {
    return false;
  }

  return TRUSTED_DOMAIN_ROOTS.some(
    (trustedDomainRoot) =>
      normalizedDomain === trustedDomainRoot ||
      normalizedDomain.endsWith(`.${trustedDomainRoot}`)
  );
}

export function resolveSenderTrust(input: {
  fromDomain?: string | null;
  dmarcPass?: boolean;
  dkimPass?: boolean;
  spfPass?: boolean;
}): SenderTrustResolution {
  const domain = normalizeDomain(input.fromDomain);

  if (isTrustedDomain(domain)) {
    return "trusted";
  }

  if (input.dmarcPass || input.dkimPass || input.spfPass) {
    return "verified";
  }

  return "unknown";
}
