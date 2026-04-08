import type { MailDetail } from "@/lib/mail-types";
import type { ComposeSourceMessageMeta } from "@/composer/session/compose-session-types";

function stripHtmlToText(html: string) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function getMessageBodyText(message: MailDetail) {
  const source = message.text || message.html || message.emailBody || message.preview || "";
  return message.text?.trim() ? message.text : stripHtmlToText(source);
}

export function getComposeSourceMessageMeta(message: MailDetail): ComposeSourceMessageMeta {
  return {
    accountId: message.accountId,
    uid: message.uid,
    messageId: message.messageId ?? null,
    from: message.from ?? "",
    fromAddress: message.fromAddress ?? "",
    subject: message.subject ?? "",
    date: message.date ?? ""
  };
}
