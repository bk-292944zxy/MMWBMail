import type { MailActionRequest } from "@/lib/message-actions/types";
import type { MailSummary } from "@/lib/mail-types";

export type PendingMailMutation = {
  key: string;
  accountId: string;
  folderPath: string;
  affectedUids: number[];
  removesFromCurrentFolder: boolean;
  patch: Partial<Pick<MailSummary, "seen" | "flagged">> | null;
  expiresAt: number;
};

export type VisibleMessageRequestScope = {
  accountId: string | null;
  folderPath: string;
  resultKey?: string | null;
};

const REMOVE_FROM_FOLDER_KINDS = new Set([
  "archive",
  "delete",
  "spam",
  "not_spam",
  "move",
  "restore"
]);

export function createPendingMailMutation(
  request: MailActionRequest,
  now = Date.now(),
  ttlMs = 15000
): PendingMailMutation | null {
  const patch =
    request.kind === "mark_read"
      ? { seen: true }
      : request.kind === "mark_unread"
        ? { seen: false }
        : request.kind === "star"
          ? { flagged: true }
          : request.kind === "unstar"
            ? { flagged: false }
            : null;

  const removesFromCurrentFolder = REMOVE_FROM_FOLDER_KINDS.has(request.kind);

  if (!removesFromCurrentFolder && !patch) {
    return null;
  }

  return {
    key: [
      request.accountId,
      request.folderPath,
      request.kind,
      [...request.target.messageUids].sort((left, right) => left - right).join(",")
    ].join(":"),
    accountId: request.accountId,
    folderPath: request.folderPath,
    affectedUids: request.target.messageUids,
    removesFromCurrentFolder,
    patch,
    expiresAt: now + ttlMs
  };
}

export function pruneExpiredMailMutations(
  mutations: Record<string, PendingMailMutation>,
  now = Date.now()
) {
  return Object.fromEntries(
    Object.entries(mutations).filter(([, mutation]) => mutation.expiresAt > now)
  );
}

export function reconcileMessagesWithPendingMutations(
  messages: MailSummary[],
  mutations: Record<string, PendingMailMutation>,
  scope: {
    accountId: string;
    folderPath: string;
  },
  now = Date.now()
) {
  const relevant = Object.values(mutations).filter(
    (mutation) =>
      mutation.expiresAt > now &&
      mutation.accountId === scope.accountId &&
      mutation.folderPath === scope.folderPath
  );

  if (relevant.length === 0) {
    return messages;
  }

  let nextMessages = [...messages];

  for (const mutation of relevant) {
    const affectedUids = new Set(mutation.affectedUids);

    if (mutation.removesFromCurrentFolder) {
      nextMessages = nextMessages.filter((message) => !affectedUids.has(message.uid));
      continue;
    }

    if (mutation.patch) {
      nextMessages = nextMessages.map((message) =>
        affectedUids.has(message.uid) ? { ...message, ...mutation.patch } : message
      );
    }
  }

  return nextMessages;
}

export function buildVisibleMessageRequestKey(scope: VisibleMessageRequestScope) {
  return scope.resultKey || [scope.accountId ?? "none", scope.folderPath, "browse"].join(":");
}

export function reconcileVisibleSelection(
  messages: MailSummary[],
  input: {
    selectedUid: number | null;
    selectedMessageUid: number | null;
    selectedMessageAccountId?: string | null;
    preserveSelection: boolean;
    scopeAccountId?: string | null;
  }
) {
  const visibleUids = new Set(messages.map((message) => message.uid));
  const currentUid = input.selectedUid ?? input.selectedMessageUid;
  const selectionMatchesScope =
    !input.selectedMessageAccountId ||
    !input.scopeAccountId ||
    input.selectedMessageAccountId === input.scopeAccountId;

  if (
    input.preserveSelection &&
    selectionMatchesScope &&
    currentUid !== null &&
    messages.length === 0
  ) {
    return {
      selectedUid: currentUid,
      clearSelectedMessage: false
    };
  }

  if (
    input.preserveSelection &&
    selectionMatchesScope &&
    currentUid !== null &&
    visibleUids.has(currentUid)
  ) {
    return {
      selectedUid: currentUid,
      clearSelectedMessage: false
    };
  }

  const nextUid = messages[0]?.uid ?? null;

  return {
    selectedUid: nextUid,
    clearSelectedMessage: currentUid !== null && currentUid !== nextUid
  };
}
