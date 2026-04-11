import type { ExistingEditorAdapter } from "@/composer/adapters/existing-editor-adapter";
import type {
  ComposeAttachmentService,
  ComposePhotoService
} from "@/composer/attachments/types";
import type { ComposePresetDefinition } from "@/composer/content/types";

export type SelectionState = {
  hasSelection: boolean;
  text: string;
  isCollapsed: boolean;
};

export type ComposeState = {
  plainText: boolean;
  subject: string;
  body: string;
  attachmentCount: number;
  toCount: number;
  ccCount: number;
  bccCount: number;
};

export type ComposeCapabilityFlags = {
  canAttachFiles: boolean;
  canInsertImages: boolean;
  canPrintDraft: boolean;
  canScheduleSend: boolean;
  canUseRichText: boolean;
};

export interface ComposerCommandContext {
  editor: ExistingEditorAdapter;
  accountId?: string;
  draftId?: string;
  selectionState: SelectionState;
  composeState: ComposeState;
  capabilityFlags: ComposeCapabilityFlags;
  attachments?: {
    attachmentService: ComposeAttachmentService;
    photoService: ComposePhotoService;
  };
  events?: {
    openComposeEventBuilder: () => void;
  };
  content?: {
    activeSignatureLabel: string;
    activeSignatureText: string;
    presets: ComposePresetDefinition[];
    insertSignature: () => void;
    insertPresetById: (presetId: string) => void;
  };
  ai?: {
    openRewriteAssistant: () => void;
  };
}
