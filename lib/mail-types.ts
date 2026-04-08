export type MailConnectionPayload = {
  email: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  folder?: string;
};

export type MailProviderKind = "gmail" | "imap-smtp";

export type ProviderCapabilities = {
  supportsServerSideThreads: boolean;
  supportsLabels: boolean;
  supportsServerSideSearch: boolean;
  supportsPushSync: boolean;
  supportsProviderOAuth: boolean;
  usesSmtpSend: boolean;
};

export type MailAccountProviderInfo = {
  kind: MailProviderKind;
  label: string;
  capabilities: ProviderCapabilities;
};

export type MailAccountSummary = {
  id: string;
  label: string;
  email: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  defaultFolder: string;
  isActive: boolean;
  isDefault: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  provider: MailAccountProviderInfo;
};

export type MailSummary = {
  accountId?: string;
  uid: number;
  messageId: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string;
  authResultsDmarc?: "pass" | "fail" | "none";
  authResultsSpf?: "pass" | "fail" | "softfail" | "none";
  authResultsDkim?: "pass" | "fail" | "none";
  listUnsubscribeUrl?: string;
  listUnsubscribeEmail?: string;
  from: string;
  fromAddress: string;
  cc?: string;
  to: string[];
  subject: string;
  preview: string;
  date: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  hasAttachments: boolean;
};

export type ReceivedMessageMedia = {
  id: string;
  filename: string;
  contentType: string;
  contentDisposition: "inline" | "attachment";
  contentId?: string;
  role: "inline-image" | "image-attachment" | "attachment";
  viewerEligible: boolean;
  sourceUrl: string;
  saveUrl: string;
};

export type MailDetail = MailSummary & {
  text: string;
  html: string;
  emailBody: string;
  media?: ReceivedMessageMedia[];
};

export type MailFolder = {
  path: string;
  name: string;
  specialUse: string | null;
  count: number | null;
  unread: number | null;
};

export type MailComposePayload = MailConnectionPayload & {
  fromAddress?: string;
  fromName?: string;
  to: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
    cid?: string;
    contentDisposition?: "inline" | "attachment";
  }>;
};

export type MailUpdatePayload = MailConnectionPayload & {
  folder: string;
  action: "toggleSeen" | "delete" | "move";
  seen?: boolean;
  destinationFolder?: string;
};

export type DeleteSenderPayload = MailConnectionPayload & {
  senderEmail: string;
};

export type BulkDeletePayload = MailConnectionPayload & {
  folder: string;
  uids: number[];
  moveToTrash?: boolean;
};

export type MailFlagPayload = MailConnectionPayload & {
  folder: string;
  uids: number[];
  flag: "\\Seen" | "\\Flagged" | "\\Answered";
  action: "add" | "remove";
};

export type ConnectAccountInput = MailConnectionPayload & {
  label?: string;
};

export type ConnectedAccount = {
  id?: string;
  label?: string;
  email: string;
  defaultFolder: string;
  provider: MailAccountProviderInfo;
};

export type SyncMailboxInput = {
  accountId: string;
  folderPath: string;
};

export type SyncMailboxResult = {
  mailbox: MailFolder;
  messages: MailSummary[];
};

export type ProviderThread = {
  providerThreadId: string;
  messages: MailSummary[];
  latestMessage: MailSummary | null;
};

export type ProviderSearchInput = {
  accountId: string;
  folderPath?: string;
  mailboxType?: "system" | "folder" | "label";
  sourceKind?: "folder" | "label";
  mailboxSystemKey?: string;
  query: string;
};

export type ProviderSearchResult = {
  messages: MailSummary[];
};
