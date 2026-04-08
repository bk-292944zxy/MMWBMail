export type ComposeAttachmentKind = "file" | "photo";
export type ComposeAttachmentSource =
  | "picker"
  | "toolbar"
  | "paste"
  | "drop"
  | "restore"
  | "unknown";

export interface AttachmentState {
  draftId?: string;
  attachmentId: string;
  name: string;
  size: number;
  type: string;
  kind: ComposeAttachmentKind;
  inline: boolean;
}

export interface AttachFilesInput {
  draftId?: string;
  files: File[];
  source?: ComposeAttachmentSource;
}

export interface AttachFilesResult {
  added: AttachmentState[];
}

export interface AttachPhotosInput {
  draftId?: string;
  files: File[];
  source?: ComposeAttachmentSource;
  range?: Range | null;
  altResolver?: (file: File, index: number) => string;
}

export interface AttachPhotosResult {
  added: AttachmentState[];
}

export interface RemoveAttachmentInput {
  draftId?: string;
  file?: File;
  index?: number;
  attachmentId?: string;
  filename?: string;
  removeInlineElement?: boolean;
}

export interface ReorderAttachmentsInput {
  draftId?: string;
  fromIndex: number;
  toIndex: number;
}

export interface ComposePhotoService {
  requestAttachPhotos(): void;
  attachPhotos(input: AttachPhotosInput): Promise<AttachPhotosResult>;
}

export interface ComposeAttachmentService {
  requestAttachFiles(): void;
  attachFiles(input: AttachFilesInput): Promise<AttachFilesResult>;
  removeAttachment(input: RemoveAttachmentInput): Promise<void>;
  reorderAttachments?(input: ReorderAttachmentsInput): Promise<void>;
  getAttachmentState(draftId?: string): Promise<AttachmentState[]>;
}
