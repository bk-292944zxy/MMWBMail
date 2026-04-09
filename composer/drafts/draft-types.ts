import type { AttachmentState } from "@/composer/attachments/types";
import type { ComposeContentState } from "@/composer/content/types";
import type {
  ComposeSessionContext,
  DraftIdentitySnapshot
} from "@/composer/identity/session-context";
import type { ComposeIdentityState } from "@/composer/identity/types";
import type { ComposeIntent } from "@/composer/session/compose-intent";
import type { ComposeSourceMessageMeta } from "@/composer/session/compose-session-types";

export type DraftAutosaveStatus =
  | "idle"
  | "unsaved"
  | "saving"
  | "saved"
  | "failed";

export type StoredDraftAttachment = AttachmentState & {
  dataUrl: string;
};

export type PendingAiTransformSession = {
  transformId: string;
  draftId: string;
  composeSessionId?: string | null;
  target: "selection" | "draft";
  strategy: "replace" | "insert_below";
  sourceSelectionText?: string | null;
  originalTextBody: string;
  originalHtmlBody: string;
  rewrittenText: string;
  appliedTextBody: string;
  appliedHtmlBody: string;
  baseRevision: number;
  createdAt: string;
};

export type StoredComposerDraft = {
  version: 2;
  draftId: string;
  accountId?: string;
  composeSessionContext?: ComposeSessionContext | null;
  draftIdentitySnapshot?: DraftIdentitySnapshot | null;
  composeIdentity?: ComposeIdentityState | null;
  composeContentState?: ComposeContentState | null;
  composeIntent?: ComposeIntent;
  sourceMessageMeta?: ComposeSourceMessageMeta | null;
  subject: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo?: string;
  htmlBody: string;
  textBody: string;
  signature: string;
  attachments: StoredDraftAttachment[];
  pendingAiTransform?: PendingAiTransformSession | null;
  autosaveStatus: DraftAutosaveStatus;
  lastSavedRevision: number;
  localRevision: number;
  updatedAt: string;
  providerDraftId?: string | null;
  savedAt?: string;
};

export type LegacyStoredDraft = {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  savedAt?: string;
};

export type DraftSnapshotInput = {
  draftId: string;
  accountId?: string;
  composeSessionContext?: ComposeSessionContext | null;
  draftIdentitySnapshot?: DraftIdentitySnapshot | null;
  composeIdentity?: ComposeIdentityState | null;
  composeContentState?: ComposeContentState | null;
  composeIntent?: ComposeIntent;
  sourceMessageMeta?: ComposeSourceMessageMeta | null;
  subject: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo?: string;
  htmlBody: string;
  textBody: string;
  signature: string;
  attachments: StoredDraftAttachment[];
  pendingAiTransform?: PendingAiTransformSession | null;
  localRevision: number;
  lastSavedRevision: number;
};

export type LoadDraftInput = {
  storageKey: string;
};

export type LoadDraftResult = {
  draft: StoredComposerDraft | null;
  raw: string | null;
};

export type SaveDraftInput = {
  storageKey: string;
  draft: DraftSnapshotInput;
  requestId: number;
};

export type SaveDraftResult = {
  draft: StoredComposerDraft;
  requestId: number;
  savedRevision: number;
  savedAt: string;
};

export type MarkLocalDirtyInput = {
  draftId: string;
  localRevision: number;
};

export type RecoverDraftInput = LoadDraftInput;
export type RecoverDraftResult = LoadDraftResult;

export type DraftStatusState = {
  status: DraftAutosaveStatus;
  lastSavedRevision: number;
  localRevision: number;
  inFlightRequestId: number | null;
  error?: string | null;
  savedAt?: string | null;
};
