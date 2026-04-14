import type {
  MailConnectionPayload,
  MailProviderKind,
  ProviderCapabilities
} from "@/lib/mail-types";

export type PersistedMailAccountProvider =
  | "GMAIL"
  | "ICLOUD"
  | "INMOTION_HOSTED"
  | "GENERIC_IMAP_SMTP";

type ProviderDefaults = {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
};

export type MailProviderProfile = {
  kind: MailProviderKind;
  persisted: PersistedMailAccountProvider;
  label: string;
  capabilities: ProviderCapabilities;
  defaults: ProviderDefaults;
};

type ProviderIdentityInput = {
  provider?: string | null;
  email?: string | null;
  imapHost?: string | null;
  smtpHost?: string | null;
};

const GMAIL_CAPABILITIES: ProviderCapabilities = {
  supportsServerSideThreads: true,
  supportsLabels: true,
  supportsServerSideSearch: true,
  supportsPushSync: true,
  supportsProviderOAuth: true,
  usesSmtpSend: true
};

const IMAP_SMTP_CAPABILITIES: ProviderCapabilities = {
  supportsServerSideThreads: false,
  supportsLabels: false,
  supportsServerSideSearch: false,
  supportsPushSync: false,
  supportsProviderOAuth: false,
  usesSmtpSend: true
};

const PROFILE_BY_KIND: Record<MailProviderKind, MailProviderProfile> = {
  gmail: {
    kind: "gmail",
    persisted: "GMAIL",
    label: "Gmail",
    capabilities: GMAIL_CAPABILITIES,
    defaults: {
      imapHost: "imap.gmail.com",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "smtp.gmail.com",
      smtpPort: 465,
      smtpSecure: true
    }
  },
  icloud: {
    kind: "icloud",
    persisted: "ICLOUD",
    label: "iCloud",
    capabilities: IMAP_SMTP_CAPABILITIES,
    defaults: {
      imapHost: "imap.mail.me.com",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "smtp.mail.me.com",
      smtpPort: 587,
      smtpSecure: false
    }
  },
  "inmotion-hosted": {
    kind: "inmotion-hosted",
    persisted: "INMOTION_HOSTED",
    label: "InMotion-hosted",
    capabilities: IMAP_SMTP_CAPABILITIES,
    defaults: {
      imapHost: "mail.makingmyworldbetter.com",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "mail.makingmyworldbetter.com",
      smtpPort: 465,
      smtpSecure: true
    }
  },
  "generic-imap-smtp": {
    kind: "generic-imap-smtp",
    persisted: "GENERIC_IMAP_SMTP",
    label: "IMAP + SMTP",
    capabilities: IMAP_SMTP_CAPABILITIES,
    defaults: {
      imapHost: "",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "",
      smtpPort: 465,
      smtpSecure: true
    }
  }
};

const PERSISTED_TO_KIND: Record<PersistedMailAccountProvider, MailProviderKind> = {
  GMAIL: "gmail",
  ICLOUD: "icloud",
  INMOTION_HOSTED: "inmotion-hosted",
  GENERIC_IMAP_SMTP: "generic-imap-smtp"
};

function normalizeProviderToken(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized === "imap-smtp" || normalized === "generic") {
    return "generic-imap-smtp";
  }

  if (normalized === "inmotion") {
    return "inmotion-hosted";
  }

  if (normalized === "generic_imap_smtp") {
    return "generic-imap-smtp";
  }

  if (normalized === "inmotion_hosted") {
    return "inmotion-hosted";
  }

  return normalized;
}

function parseExplicitProvider(provider: string | null | undefined): MailProviderKind | null {
  const normalized = normalizeProviderToken(provider);

  if (!normalized) {
    return null;
  }

  if (
    normalized === "gmail" ||
    normalized === "icloud" ||
    normalized === "inmotion-hosted" ||
    normalized === "generic-imap-smtp"
  ) {
    return normalized;
  }

  if (
    normalized === "GMAIL".toLowerCase() ||
    normalized === "ICLOUD".toLowerCase() ||
    normalized === "INMOTION_HOSTED".toLowerCase() ||
    normalized === "GENERIC_IMAP_SMTP".toLowerCase()
  ) {
    return PERSISTED_TO_KIND[normalized.toUpperCase() as PersistedMailAccountProvider];
  }

  return null;
}

