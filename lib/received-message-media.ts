import type { ReceivedMessageMedia } from "@/lib/mail-types";

type ParsedAttachmentLike = {
  filename?: string | null;
  contentType?: string | null;
  contentDisposition?: string | null;
  contentId?: string | null;
  content?: Buffer | null;
};

function normalizeContentId(value?: string | null) {
  return value?.trim().replace(/^<|>$/g, "") || undefined;
}

function buildDataUrl(contentType: string, content?: Buffer | null) {
  if (!content || content.length === 0) {
    return "";
  }

  return `data:${contentType};base64,${content.toString("base64")}`;
}

export function normalizeReceivedMessageMedia(
  attachments: ParsedAttachmentLike[]
): ReceivedMessageMedia[] {
  const media: ReceivedMessageMedia[] = [];

  attachments.forEach((attachment, index) => {
    const contentType = attachment.contentType?.trim() || "application/octet-stream";
    const contentDisposition =
      attachment.contentDisposition?.toLowerCase() === "inline" ? "inline" : "attachment";
    const contentId = normalizeContentId(attachment.contentId);
    const filename = attachment.filename?.trim() || contentId || `attachment-${index + 1}`;
    const isImage = contentType.toLowerCase().startsWith("image/");
    const role =
      contentDisposition === "inline" && isImage
        ? "inline-image"
        : isImage
          ? "image-attachment"
          : "attachment";
    const dataUrl = buildDataUrl(contentType, attachment.content);
    const cidUrl = contentId ? `cid:${contentId}` : "";
    const sourceUrl = role === "inline-image" ? dataUrl || cidUrl : dataUrl;
    const saveUrl = dataUrl || sourceUrl;

    if (!sourceUrl) {
      return;
    }

    media.push({
      id: contentId || `${contentDisposition}:${filename}:${index}`,
      filename,
      contentType,
      contentDisposition,
      contentId,
      role,
      viewerEligible: isImage,
      sourceUrl,
      saveUrl
    });
  });

  return media;
}
