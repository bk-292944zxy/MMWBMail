/**
 * MaxiMail — Spoof & Unverified Sender Detection Test Suite
 * Run with: npx ts-node scripts/test-spoof-detection.ts
 *
 * Tests detectSpoof and detectUnverifiedSender logic against
 * real-world cases including known failures from production.
 */

import {
  BRAND_DOMAINS,
  detectSpoof,
  detectUnverifiedSender,
  ESP_DOMAINS,
  isEspDomain,
  matchesBrand
} from "../lib/sender-verification";

// ─── Minimal message shape ──────────────────────────────────────────────────

interface TestMsg {
  from: string;
  fromAddress: string;
  authResultsDmarc?: "pass" | "fail" | "none";
  authResultsSpf?: "pass" | "fail" | "none";
}

// ─── Test runner ────────────────────────────────────────────────────────────

type Tier = "SPOOF" | "UNVERIFIED" | "CLEAN";

interface TestCase {
  label: string;
  msg: TestMsg;
  expect: Tier;
  note?: string;
}

const CASES: TestCase[] = [
  // ── SHOULD FIRE: hard spoof ───────────────────────────────────────────────
  {
    label: "PayPal from phishing domain",
    msg: { from: "PayPal Security", fromAddress: "security@paypa1-alert.com" },
    expect: "SPOOF",
  },
  {
    label: "Apple from random domain",
    msg: { from: "Apple ID", fromAddress: "noreply@apple-idverify.net" },
    expect: "SPOOF",
  },
  {
    label: "Chase from non-Chase domain",
    msg: { from: "Chase Bank", fromAddress: "alert@chase-secure.info" },
    expect: "SPOOF",
  },
  {
    label: "IRS impersonation",
    msg: { from: "IRS Tax Refund", fromAddress: "refund@irs-gov-refund.com" },
    expect: "SPOOF",
  },
  {
    label: "USPS package scam",
    msg: { from: "USPS Delivery", fromAddress: "delivery@usps-parcel.xyz" },
    expect: "SPOOF",
  },
  {
    label: "Microsoft from unrelated domain + DMARC fail",
    msg: {
      from: "Microsoft Account Team",
      fromAddress: "noreply@microsoftsupport.online",
      authResultsDmarc: "fail",
    },
    expect: "SPOOF",
  },
  {
    label: "Netflix from suspicious domain",
    msg: { from: "Netflix Support", fromAddress: "billing@netfIix-billing.com" },
    expect: "SPOOF",
  },
  {
    label: "Amazon from non-Amazon domain",
    msg: { from: "Amazon Order", fromAddress: "order@amazon-customer.net" },
    expect: "SPOOF",
  },

  // ── SHOULD FIRE: unverified (real-world production failures) ──────────────
  {
    label: "Blue Cross BlueShield from auditprint.com [PRODUCTION FAILURE]",
    msg: { from: "Blue Cross BlueShield", fromAddress: "bluecrossblueshield@auditprint.com" },
    expect: "UNVERIFIED",
    note: "Real email seen in production — was not flagged before this fix",
  },
  {
    label: "Lowes from readyviews.com [PRODUCTION FAILURE]",
    msg: { from: "Lowes EGO Select", fromAddress: "lowesegoselect@readyviews.com" },
    expect: "UNVERIFIED",
    note: "Real email seen in production — unknown domain, should flag unverified",
  },
  {
    label: "State Farm from unknown domain",
    msg: { from: "State Farm Insurance", fromAddress: "alerts@statefarm-notice.co" },
    expect: "UNVERIFIED",
    note: "Passes brand check but not hard spoof — should be unverified",
  },
  {
    label: "Capital One with SPF fail",
    msg: {
      from: "Capital One Alerts",
      fromAddress: "alerts@capitalone-offers.net",
      authResultsSpf: "fail",
    },
    expect: "UNVERIFIED",
  },

  // ── SHOULD BE CLEAN: legitimate senders ──────────────────────────────────
  {
    label: "Chase from chase.com",
    msg: { from: "Chase Bank", fromAddress: "alerts@chase.com" },
    expect: "CLEAN",
  },
  {
    label: "Apple from appleid.apple.com",
    msg: { from: "Apple", fromAddress: "no_reply@email.apple.com" },
    expect: "CLEAN",
  },
  {
    label: "LinkedIn from e.linkedin.com",
    msg: { from: "LinkedIn", fromAddress: "jobs@e.linkedin.com" },
    expect: "CLEAN",
  },
  {
    label: "PayPal from paypal.com",
    msg: { from: "PayPal", fromAddress: "service@paypal.com" },
    expect: "CLEAN",
  },
  {
    label: "Google from gmail.com",
    msg: { from: "Google", fromAddress: "no-reply@accounts.google.com" },
    expect: "CLEAN",
  },

  // ── SHOULD BE CLEAN: legitimate ESP senders ───────────────────────────────
  {
    label: "Retailer using Mailchimp",
    msg: { from: "Lowes Home Improvement", fromAddress: "offers@lowes.mandrillapp.com" },
    expect: "CLEAN",
    note: "Known retailer through verified ESP — should not flag",
  },
  {
    label: "Newsletter via Beehiiv",
    msg: { from: "Morning Brew", fromAddress: "newsletter@morningbrew.beehiiv.com" },
    expect: "CLEAN",
    note: "Non-brand sender through verified ESP",
  },
  {
    label: "Brand via SendGrid",
    msg: { from: "Adobe Creative Cloud", fromAddress: "mail@adobe.sendgrid.net" },
    expect: "CLEAN",
    note: "Adobe sending via SendGrid — should pass",
  },
  {
    label: "Substack newsletter",
    msg: { from: "Techpresso Daily", fromAddress: "newsletter@techpresso.substack.com" },
    expect: "CLEAN",
    note: "Non-brand sender on known ESP",
  },

  // ── EDGE CASES ─────────────────────────────────────────────────────────────
  {
    label: "No display name — plain email address",
    msg: { from: "john@gmail.com", fromAddress: "john@gmail.com" },
    expect: "CLEAN",
    note: "No brand keyword — should pass",
  },
  {
    label: "Partial brand word — 'Chasing Waterfalls'",
    msg: { from: "Chasing Waterfalls Blog", fromAddress: "hello@chasingwaterfalls.com" },
    expect: "CLEAN",
    note: "Should NOT match 'chase' brand — word boundary check",
  },
  {
    label: "Amex subdomain",
    msg: { from: "American Express", fromAddress: "americanexpress@welcome.aexp.com" },
    expect: "CLEAN",
    note: "aexp.com is in the Amex whitelist",
  },
  {
    label: "FedEx from fedex.com subdomain",
    msg: { from: "FedEx Delivery", fromAddress: "tracking@fedex.com" },
    expect: "CLEAN",
  },
  {
    label: "DHL from unknown reseller domain",
    msg: { from: "DHL Express", fromAddress: "shipping@dhl-express-parcel.com" },
    expect: "SPOOF",
  },
];

