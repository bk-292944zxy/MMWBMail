import type { ComposerCommand } from "@/composer/commands/types";

export function createAttachmentCommands(): ComposerCommand[] {
  return [
    {
      id: "attach_file",
      label: "Attach",
      icon: "attach",
      group: "attachments",
      isEnabled: (ctx) => ctx.capabilityFlags.canAttachFiles,
      run: (ctx) => {
        ctx.attachments?.attachmentService.requestAttachFiles();
      }
    },
    {
      id: "insert_image",
      label: "Image",
      icon: "image",
      group: "attachments",
      isEnabled: (ctx) => ctx.capabilityFlags.canInsertImages,
      run: (ctx) => {
        ctx.attachments?.photoService.requestAttachPhotos();
      }
    }
  ];
}
