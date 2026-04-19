import { prisma } from "@/lib/prisma";
import { requireMailAccountConnection } from "@/lib/mail-accounts";
import {
  bulkDeleteAccountMessagesViaProvider,
  emptyAccountTrashViaProvider,
  deleteSenderMessagesViaProvider,
  sendAccountMessageViaProvider,
  saveAccountDraftViaProvider,
  updateAccountFlagsViaProvider,
  updateAccountMessageViaProvider
} from "@/lib/mail-provider";
import type { MailComposePayload, MailFlagPayload, MailUpdatePayload } from "@/lib/mail-types";

type AccountComposePayload = Omit<
  MailComposePayload,
  keyof Pick<
    MailComposePayload,
    | "email"
    | "password"
    | "imapHost"
    | "imapPort"
    | "imapSecure"
    | "smtpHost"
    | "smtpPort"
    | "smtpSecure"
    | "folder"
  >
> & {
  folder?: string;
};

type AccountMessageUpdatePayload = Omit<
  MailUpdatePayload,
  keyof Pick<
    MailUpdatePayload,
    | "email"
    | "password"
    | "imapHost"
    | "imapPort"
    | "imapSecure"
    | "smtpHost"
    | "smtpPort"
    | "smtpSecure"
  >
>;

type AccountBulkDeletePayload = {
  folder: string;
  uids: number[];
  moveToTrash?: boolean;
};

type AccountFlagPayload = Omit<
  MailFlagPayload,
  keyof Pick<
    MailFlagPayload,
    | "email"
    | "password"
    | "imapHost"
    | "imapPort"
    | "imapSecure"
    | "smtpHost"
    | "smtpPort"
    | "smtpSecure"
  >
>;

export async function updateAccountMessage(
  accountId: string,
  payload: AccountMessageUpdatePayload,
  uid: number
) {
  const { connection } = await requireMailAccountConnection(accountId, payload.folder);
  return updateAccountMessageViaProvider(
    accountId,
    {
      ...connection,
      ...payload
    },
    uid
  );
}

export async function bulkDeleteAccountMessages(
  accountId: string,
  payload: AccountBulkDeletePayload
) {
  const { connection } = await requireMailAccountConnection(accountId, payload.folder);
  return bulkDeleteAccountMessagesViaProvider(accountId, {
    ...connection,
    ...payload
  });
}

export async function deleteSenderMessagesForAccount(accountId: string, senderEmail: string) {
  return deleteSenderMessagesViaProvider(accountId, senderEmail);
}

export async function emptyTrashForAccount(accountId: string, folder: string) {
  const { connection } = await requireMailAccountConnection(accountId, folder);
  return emptyAccountTrashViaProvider(accountId, {
    ...connection,
    folder
  });
}

export async function updateAccountMessageFlags(
  accountId: string,
  payload: AccountFlagPayload
) {
  const { connection } = await requireMailAccountConnection(accountId, payload.folder);
  return updateAccountFlagsViaProvider(accountId, {
    ...connection,
    ...payload
  });
}

export async function sendAccountMessage(accountId: string, payload: AccountComposePayload) {
  const { connection } = await requireMailAccountConnection(accountId, payload.folder);
  return sendAccountMessageViaProvider(accountId, {
    ...connection,
    ...payload
  });
}

export async function saveAccountDraft(
  accountId: string,
  payload: AccountComposePayload,
  options: { previousProviderDraftId?: string | null } = {}
) {
  const { connection } = await requireMailAccountConnection(accountId, payload.folder);
  return saveAccountDraftViaProvider(
    accountId,
    {
      ...connection,
      ...payload
    },
    options
  );
}

export async function recordAccountEvent(
  accountId: string,
  input: {
    type: string;
    folderPath?: string | null;
    messageUid?: number | null;
    payloadJson?: string | null;
  }
) {
  await prisma.mailAccountEvent.create({
    data: {
      accountId,
      type: input.type,
      folderPath: input.folderPath ?? null,
      messageUid: input.messageUid ?? null,
      payloadJson: input.payloadJson ?? null
    }
  });
}

export async function recordAccountEvents(
  accountId: string,
  events: Array<{
    type: string;
    folderPath?: string | null;
    messageUid?: number | null;
    payloadJson?: string | null;
  }>
) {
  if (events.length === 0) {
    return;
  }

  await prisma.mailAccountEvent.createMany({
    data: events.map((event) => ({
      accountId,
      type: event.type,
      folderPath: event.folderPath ?? null,
      messageUid: event.messageUid ?? null,
      payloadJson: event.payloadJson ?? null
    }))
  });
}
