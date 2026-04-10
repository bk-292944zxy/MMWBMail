import type { ComposeContentState } from "@/composer/content/types";
import type { DraftAutosaveStatus, StoredComposerDraft } from "@/composer/drafts/draft-types";
import type { ComposeSessionContext } from "@/composer/identity/session-context";
import type { ComposeIdentityState } from "@/composer/identity/types";
import type { ComposeIntent } from "@/composer/session/compose-intent";
import type { ComposeSourceMessageMeta } from "@/composer/session/compose-session-types";

export type ComposePresentationMode = "docked" | "floating";

export type ComposeSessionRecipientsState = {
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string;
};

export type ComposeSessionDraftLifecycleState = {
  draftId: string | null;
  restoredDraft: StoredComposerDraft | null;
  status: DraftAutosaveStatus;
  savedAt: string | null;
  error: string | null;
  localRevision: number;
  lastSavedRevision: number;
};

export type ComposeSessionPresentationState = {
  mode: ComposePresentationMode;
  isOpen: boolean;
  isMinimized: boolean;
  position: { x: number; y: number } | null;
  size: {
    width: number;
    height: number;
  };
};

export type ActiveComposeSession = {
  sessionId: string | null;
  intent: ComposeIntent;
  context: ComposeSessionContext | null;
  identity: ComposeIdentityState | null;
  content: ComposeContentState | null;
  sourceMessageMeta: ComposeSourceMessageMeta | null;
  recipients: ComposeSessionRecipientsState;
  subject: string;
  body: {
    text: string;
    plainText: boolean;
  };
  signature: string;
  attachments: {
    files: File[];
    totalCount: number;
    photoCount: number;
    fileCount: number;
  };
  draft: ComposeSessionDraftLifecycleState;
  presentation: ComposeSessionPresentationState;
};

type CreateActiveComposeSessionInput = {
  draftId: string | null;
  context: ComposeSessionContext | null;
  identity: ComposeIdentityState | null;
  content: ComposeContentState | null;
  intent: ComposeIntent;
  sourceMessageMeta: ComposeSourceMessageMeta | null;
  recipients: ComposeSessionRecipientsState;
  subject: string;
  bodyText: string;
  plainText: boolean;
  signature: string;
  attachments: File[];
  restoredDraft: StoredComposerDraft | null;
  draftStatus: DraftAutosaveStatus;
  draftSavedAt: string | null;
  draftError: string | null;
  localRevision: number;
  lastSavedRevision: number;
  presentationMode: ComposePresentationMode;
  isOpen: boolean;
  isMinimized: boolean;
  position: { x: number; y: number } | null;
  width: number;
  height: number;
};

export function createActiveComposeSession(
  input: CreateActiveComposeSessionInput
): ActiveComposeSession {
  return {
    sessionId: input.context?.sessionId ?? input.draftId,
    intent: input.intent,
    context: input.context,
    identity: input.identity,
    content: input.content,
    sourceMessageMeta: input.sourceMessageMeta,
    recipients: input.recipients,
    subject: input.subject,
    body: {
      text: input.bodyText,
      plainText: input.plainText
    },
    signature: input.signature,
    attachments: {
      files: input.attachments,
      totalCount: input.attachments.length,
      photoCount: input.attachments.filter((file) => file.type.startsWith("image/")).length,
      fileCount: input.attachments.filter((file) => !file.type.startsWith("image/")).length
    },
    draft: {
      draftId: input.draftId,
      restoredDraft: input.restoredDraft,
      status: input.draftStatus,
      savedAt: input.draftSavedAt,
      error: input.draftError,
      localRevision: input.localRevision,
      lastSavedRevision: input.lastSavedRevision
    },
    presentation: {
      mode: input.presentationMode,
      isOpen: input.isOpen,
      isMinimized: input.isMinimized,
      position: input.position,
      size: {
        width: input.width,
        height: input.height
      }
    }
  };
}
