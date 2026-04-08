import type { MailProviderKind, ProviderCapabilities } from "@/lib/mail-types";

export type MailActionKind =
  | "archive"
  | "delete"
  | "mark_read"
  | "mark_unread"
  | "star"
  | "unstar"
  | "spam"
  | "not_spam"
  | "move"
  | "restore";

export type MailActionTarget =
  | {
      scope: "message";
      messageUids: number[];
    }
  | {
      scope: "conversation";
      conversationId: string;
      messageUids: number[];
    };

export type MailActionRequest = {
  kind: MailActionKind;
  accountId: string;
  folderPath: string;
  target: MailActionTarget;
  destinationFolder?: string;
};

export type MailActionCapability = {
  supported: boolean;
  reason?: string;
  destinationFolder?: string;
};

export type MailActionCapabilityMap = Record<MailActionKind, MailActionCapability>;

export type MailActionStatusPhase = "idle" | "running" | "succeeded" | "failed";

export type MailActionStatus = {
  key: string;
  phase: MailActionStatusPhase;
  request: MailActionRequest;
  error?: string;
};

export type MailActionExecutionResult = {
  statusMessage: string;
  toastMessage?: string;
  refreshFolderCounts: boolean;
};

export type MailActionContext = {
  providerKind?: MailProviderKind;
  providerCapabilities: ProviderCapabilities;
  currentFolderPath: string;
  currentMailboxSystemKey?: string | null;
  availableFolderPaths: string[];
};
