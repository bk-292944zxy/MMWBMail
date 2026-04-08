import type { MailDetail, MailFolder, MailSummary, ProviderSearchInput } from "@/lib/mail-types";

export type GmailSystemMailboxKind =
  | "inbox"
  | "archive"
  | "sent"
  | "drafts"
  | "trash"
  | "spam"
  | "starred";

const GMAIL_MAILBOX_VARIANTS: Record<
  GmailSystemMailboxKind,
  { specialUse: string; variants: string[] }
> = {
  inbox: {
    specialUse: "\\Inbox",
    variants: ["inbox"]
  },
  archive: {
    specialUse: "\\Archive",
    variants: ["all mail", "[gmail]/all mail", "[googlemail]/all mail", "archive"]
  },
  sent: {
    specialUse: "\\Sent",
    variants: ["sent", "sent mail", "[gmail]/sent mail", "[googlemail]/sent mail"]
  },
  drafts: {
    specialUse: "\\Drafts",
    variants: ["drafts", "[gmail]/drafts", "[googlemail]/drafts"]
  },
  trash: {
    specialUse: "\\Trash",
    variants: ["trash", "bin", "[gmail]/trash", "[googlemail]/trash"]
  },
  spam: {
    specialUse: "\\Junk",
    variants: ["spam", "junk", "[gmail]/spam", "[googlemail]/spam"]
  },
  starred: {
    specialUse: "\\Flagged",
    variants: ["starred", "[gmail]/starred", "[googlemail]/starred"]
  }
};

function matchesMailboxVariant(value: string, variants: string[]) {
  const normalized = value.trim().toLowerCase();
  return variants.some((variant) => normalized === variant || normalized.endsWith(`/${variant}`));
}

function inferGmailSpecialUse(folder: MailFolder) {
  if (folder.specialUse) {
    return folder.specialUse;
  }

  for (const entry of Object.values(GMAIL_MAILBOX_VARIANTS)) {
    if (
      matchesMailboxVariant(folder.name, entry.variants) ||
      matchesMailboxVariant(folder.path, entry.variants)
    ) {
      return entry.specialUse;
    }
  }

  return null;
}

function normalizeConversationSubject(subject: string) {
  return subject.replace(/^(Re|Fwd|Fw):\s*/gi, "").trim().toLowerCase();
}

function isSyntheticThreadId(message: Pick<MailSummary, "threadId" | "messageId" | "uid">) {
  return !message.threadId || message.threadId === message.messageId || message.threadId === `${message.uid}`;
}

export function normalizeGmailMailbox(folder: MailFolder): MailFolder {
  return {
    ...folder,
    specialUse: inferGmailSpecialUse(folder)
  };
}

export function normalizeGmailMailboxes(folders: MailFolder[]) {
  return folders.map(normalizeGmailMailbox);
}

export function findGmailSystemMailboxPath(
  folders: MailFolder[],
  kind: GmailSystemMailboxKind
) {
  const variants = GMAIL_MAILBOX_VARIANTS[kind];
  const normalizedFolders = normalizeGmailMailboxes(folders);
  const bySpecialUse = normalizedFolders.find((folder) => folder.specialUse === variants.specialUse);
  if (bySpecialUse) {
    return bySpecialUse.path;
  }

  return normalizedFolders.find(
    (folder) =>
      matchesMailboxVariant(folder.name, variants.variants) ||
      matchesMailboxVariant(folder.path, variants.variants)
  )?.path;
}

function normalizeGmailThreadId(
  message: Pick<MailSummary, "threadId" | "messageId" | "uid" | "subject">,
  accountId?: string
) {
  if (!accountId) {
    if (!isSyntheticThreadId(message)) {
      return message.threadId;
    }

    const subjectKey = normalizeConversationSubject(message.subject);
    return subjectKey ? `gmail-subject:${subjectKey}` : message.threadId;
  }

  const rawThreadId = !isSyntheticThreadId(message)
    ? message.threadId
    : message.messageId || `${message.uid}`;

  return rawThreadId ? `gmail:${accountId}:${rawThreadId}` : undefined;
}

export function normalizeGmailMessageSummary<T extends MailSummary>(
  message: T,
  options?: {
    accountId?: string;
  }
): T {
  const nextThreadId = normalizeGmailThreadId(message, options?.accountId);

  return {
    ...message,
    accountId: options?.accountId ?? message.accountId,
    threadId: nextThreadId
  };
}

export function normalizeGmailMessageDetail<T extends MailDetail>(
  message: T,
  options?: {
    accountId?: string;
  }
): T {
  return normalizeGmailMessageSummary(message, options) as T;
}

export function translateGmailSearchInput(input: ProviderSearchInput) {
  const normalizedQuery = input.query.trim().replace(/\s+/g, " ");
  const terms = normalizedQuery
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  return {
    folderPath: input.folderPath?.trim() || "INBOX",
    terms,
    mailboxType: input.mailboxType ?? "folder",
    sourceKind: input.sourceKind ?? "folder",
    mailboxSystemKey: input.mailboxSystemKey ?? null
  };
}

export function resolveGmailSearchFolderPath(
  folders: MailFolder[],
  input: ProviderSearchInput
) {
  const translated = translateGmailSearchInput(input);
  const systemMailboxKey = translated.mailboxSystemKey;

  if (
    translated.mailboxType === "system" &&
    systemMailboxKey &&
    (systemMailboxKey === "inbox" ||
      systemMailboxKey === "archive" ||
      systemMailboxKey === "sent" ||
      systemMailboxKey === "drafts" ||
      systemMailboxKey === "trash" ||
      systemMailboxKey === "spam" ||
      systemMailboxKey === "starred")
  ) {
    return findGmailSystemMailboxPath(folders, systemMailboxKey) ?? translated.folderPath;
  }

  return translated.folderPath;
}

export function matchesGmailSearch(message: MailSummary, input: ProviderSearchInput) {
  const translated = translateGmailSearchInput(input);

  if (translated.terms.length === 0) {
    return true;
  }

  const searchable = [
    message.from,
    message.fromAddress,
    message.subject,
    message.preview,
    message.cc ?? "",
    ...message.to
  ]
    .join(" ")
    .toLowerCase();

  return translated.terms.every((term) => searchable.includes(term));
}