// ─── Run and report ─────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function getTier(msg: TestMsg): Tier {
  if (detectSpoof(msg).isSpoofed) return "SPOOF";
  if (detectUnverifiedSender(msg).isUnverified) return "UNVERIFIED";
  return "CLEAN";
}

function tierColor(tier: Tier) {
  if (tier === "SPOOF") return RED;
  if (tier === "UNVERIFIED") return YELLOW;
  return GREEN;
}

function tierLabel(tier: Tier) {
  if (tier === "SPOOF") return "🔴 SPOOF     ";
  if (tier === "UNVERIFIED") return "🟡 UNVERIFIED";
  return "🟢 CLEAN     ";
}

console.log(`\n${BOLD}${CYAN}MaxiMail — Sender Fraud Detection Test Suite${RESET}`);
console.log(`${DIM}${"─".repeat(80)}${RESET}\n`);

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const tc of CASES) {
  const actual = getTier(tc.msg);
  const ok = actual === tc.expect;
  const icon = ok ? "✓" : "✗";
  const color = ok ? GREEN : RED;

  if (ok) {
    passed++;
    const detail = actual === "SPOOF"
      ? `  ${DIM}→ ${detectSpoof(tc.msg).reason}${RESET}`
      : actual === "UNVERIFIED"
      ? `  ${DIM}→ signals: ${detectUnverifiedSender(tc.msg).signals.join(", ")}${RESET}`
      : "";
    console.log(`${color}${icon}${RESET} ${tierLabel(actual)}  ${tc.label}${detail}`);
  } else {
    failed++;
    failures.push(tc.label);
    console.log(
      `${color}${icon}${RESET} ${tierLabel(actual)}  ${BOLD}${tc.label}${RESET}`
    );
    console.log(
      `  ${RED}Expected: ${tc.expect}  Got: ${actual}${RESET}`
    );
    if (actual === "SPOOF") {
      console.log(`  ${DIM}Spoof reason: ${detectSpoof(tc.msg).reason}${RESET}`);
    } else if (actual === "UNVERIFIED") {
      console.log(`  ${DIM}Signals: ${detectUnverifiedSender(tc.msg).signals.join(", ")}${RESET}`);
    }
  }

  if (tc.note) console.log(`  ${DIM}Note: ${tc.note}${RESET}`);
}

