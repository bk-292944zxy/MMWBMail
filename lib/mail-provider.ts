import {
  bulkDeleteMessages,
  emptyTrashFolder,
  deleteMessagesFromSender,
  getMessageDetail,
  listFolders,
  listMessages,
  saveDraftMessage,
  sendMessage,
  updateMessage,
  updateMessageFlags
} from "@/lib/mail-client";
import { requireMailAccountConnection } from "@/lib/mail-accounts";
import {
  getMailAccountProviderInfo,
  getProviderCapabilities,
  inferMailProviderKind
} from "@/lib/mail-provider-metadata";
import {
  matchesGmailSearch,
  normalizeGmailMailbox,
  normalizeGmailMailboxes,
  normalizeGmailMessageDetail,
  normalizeGmailMessageSummary,
  resolveGmailSearchFolderPath,
  translateGmailSearchInput
} from "@/lib/providers/gmail";
import type {
  BulkDeletePayload,
  ConnectedAccount,
  ConnectAccountInput,
  MailComposePayload,
  MailConnectionPayload,
  MailDetail,
  MailFlagPayload,
  MailFolder,
  MailProviderKind,
  MailSummary,
  MailUpdatePayload,
  ProviderCapabilities,
  ProviderSearchInput,
  ProviderSearchResult,
  ProviderThread,
  SyncMailboxInput,
  SyncMailboxResult
} from "@/lib/mail-types";

export interface MailProviderAdapter {
  getCapabilities(): ProviderCapabilities;
  connectAccount(input: ConnectAccountInput): Promise<ConnectedAccount>;
  listMailboxes(accountId: string): Promise<MailFolder[]>;
  syncMailbox(input: SyncMailboxInput): Promise<SyncMailboxResult>;
  getThread(accountId: string, providerThreadId: string): Promise<ProviderThread>;
  getMessage(accountId: string, providerMessageId: string): Promise<MailDetail | null>;
  search?(input: ProviderSearchInput): Promise<ProviderSearchResult>;
}

type MailProviderMutationAdapter = MailProviderAdapter & {
  sendComposedMessage?: (
    accountId: string,
    payload: MailComposePayload
  ) => Promise<{ success: true }>;
  saveComposedDraft?: (
    accountId: string,
    payload: MailComposePayload,
    options?: { previousProviderDraftId?: string | null }
  ) => Promise<{ success: true; folderPath: string; providerDraftId: string | null }>;
  updateProviderMessage?: (
    accountId: string,
    payload: MailUpdatePayload,
    uid: number
  ) => Promise<{ success: true }>;
  bulkDeleteProviderMessages?: (
    accountId: string,
    payload: BulkDeletePayload
  ) => Promise<{ success: true; deletedCount: number; movedToTrash: boolean }>;
  emptyProviderTrash?: (
    accountId: string,
    payload: Pick<MailConnectionPayload, "email" | "password" | "imapHost" | "imapPort" | "imapSecure" | "smtpHost" | "smtpPort" | "smtpSecure" | "folder">
  ) => Promise<{ success: true; deletedCount: number }>;
  updateProviderMessageFlags?: (
    accountId: string,
    payload: MailFlagPayload
  ) => Promise<{ success: true }>;
  deleteMessagesForSender?: (
    accountId: string,
    senderEmail: string
  ) => Promise<{ success: true; deletedCount: number; movedToTrash: boolean }>;
};

function buildProviderMessageId(folderPath: string, uid: number) {
  return `${encodeURIComponent(folderPath)}::${uid}`;
}

function parseProviderMessageId(providerMessageId: string) {
  const [encodedFolderPath, uidValue] = providerMessageId.split("::");
  const uid = Number(uidValue);

  if (!encodedFolderPath || !Number.isFinite(uid)) {
    throw new Error("Invalid provider message identifier.");
  }

  return {
    folderPath: decodeURIComponent(encodedFolderPath),
    uid
  };
}

