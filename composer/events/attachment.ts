import type { ComposeEventAttachmentState } from "@/composer/events/types";

export function upsertComposeEventAttachment(
  attachments: File[],
  nextAttachment: File,
  replaceIndex: number | null
) {
  if (replaceIndex === null || replaceIndex < 0 || replaceIndex >= attachments.length) {
    return [...attachments, nextAttachment];
  }

  const next = [...attachments];
  next[replaceIndex] = nextAttachment;
  return next;
}

export function findComposeEventAttachmentIndex(
  attachments: File[],
  attachmentState: ComposeEventAttachmentState | null,
  attachmentIds: WeakMap<File, string>
) {
  if (!attachmentState) {
    return -1;
  }

  return attachments.findIndex((file) => {
    const fileAttachmentId = attachmentIds.get(file);
    if (fileAttachmentId && fileAttachmentId === attachmentState.attachmentId) {
      return true;
    }

    return file.name === attachmentState.fileName && file.type.startsWith("text/calendar");
  });
}
