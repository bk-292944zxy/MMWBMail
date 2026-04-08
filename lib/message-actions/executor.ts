import type {
  MailActionExecutionResult,
  MailActionRequest
} from "@/lib/message-actions/types";

type JsonExecutor = <T>(url: string, body: unknown) => Promise<T>;

export type MailActionExecutorDeps = {
  postJson: JsonExecutor;
  patchJson: JsonExecutor;
};

function getActionUids(request: MailActionRequest) {
  return request.target.messageUids;
}

export function buildMailActionKey(request: MailActionRequest) {
  const targetPart =
    request.target.scope === "conversation"
      ? `${request.target.scope}:${request.target.conversationId}`
      : request.target.scope;
  return [
    request.accountId,
    request.folderPath,
    request.kind,
    targetPart,
    [...request.target.messageUids].sort((left, right) => left - right).join(",")
  ].join(":");
}

export async function executeMailActionRequest(
  request: MailActionRequest,
  deps: MailActionExecutorDeps
): Promise<MailActionExecutionResult> {
  const uids = getActionUids(request);

  if (uids.length === 0) {
    throw new Error("No messages selected for this action.");
  }

  if (request.kind === "mark_read" || request.kind === "mark_unread") {
    await deps.postJson<{ success: true }>(`/api/accounts/${request.accountId}/flag`, {
      folder: request.folderPath,
      uids,
      flag: "\\Seen",
      action: request.kind === "mark_read" ? "add" : "remove"
    });

    return {
      statusMessage:
        request.kind === "mark_read"
          ? "Message marked read."
          : "Message marked unread.",
      refreshFolderCounts: true
    };
  }

  if (request.kind === "star" || request.kind === "unstar") {
    await deps.postJson<{ success: true }>(`/api/accounts/${request.accountId}/flag`, {
      folder: request.folderPath,
      uids,
      flag: "\\Flagged",
      action: request.kind === "star" ? "add" : "remove"
    });

    return {
      statusMessage:
        request.kind === "star" ? "Message starred." : "Message unstarred.",
      refreshFolderCounts: false
    };
  }

  if (request.kind === "delete") {
    await deps.postJson<{ success: true; deletedCount: number; movedToTrash: boolean }>(
      `/api/accounts/${request.accountId}/bulk-delete`,
      {
        folder: request.folderPath,
        uids,
        moveToTrash: true
      }
    );

    return {
      statusMessage: "Message deleted.",
      toastMessage: `${uids.length} message${uids.length === 1 ? "" : "s"} deleted`,
      refreshFolderCounts: true
    };
  }

  const destinationFolder =
    request.destinationFolder ??
    (request.kind === "archive"
      ? "Archive"
      : request.kind === "spam"
        ? "Spam"
        : request.kind === "restore" || request.kind === "not_spam"
          ? "INBOX"
          : undefined);

  if (!destinationFolder) {
    throw new Error("This action needs a destination folder.");
  }

  await Promise.all(
    uids.map((uid) =>
      deps.patchJson<{ success: true }>(`/api/accounts/${request.accountId}/messages/${uid}`, {
        folder: request.folderPath,
        action: "move",
        destinationFolder
      })
    )
  );

  return {
    statusMessage:
      request.kind === "archive"
        ? "Message moved to Archive."
        : request.kind === "spam"
          ? "Message moved to Spam."
          : request.kind === "not_spam"
            ? "Message removed from Spam."
            : request.kind === "restore"
              ? "Message restored."
              : "Message moved.",
    refreshFolderCounts: true
  };
}
