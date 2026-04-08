import type { MailboxNode } from "@/lib/mailbox-navigation";
import type { MailSummary } from "@/lib/mail-types";

export type MailboxAccountScope = {
  kind: "single-account" | "all-accounts";
  accountId: string | null;
};

export type MailboxQueryState = {
  accountScope: MailboxAccountScope;
  target: {
    kind: "mailbox";
    accountId: string | null;
    providerKind: MailboxNode["identity"]["providerKind"] | null;
    mailboxId: string;
    providerPath: string;
    mailboxType: MailboxNode["type"];
    sourceKind: MailboxNode["identity"]["sourceKind"];
    systemKey: MailboxNode["systemKey"];
  };
  searchText: string;
  normalizedSearchText: string;
  usesServerSideSearch: boolean;
  filters: {
    sender: string | null;
    subject: string | null;
    subjectPattern: string | null;
  };
  sortBy?: string;
  mode: "browse" | "search";
  scopeKey: string;
  resultKey: string;
};

export type MailboxResultState = "loading" | "empty" | "results";

export function normalizeMailboxSearchText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function createMailboxQueryState(input: {
  mailbox: Pick<MailboxNode, "type" | "identity" | "systemKey"> | null;
  activeAccountId?: string | null;
  searchText: string;
  senderFilter: string | null;
  subjectFilter: string | null;
  subjectPattern: string | null;
  sortBy?: string;
  supportsServerSideSearch?: boolean;
}): MailboxQueryState {
  const normalizedSearchText = normalizeMailboxSearchText(input.searchText).toLowerCase();
  const mode = normalizedSearchText ? "search" : "browse";
  const usesServerSideSearch = Boolean(
    input.supportsServerSideSearch && normalizedSearchText
  );
  const normalizedSender = input.senderFilter?.trim() || null;
  const normalizedSubject = input.subjectFilter?.trim() || null;
  const normalizedPattern = input.subjectPattern?.trim() || null;
  const scopedAccountId = input.mailbox?.identity.accountId ?? input.activeAccountId ?? null;
  const accountScope: MailboxAccountScope = {
    kind: scopedAccountId ? "single-account" : "all-accounts",
    accountId: scopedAccountId
  };

  return {
    accountScope,
    target: {
      kind: "mailbox",
      accountId: scopedAccountId,
      providerKind: input.mailbox?.identity.providerKind ?? null,
      mailboxId: input.mailbox?.identity.id ?? "none",
      providerPath: input.mailbox?.identity.providerPath ?? "",
      mailboxType: input.mailbox?.type ?? "folder",
      sourceKind: input.mailbox?.identity.sourceKind ?? "folder",
      systemKey: input.mailbox?.systemKey ?? null
    },
    searchText: input.searchText,
    normalizedSearchText,
    usesServerSideSearch,
    filters: {
      sender: normalizedSender,
      subject: normalizedSubject,
      subjectPattern: normalizedPattern
    },
    sortBy: input.sortBy,
    mode,
    scopeKey: [
      accountScope.kind,
      accountScope.accountId ?? "none",
      input.mailbox?.identity.id ?? "none",
      normalizedSearchText,
      normalizedSender ?? "",
      normalizedSubject ?? "",
      normalizedPattern ?? ""
    ].join("::"),
    resultKey: [
      accountScope.kind,
      accountScope.accountId ?? "none",
      input.mailbox?.identity.id ?? "none",
      normalizedSearchText,
      normalizedSender ?? "",
      normalizedSubject ?? "",
      normalizedPattern ?? "",
      input.sortBy ?? ""
    ].join("::")
  };
}

export function filterMessagesForMailboxQuery(
  messages: MailSummary[],
  query: MailboxQueryState,
  options: {
    blockedSenders: Set<string>;
    focusFilterValue: (message: MailSummary) => string;
  }
) {
  return messages
    .filter((message) => {
      if (!query.normalizedSearchText) {
        return true;
      }

      const searchable = `${message.from} ${message.subject} ${message.preview}`.toLowerCase();
      return searchable.includes(query.normalizedSearchText);
    })
    .filter((message) => !options.blockedSenders.has(message.fromAddress ?? ""))
    .filter(
      (message) =>
        !query.filters.sender ||
        options.focusFilterValue(message) === query.filters.sender
    )
    .filter((message) => {
      if (!query.filters.subject) {
        return true;
      }

      if (query.filters.subjectPattern) {
        return message.subject
          .toLowerCase()
          .startsWith(query.filters.subjectPattern.toLowerCase());
      }

      return message.subject === query.filters.subject;
    });
}

export function shouldResetSelectionForMailboxQueryChange(
  previous: MailboxQueryState | null,
  next: MailboxQueryState
) {
  if (!previous) {
    return false;
  }

  return previous.scopeKey !== next.scopeKey;
}

export function getMailboxResultState(input: {
  isBusy: boolean;
  visibleCount: number;
}): MailboxResultState {
  if (input.isBusy) {
    return "loading";
  }

  return input.visibleCount > 0 ? "results" : "empty";
}

export function getMailboxEmptyMessage(query: MailboxQueryState) {
  return query.mode === "search"
    ? "No messages match this search yet."
    : "No messages match this view yet.";
}
