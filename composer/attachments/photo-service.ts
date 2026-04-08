import type { ComposeAttachmentPipelineAdapter } from "@/composer/attachments/adapters";
import type {
  AttachPhotosInput,
  AttachPhotosResult,
  ComposePhotoService
} from "@/composer/attachments/types";

export function createComposePhotoService(
  adapter: ComposeAttachmentPipelineAdapter
): ComposePhotoService {
  return {
    requestAttachPhotos() {
      adapter.openPhotoPicker();
    },
    async attachPhotos(input: AttachPhotosInput): Promise<AttachPhotosResult> {
      for (const [index, file] of input.files.entries()) {
        const dataUrl = await adapter.readFileAsDataUrl(file);
        adapter.insertInlinePhoto({
          file,
          dataUrl,
          range: input.range,
          alt: input.altResolver?.(file, index)
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
    }
  };
}
