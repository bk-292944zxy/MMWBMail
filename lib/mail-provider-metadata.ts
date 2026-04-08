import type {
  MailAccountProviderInfo,
  MailConnectionPayload,
  MailProviderKind,
  ProviderCapabilities
} from "@/lib/mail-types";

const GMAIL_CAPABILITIES: ProviderCapabilities = {
  supportsServerSideThreads: true,
  supportsLabels: true,
  supportsServerSideSearch: true,
  supportsPushSync: true,
  supportsProviderOAuth: true,
  usesSmtpSend: true
};

const GENERIC_IMAP_SMTP_CAPABILITIES: ProviderCapabilities = {
  supportsServerSideThreads: false,
  supportsLabels: false,
  supportsServerSideSearch: false,
  supportsPushSync: false,
  supportsProviderOAuth: false,
  usesSmtpSend: true
};

type ProviderIdentityInput = Pick<
  MailConnectionPayload,
  "email" | "imapHost" | "smtpHost"
>;

export function inferMailProviderKind(input: ProviderIdentityInput): MailProviderKind {
  const emailDomain = input.email.split("@")[1]?.toLowerCase() ?? "";
  const imapHost = input.imapHost.toLowerCase();
  const smtpHost = input.smtpHost.toLowerCase();

  if (
    emailDomain === "gmail.com" ||
    emailDomain === "googlemail.com" ||
    imapHost.includes("gmail") ||
    smtpHost.includes("gmail")
  ) {
    return "gmail";
  }

  return "imap-smtp";
}

export function getProviderCapabilities(kind: MailProviderKind): ProviderCapabilities {
  return kind === "gmail" ? GMAIL_CAPABILITIES : GENERIC_IMAP_SMTP_CAPABILITIES;
}

export function getMailAccountProviderInfo(
  input: ProviderIdentityInput
): MailAccountProviderInfo {
  const kind = inferMailProviderKind(input);

  return {
    kind,
    label: kind === "gmail" ? "Gmail" : "IMAP + SMTP",
    capabilities: getProviderCapabilities(kind)
  };
}
