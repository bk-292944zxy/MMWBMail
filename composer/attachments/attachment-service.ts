import type { ComposeAttachmentPipelineAdapter } from "@/composer/attachments/adapters";
import type {
  AttachFilesInput,
  AttachFilesResult,
  ComposeAttachmentService,
  ComposePhotoService,
  RemoveAttachmentInput
} from "@/composer/attachments/types";

export function createComposeAttachmentService(
  adapter: ComposeAttachmentPipelineAdapter,
  photoService: ComposePhotoService
): ComposeAttachmentService {
  return {
    requestAttachFiles() {
      adapter.openFilePicker();
    },
    async attachFiles(input: AttachFilesInput): Promise<AttachFilesResult> {
      const photos = input.files.filter((file) => file.type.startsWith("image/"));
      const files = input.files.filter((file) => !file.type.startsWith("image/"));

      if (files.length > 0) {
        adapter.appendAttachments(files);
      }

      if (photos.length > 0) {
        await photoService.attachPhotos({
          draftId: input.draftId,
          files: photos,
          source: input.source
        });
      }

      const attachmentState = await adapter.getAttachmentState(input.draftId);
      return {
        added: attachmentState.filter((attachment) =>
          input.files.some(
            (file) =>
              file.name === attachment.name &&
              file.size === attachment.size &&
              file.type === attachment.type
          )
        )
      };
    },
    async removeAttachment(input: RemoveAttachmentInput) {
      await adapter.removeAttachment(input);
    },
    async getAttachmentState(draftId?: string) {
      return await adapter.getAttachmentState(draftId);
    }
  };
}
