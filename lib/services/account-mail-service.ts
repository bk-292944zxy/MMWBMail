import {
  bulkDeleteAccountMessages,
  recordAccountEvent,
  recordAccountEvents,
  sendAccountMessage,
  updateAccountMessage
} from "@/lib/mail-account-actions";
import { getOwnedAccount } from "@/lib/account-ownership";
import { searchAccountMessagesViaProvider } from "@/lib/mail-provider";
import { syncAccountOnDemand } from "@/lib/mail-sync-runtime";
import {
  getSyncedMessageDetail,
  listSyncedFolders,
  listSyncedMessages,
  syncMailAccount
} from "@/lib/mail-sync";
import type { MailComposePayload, MailUpdatePayload } from "@/lib/mail-types";
import { ServiceError } from "@/lib/services/service-error";

export type ListAccountMessagesInput = {
  accountId: string;
  folderPath?: string | null;
  query?: string;
  mailboxType?: string | null;
  sourceKind?: string | null;
  mailboxSystemKey?: string | null;
  shouldSync?: boolean;
};

export type SyncAccountFoldersInput = {
  accountId: string;
  folderPaths?: string[];
  shouldSync?: boolean;
};

export type SyncAccountInput = {
  accountId: string;
  folderPaths?: string[];
  includeBodies?: boolean;
};

export type GetAccountMessageDetailInput = {
  accountId: string;
  folderPath?: string | null;
  uid: number;
};

export type AccountComposePayload = Omit<
  MailComposePayload,
  | "email"
  | "password"
  | "imapHost"
  | "imapPort"
  | "imapSecure"
  | "smtpHost"
  | "smtpPort"
  | "smtpSecure"
>;

type AccountMessagePatchPayload = Pick<
  MailUpdatePayload,
  "folder" | "action" | "seen" | "destinationFolder"
>;

async function requireOwnedAccount(accountId: string) {
  const account = await getOwnedAccount(accountId);
  if (!account) {
    throw new ServiceError("Account not found.", 404);
  }
}

function sanitizeFolderPaths(folderPaths?: string[]) {
  if (!Array.isArray(folderPaths) || folderPaths.length === 0) {
    return [];
  }

  return folderPaths.map((value) => value.trim()).filter(Boolean);
}

export async function loadAccountFoldersService(input: SyncAccountFoldersInput) {
  await requireOwnedAccount(input.accountId);

  const folderPaths = sanitizeFolderPaths(input.folderPaths);
  if (input.shouldSync === true) {
    await syncMailAccount(
      input.accountId,
      folderPaths.length > 0 ? { folderPaths } : undefined
    );
  }

  return listSyncedFolders(input.accountId);
}

export async function syncAccountService(input: SyncAccountInput) {
  await requireOwnedAccount(input.accountId);

  return syncAccountOnDemand(input.accountId, {
    folderPaths: sanitizeFolderPaths(input.folderPaths),
    includeBodies: input.includeBodies === true
  });
}

export async function listAccountMessagesService(input: ListAccountMessagesInput) {
  await requireOwnedAccount(input.accountId);

  const folderPath = input.folderPath?.trim();
  if (!folderPath) {
    throw new ServiceError("Missing folder query parameter.", 400);
  }

  if (input.shouldSync === true) {
    await syncMailAccount(input.accountId, {
      folderPaths: [folderPath]
    });
  }

  const query = input.query?.trim() ?? "";
  if (query) {
    const result = await searchAccountMessagesViaProvider({
      accountId: input.accountId,
      folderPath,
      mailboxType:
        input.mailboxType === "system" ||
        input.mailboxType === "folder" ||
        input.mailboxType === "label"
          ? input.mailboxType
          : undefined,
      sourceKind:
        input.sourceKind === "folder" || input.sourceKind === "label"
          ? input.sourceKind
          : undefined,
      mailboxSystemKey: input.mailboxSystemKey?.trim() || undefined,
      query
    });

    return result.messages;
  }

  return listSyncedMessages(input.accountId, folderPath);
}

export async function getAccountMessageDetailService(input: GetAccountMessageDetailInput) {
  await requireOwnedAccount(input.accountId);

  const folderPath = input.folderPath?.trim();
  if (!folderPath) {
    throw new ServiceError("Missing folder query parameter.", 400);
  }

  if (!Number.isFinite(input.uid)) {
    throw new ServiceError("Invalid message uid.", 400);
  }

  const message = await getSyncedMessageDetail(input.accountId, folderPath, input.uid);
  if (!message) {
    throw new ServiceError("Message not found.", 404);
  }

  return message;
}

export async function updateAccountMessageService(
  accountId: string,
  payload: AccountMessagePatchPayload,
  uid: number
) {
  await requireOwnedAccount(accountId);

  const folder = payload.folder?.trim();
  if (!folder) {
    throw new ServiceError("Missing folder.", 400);
  }

  if (!Number.isFinite(uid)) {
    throw new ServiceError("Invalid message uid.", 400);
  }

  const result = await updateAccountMessage(accountId, payload, uid);
  await recordAccountEvent(accountId, {
    type: payload.action === "delete" ? "message.deleted" : "message.updated",
    folderPath: payload.folder,
    messageUid: uid,
    payloadJson: JSON.stringify({
      action: payload.action,
      destinationFolder: payload.destinationFolder ?? null,
      seen: payload.seen ?? null
    })
  });

  return result;
}

export async function sendAccountMessageService(
  accountId: string,
  payload: AccountComposePayload
) {
  await requireOwnedAccount(accountId);

  const result = await sendAccountMessage(accountId, payload);
  await recordAccountEvent(accountId, {
    type: "message.sent",
    folderPath: payload.folder ?? "INBOX",
    payloadJson: JSON.stringify({
      to: payload.to,
      subject: payload.subject
    })
  });

  return result;
}

export type BulkDeletePayload = {
  folder: string;
  uids: number[];
  moveToTrash?: boolean;
};

export async function bulkDeleteAccountMessagesService(
  accountId: string,
  payload: BulkDeletePayload
) {
  await requireOwnedAccount(accountId);

  const result = await bulkDeleteAccountMessages(accountId, payload);
  await recordAccountEvents(
    accountId,
    payload.uids.map((uid) => ({
      type: "message.deleted",
      folderPath: payload.folder,
      messageUid: uid,
      payloadJson: JSON.stringify({
        moveToTrash: payload.moveToTrash === true
      })
    }))
  );

  return result;
}