function inferProviderByIdentity(input: {
  email: string;
  imapHost: string;
  smtpHost: string;
}): MailProviderKind {
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

  if (
    emailDomain === "icloud.com" ||
    emailDomain === "me.com" ||
    emailDomain === "mac.com" ||
    imapHost.includes("icloud") ||
    imapHost.includes("mail.me.com") ||
    smtpHost.includes("icloud") ||
    smtpHost.includes("mail.me.com")
  ) {
    return "icloud";
  }

  if (
    emailDomain.includes("makingmyworldbetter") ||
    emailDomain.includes("mmwb") ||
    emailDomain.includes("imotion") ||
    imapHost.includes("makingmyworldbetter") ||
    imapHost.includes("mmwb") ||
    imapHost.includes("imotion") ||
    smtpHost.includes("makingmyworldbetter") ||
    smtpHost.includes("mmwb") ||
    smtpHost.includes("imotion")
  ) {
    return "inmotion-hosted";
  }

  return "generic-imap-smtp";
}

export function resolveMailProviderKind(input: ProviderIdentityInput): MailProviderKind {
  const explicit = parseExplicitProvider(input.provider);
  if (explicit) {
    return explicit;
  }

  return inferProviderByIdentity({
    email: (input.email ?? "").trim().toLowerCase(),
    imapHost: (input.imapHost ?? "").trim().toLowerCase(),
    smtpHost: (input.smtpHost ?? "").trim().toLowerCase()
  });
}

export function getMailProviderProfile(kind: MailProviderKind) {
  return PROFILE_BY_KIND[kind];
}

export function getMailProviderProfileByIdentity(input: ProviderIdentityInput) {
  return getMailProviderProfile(resolveMailProviderKind(input));
}

export function getPersistedMailProvider(input: ProviderIdentityInput): PersistedMailAccountProvider {
  return getMailProviderProfileByIdentity(input).persisted;
}

export function normalizeMailConnectionWithProviderDefaults(
  input: MailConnectionPayload & { provider?: string | null }
) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedPassword = input.password.trim();
  const normalizedImapHost = input.imapHost.trim().toLowerCase();
  const normalizedSmtpHost = input.smtpHost.trim().toLowerCase();
  const kind = resolveMailProviderKind({
    provider: input.provider,
    email: normalizedEmail,
    imapHost: normalizedImapHost,
    smtpHost: normalizedSmtpHost
  });
  const profile = getMailProviderProfile(kind);

  const connection: MailConnectionPayload = {
    email: normalizedEmail,
    password: normalizedPassword,
    imapHost: normalizedImapHost || profile.defaults.imapHost,
    imapPort: Number.isFinite(input.imapPort) && input.imapPort > 0
      ? input.imapPort
      : profile.defaults.imapPort,
    imapSecure:
      typeof input.imapSecure === "boolean" ? input.imapSecure : profile.defaults.imapSecure,
    smtpHost: normalizedSmtpHost || profile.defaults.smtpHost,
    smtpPort: Number.isFinite(input.smtpPort) && input.smtpPort > 0
      ? input.smtpPort
      : profile.defaults.smtpPort,
    smtpSecure:
      typeof input.smtpSecure === "boolean" ? input.smtpSecure : profile.defaults.smtpSecure,
    folder: input.folder?.trim() || "INBOX"
  };

  return {
    connection,
    kind,
    persistedProvider: profile.persisted,
    profile
  };
}

export function getProviderDefaultsForKind(kind: MailProviderKind) {
  return { ...getMailProviderProfile(kind).defaults };
}

