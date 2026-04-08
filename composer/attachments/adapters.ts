import type {
  AttachmentState,
  RemoveAttachmentInput
} from "@/composer/attachments/types";

export interface ComposeAttachmentPipelineAdapter {
  openFilePicker(): void;
  openPhotoPicker(): void;
  readFileAsDataUrl(file: File): Promise<string>;
  appendAttachments(files: File[]): void;
  insertInlinePhoto(input: {
    file: File;
    dataUrl: string;
    range?: Range | null;
    alt?: string;
  }): void;
  removeAttachment(input: RemoveAttachmentInput): void | Promise<void>;
  getAttachmentState(draftId?: string): AttachmentState[] | Promise<AttachmentState[]>;
}