function buildProviderThreadId(folderPath: string, threadId: string) {
  return `${encodeURIComponent(folderPath)}::${encodeURIComponent(threadId)}`;
}

function parseProviderThreadId(providerThreadId: string) {
  const [encodedFolderPath, encodedThreadId] = providerThreadId.split("::");

  if (!encodedFolderPath || !encodedThreadId) {
    throw new Error("Invalid provider thread identifier.");
  }

  return {
    folderPath: decodeURIComponent(encodedFolderPath),
    threadId: decodeURIComponent(encodedThreadId)
  };
}

function normalizeThreadMessages(messages: MailSummary[]) {
  return [...messages].sort(
    (left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()
  );
}

class ImapSmtpProviderAdapter implements MailProviderMutationAdapter {
  constructor(private readonly providerKind: MailProviderKind) {}

  getCapabilities() {
    return getProviderCapabilities(this.providerKind);
  }

  async connectAccount(input: ConnectAccountInput): Promise<ConnectedAccount> {
    return {
      email: input.email.trim().toLowerCase(),
      defaultFolder: input.folder?.trim() || "INBOX",
      provider: getMailAccountProviderInfo(input)
    };
  }

  async listMailboxes(accountId: string) {
    const { connection } = await requireMailAccountConnection(accountId);
    return listFolders(connection);
  }

  async syncMailbox(input: SyncMailboxInput) {
    const { connection } = await requireMailAccountConnection(input.accountId, input.folderPath);
    const mailboxes = await listFolders(connection);
    const mailbox =
      mailboxes.find((folder) => folder.path === input.folderPath) ??
      ({
        path: input.folderPath,
        name: input.folderPath,
        specialUse: null,
        count: null,
        unread: null
      } satisfies MailFolder);

    return {
      mailbox,
      messages: await listMessages(connection)
    };
  }

  async getThread(accountId: string, providerThreadId: string) {
    const { folderPath, threadId } = parseProviderThreadId(providerThreadId);
    const { connection } = await requireMailAccountConnection(accountId, folderPath);
    const messages = normalizeThreadMessages(
      (await listMessages(connection)).filter(
        (message) => (message.threadId ?? message.messageId) === threadId
      )
    );

    return {
      providerThreadId,
      messages,
      latestMessage: messages[0] ?? null
    };
  }

  async getMessage(accountId: string, providerMessageId: string) {
    const { folderPath, uid } = parseProviderMessageId(providerMessageId);
    const { connection } = await requireMailAccountConnection(accountId, folderPath);
    return getMessageDetail(connection, uid);
  }

  async search(input: ProviderSearchInput) {
    const folderPath = input.folderPath?.trim() || "INBOX";
    const { connection } = await requireMailAccountConnection(input.accountId, folderPath);
    const normalizedQuery = input.query.trim().toLowerCase();
    const messages = await listMessages(connection);

    return {
      messages: messages.filter((message) => {
        if (!normalizedQuery) {
          return true;
        }

        return (
          message.from.toLowerCase().includes(normalizedQuery) ||
          message.fromAddress.toLowerCase().includes(normalizedQuery) ||
          message.subject.toLowerCase().includes(normalizedQuery) ||
          message.preview.toLowerCase().includes(normalizedQuery)
        );
      })
    };
  }

  async sendComposedMessage(accountId: string, payload: MailComposePayload) {
    const { connection } = await requireMailAccountConnection(accountId, payload.folder);
    return sendMessage({
      ...connection,
      ...payload
    });
  }

  async saveComposedDraft(
    accountId: string,
    payload: MailComposePayload,
    options: { previousProviderDraftId?: string | null } = {}
  ) {
    const { connection } = await requireMailAccountConnection(accountId, payload.folder);
    return saveDraftMessage(
      {
        ...connection,
        ...payload
      },
      options
    );
  }

  async updateProviderMessage(accountId: string, payload: MailUpdatePayload, uid: number) {
    const { connection } = await requireMailAccountConnection(accountId, payload.folder);
    return updateMessage(
      {
        ...connection,
        ...payload
      },
      uid
    );
  }

  async bulkDeleteProviderMessages(accountId: string, payload: BulkDeletePayload) {
    const { connection } = await requireMailAccountConnection(accountId, payload.folder);
    return bulkDeleteMessages({
      ...connection,
      ...payload
    });
  }

  async emptyProviderTrash(
    accountId: string,
    payload: Pick<
      MailConnectionPayload,
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
  ) {
    const { connection } = await requireMailAccountConnection(accountId, payload.folder);
    return emptyTrashFolder({
      ...connection,
      ...payload
    });
  }

  async updateProviderMessageFlags(accountId: string, payload: MailFlagPayload) {
    const { connection } = await requireMailAccountConnection(accountId, payload.folder);
    return updateMessageFlags({
      ...connection,
      ...payload
    });
  }

  async deleteMessagesForSender(accountId: string, senderEmail: string) {
    const { connection } = await requireMailAccountConnection(accountId);
    return deleteMessagesFromSender(
      {
        ...connection,
        senderEmail
      },
      senderEmail
    );
  }
}

class GmailProviderAdapter extends ImapSmtpProviderAdapter {
  constructor() {
    super("gmail");
  }

  async listMailboxes(accountId: string) {
    return normalizeGmailMailboxes(await super.listMailboxes(accountId));
  }

  async syncMailbox(input: SyncMailboxInput) {
    const result = await super.syncMailbox(input);

    return {
      mailbox: normalizeGmailMailbox(result.mailbox),
      messages: result.messages.map((message) =>
        normalizeGmailMessageSummary(message, { accountId: input.accountId })
      )
    };
  }

  async getThread(accountId: string, providerThreadId: string) {
    const result = await super.getThread(accountId, providerThreadId);
    const messages = result.messages.map((message) =>
      normalizeGmailMessageSummary(message, { accountId })
    );

    return {
      providerThreadId: result.providerThreadId,
      messages,
      latestMessage: messages[0] ?? null
    };
  }

  async getMessage(accountId: string, providerMessageId: string) {
    const message = await super.getMessage(accountId, providerMessageId);
    return message ? normalizeGmailMessageDetail(message, { accountId }) : null;
  }

  async search(input: ProviderSearchInput) {
    const mailboxes = await this.listMailboxes(input.accountId);
    const translated = translateGmailSearchInput(input);
    const folderPath = resolveGmailSearchFolderPath(mailboxes, input);
    const result = await super.search({
      ...input,
      folderPath,
      query: translated.terms.join(" ")
    });
    return {
      messages: result.messages
        .map((message) =>
          normalizeGmailMessageSummary(message, { accountId: input.accountId })
        )
        .filter((message) => matchesGmailSearch(message, input))
    };
  }
}

const GMAIL_ADAPTER = new GmailProviderAdapter();
const GENERIC_IMAP_SMTP_ADAPTER = new ImapSmtpProviderAdapter("generic-imap-smtp");

function getMailProviderAdapterForKind(kind: MailProviderKind) {
  return kind === "gmail" ? GMAIL_ADAPTER : GENERIC_IMAP_SMTP_ADAPTER;
}

function getMailProviderAdapterForConnection(
  connection: Pick<MailConnectionPayload, "email" | "imapHost" | "smtpHost"> & {
    provider?: string | null;
  }
) {
  return getMailProviderAdapterForKind(inferMailProviderKind(connection));
}

async function getMailProviderAdapterForAccount(accountId: string) {
  const { account, connection } = await requireMailAccountConnection(accountId);
  const provider = getMailAccountProviderInfo({
    provider: account.provider,
    email: connection.email,
    imapHost: connection.imapHost,
    smtpHost: connection.smtpHost
  });
  return getMailProviderAdapterForKind(provider.kind);
}

export async function listAccountMailboxesViaProvider(accountId: string) {
  const adapter = await getMailProviderAdapterForAccount(accountId);
  return adapter.listMailboxes(accountId);
}

export async function syncAccountMailboxViaProvider(input: SyncMailboxInput) {
  const adapter = await getMailProviderAdapterForAccount(input.accountId);
  return adapter.syncMailbox(input);
}

export async function getAccountMessageViaProvider(
  accountId: string,
  folderPath: string,
  uid: number
) {
  const adapter = await getMailProviderAdapterForAccount(accountId);
  return adapter.getMessage(accountId, buildProviderMessageId(folderPath, uid));
}

export async function getAccountThreadViaProvider(
  accountId: string,
  folderPath: string,
  threadId: string
) {
  const adapter = await getMailProviderAdapterForAccount(accountId);
  return adapter.getThread(accountId, buildProviderThreadId(folderPath, threadId));
}

export async function searchAccountMessagesViaProvider(input: ProviderSearchInput) {
  const adapter = await getMailProviderAdapterForAccount(input.accountId);

  if (!adapter.search) {
    throw new Error("Mail provider does not support search.");
  }

  return adapter.search(input);
}

export async function sendAccountMessageViaProvider(
  accountId: string,
  payload: MailComposePayload
) {
  const adapter = await getMailProviderAdapterForAccount(accountId);

  if (!adapter.sendComposedMessage) {
    throw new Error("Mail provider does not support sending through the current route.");
  }

  return adapter.sendComposedMessage(accountId, payload);
}

export async function saveAccountDraftViaProvider(
  accountId: string,
  payload: MailComposePayload,
  options: { previousProviderDraftId?: string | null } = {}
) {
  const adapter = await getMailProviderAdapterForAccount(accountId);

  if (!adapter.saveComposedDraft) {
    throw new Error("Mail provider does not support draft save through the current route.");
  }

  return adapter.saveComposedDraft(accountId, payload, options);
}

export async function updateAccountMessageViaProvider(
  accountId: string,
  payload: MailUpdatePayload,
  uid: number
) {
  const adapter = await getMailProviderAdapterForAccount(accountId);

  if (!adapter.updateProviderMessage) {
    throw new Error("Mail provider does not support message updates.");
  }

  return adapter.updateProviderMessage(accountId, payload, uid);
}

export async function bulkDeleteAccountMessagesViaProvider(
  accountId: string,
  payload: BulkDeletePayload
) {
  const adapter = await getMailProviderAdapterForAccount(accountId);

  if (!adapter.bulkDeleteProviderMessages) {
    throw new Error("Mail provider does not support bulk delete.");
  }

  return adapter.bulkDeleteProviderMessages(accountId, payload);
}

export async function updateAccountFlagsViaProvider(
  accountId: string,
  payload: MailFlagPayload
) {
  const adapter = await getMailProviderAdapterForAccount(accountId);

  if (!adapter.updateProviderMessageFlags) {
    throw new Error("Mail provider does not support bulk flag updates.");
  }

  return adapter.updateProviderMessageFlags(accountId, payload);
}

export async function emptyAccountTrashViaProvider(
  accountId: string,
  payload: Pick<
    MailConnectionPayload,
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
) {
  const adapter = await getMailProviderAdapterForAccount(accountId);

  if (!adapter.emptyProviderTrash) {
    throw new Error("Mail provider does not support empty trash.");
  }

  return adapter.emptyProviderTrash(accountId, payload);
}

export async function deleteSenderMessagesViaProvider(accountId: string, senderEmail: string) {
  const adapter = await getMailProviderAdapterForAccount(accountId);

  if (!adapter.deleteMessagesForSender) {
    throw new Error("Mail provider does not support sender cleanup.");
  }

  return adapter.deleteMessagesForSender(accountId, senderEmail);
}