// ─── Brand dictionary coverage report ──────────────────────────────────────

console.log(`\n${BOLD}${CYAN}Brand Dictionary Coverage${RESET}`);
console.log(`${DIM}${"─".repeat(80)}${RESET}`);
const brands = Object.keys(BRAND_DOMAINS);
console.log(`  Total brands: ${brands.length}`);
const totalDomains = Object.values(BRAND_DOMAINS).reduce((n, d) => n + d.length, 0);
console.log(`  Total whitelisted domains: ${totalDomains}`);
console.log(`  Total ESP domains whitelisted: ${ESP_DOMAINS.length}`);

// ─── ESP domain spot checks ─────────────────────────────────────────────────

console.log(`\n${BOLD}${CYAN}ESP Domain Detection Spot Checks${RESET}`);
console.log(`${DIM}${"─".repeat(80)}${RESET}`);
const espChecks = [
  ["mandrillapp.com", true],
  ["sendgrid.net", true],
  ["beehiiv.com", true],
  ["substack.com", true],
  ["mail.beehiiv.com", true],
  ["auditprint.com", false],
  ["readyviews.com", false],
  ["paypa1-alert.com", false],
  ["chase-secure.info", false],
] as [string, boolean][];

for (const [domain, expected] of espChecks) {
  const actual = isEspDomain(domain);
  const ok = actual === expected;
  const icon = ok ? "✓" : "✗";
  const color = ok ? GREEN : RED;
  console.log(`${color}${icon}${RESET} isEspDomain("${domain}") → ${actual} ${ok ? "" : `${RED}(expected ${expected})${RESET}`}`);
}

// ─── matchesBrand spot checks ───────────────────────────────────────────────

console.log(`\n${BOLD}${CYAN}matchesBrand Spot Checks${RESET}`);
console.log(`${DIM}${"─".repeat(80)}${RESET}`);
const brandChecks = [
  ["PayPal Security", "paypal"],
  ["Blue Cross BlueShield", "blue cross"],
  ["Lowes EGO Select", "lowes"],
  ["Chasing Waterfalls Blog", null],  // should NOT match "chase"
  ["American Express Offers", "american express"],
  ["IRS Tax Services", "irs"],
  ["State Farm Insurance", "state farm"],
  ["Some Random Sender", null],
  ["DHL Express Delivery", "dhl"],
  ["Capital One Rewards", "capital one"],
] as [string, string | null][];

for (const [name, expected] of brandChecks) {
  const actual = matchesBrand(name);
  const ok = actual === expected;
  const icon = ok ? "✓" : "✗";
  const color = ok ? GREEN : RED;
  console.log(
    `${color}${icon}${RESET} matchesBrand("${name}") → ${actual ?? "null"} ${ok ? "" : `${RED}(expected ${expected ?? "null"})${RESET}`}`
  );
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${BOLD}${"─".repeat(80)}${RESET}`);
const total = CASES.length;
const pct = Math.round((passed / total) * 100);
const summaryColor = failed === 0 ? GREEN : RED;
console.log(
  `${summaryColor}${BOLD}Results: ${passed}/${total} passed (${pct}%)${RESET}`
);

if (failures.length) {
  console.log(`\n${RED}${BOLD}Failed cases:${RESET}`);
  failures.forEach((f) => console.log(`  ${RED}• ${f}${RESET}`));
}

console.log("");
process.exit(failed > 0 ? 1 : 0);
