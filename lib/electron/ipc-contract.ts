import type { MailAccountSummary, MailComposePayload, MailConnectionPayload, MailDetail, MailFolder, MailSummary } from "@/lib/mail-types";
import type { AccountComposePayload } from "@/lib/services/account-mail-service";
import type { CreateMailAccountPayload } from "@/lib/services/account-management-service";
import type {
  LoadDraftResult,
  SaveDraftInput,
  SaveDraftResult,
  StoredComposerDraft
} from "@/composer/drafts/draft-types";

export const ELECTRON_MAIL_CHANNELS = {
  listAccounts: "mail:list-accounts",
  verifyAccount: "mail:verify-account",
  createAccount: "mail:create-account",
  loadFolders: "mail:load-folders",
  loadMessages: "mail:load-messages",
  loadMessageDetail: "mail:load-message-detail",
  sendMessage: "mail:send-message",
  createDraft: "mail:create-draft",
  saveDraft: "mail:save-draft",
  loadDraft: "mail:load-draft",
  listDrafts: "mail:list-drafts",
  deleteDraft: "mail:delete-draft",
  printToPdf: "mail:print-to-pdf",
  openComposeWindow: "mail:open-compose-window",
  composeCloseRequested: "mail:compose-close-requested",
  respondComposeCloseRequest: "mail:respond-compose-close-request",
  openColorPicker: "color-picker:open",
  publishColorPickerChange: "color-picker:publish-change",
  publishColorPickerCommit: "color-picker:publish-commit",
  colorPickerOpenRequest: "color-picker:open-request",
  colorPickerChange: "color-picker:change",
  colorPickerCommit: "color-picker:commit"
} as const;

export type ElectronLoadFoldersInput = {
  accountId: string;
  sync?: boolean;
  folderPaths?: string[];
};

export type ElectronLoadMessagesInput = {
  accountId: string;
  folderPath: string;
  query?: string;
  mailboxType?: string | null;
  sourceKind?: string | null;
  mailboxSystemKey?: string | null;
  shouldSync?: boolean;
};

export type ElectronLoadMessageDetailInput = {
  accountId: string;
  folderPath: string;
  uid: number;
};

export type ElectronSendAttachmentInput = {
  filename: string;
  contentType?: string;
  cid?: string;
  contentDisposition?: "inline" | "attachment";
  contentBase64: string;
};

export type ElectronSendPayload = Omit<AccountComposePayload, "attachments"> & {
  attachments?: ElectronSendAttachmentInput[];
};

export type ElectronSendMessageInput = {
  accountId: string;
  payload: ElectronSendPayload;
};

export type ElectronSaveDraftInput = SaveDraftInput;

export type ElectronLoadDraftInput = {
  draftId?: string | null;
};

export type ElectronListDraftsInput = {
  accountId?: string | null;
};

export type ElectronDeleteDraftInput = {
  draftId: string;
};

export type ElectronPrintToPdfInput = {
  html: string;
  suggestedFilename: string;
};

export type ElectronPrintToPdfResult = {
  saved: boolean;
  filePath: string | null;
};

export type ElectronOpenComposeWindowInput = {
  draftId?: string | null;
};

export type ElectronRespondComposeCloseRequestInput = {
  decision: "save" | "discard" | "cancel";
};

export type ElectronMailBridge = {
  version: 2;
  isElectron: true;
  isComposeWindow?: boolean;
  listAccounts(): Promise<{ accounts: MailAccountSummary[] }>;
  verifyAccount(payload: CreateMailAccountPayload): Promise<{
    folders: MailFolder[];
    connection?: Partial<MailConnectionPayload>;
  }>;
  createAccount(payload: CreateMailAccountPayload): Promise<{
    account: MailAccountSummary;
  }>;
  loadFolders(input: ElectronLoadFoldersInput): Promise<{ folders: MailFolder[] }>;
  loadMessages(input: ElectronLoadMessagesInput): Promise<{ messages: MailSummary[] }>;
  loadMessageDetail(input: ElectronLoadMessageDetailInput): Promise<{ message: MailDetail }>;
  sendMessage(input: ElectronSendMessageInput): Promise<unknown>;
  createDraft(input: ElectronSaveDraftInput): Promise<SaveDraftResult>;
  saveDraft(input: ElectronSaveDraftInput): Promise<SaveDraftResult>;
  loadDraft(input: ElectronLoadDraftInput): Promise<LoadDraftResult>;
  listDrafts(input: ElectronListDraftsInput): Promise<{ drafts: StoredComposerDraft[] }>;
  deleteDraft(input: ElectronDeleteDraftInput): Promise<{ deleted: boolean }>;
  printToPdf(input: ElectronPrintToPdfInput): Promise<ElectronPrintToPdfResult>;
  openComposeWindow(input?: ElectronOpenComposeWindowInput): Promise<{ opened: boolean }>;
  onComposeCloseRequested?(listener: () => void): () => void;
  respondComposeCloseRequest?(
    input: ElectronRespondComposeCloseRequestInput
  ): Promise<{ closed: boolean }>;
  openColorPicker?(initialColor: string): Promise<{ opened: boolean }>;
  publishColorPickerChange?(color: string): Promise<{ delivered: boolean }>;
  publishColorPickerCommit?(color: string): Promise<{ delivered: boolean }>;
  onColorPickerOpenRequest?(listener: (color: string) => void): () => void;
  onColorPickerChange?(listener: (color: string) => void): () => void;
  onColorPickerCommit?(listener: (color: string) => void): () => void;
};

export type AccountCreateRequestBody = CreateMailAccountPayload;
export type AccountSendFormPayload = Omit<
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
