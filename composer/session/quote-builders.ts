import type { MailDetail } from "@/lib/mail-types";
import { getMessageBodyText } from "@/composer/session/message-to-compose";

function formatMessageDate(date: string) {
  return date ? new Date(date).toLocaleString() : "";
}

export function getReplySubject(subject: string) {
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

export function getForwardSubject(subject: string) {
  return /^fwd:/i.test(subject) ? subject : `Fwd: ${subject}`;
}

export function buildNewMessageBody(signature: string) {
  return `\n\n${signature}`;
}

export function buildReplyBody(message: MailDetail, signature: string) {
  const from = message.from ?? message.fromAddress ?? "";
  const date = formatMessageDate(message.date);
  const source = getMessageBodyText(message);
  return `\n\n${signature}\n\n---\nOn ${date}, ${from} wrote:\n\n${source}`;
}

export function buildForwardBody(message: MailDetail, signature: string) {
  const from = message.from ?? message.fromAddress ?? "";
  const date = formatMessageDate(message.date);
  const source = getMessageBodyText(message);

  return `\n\n${signature}\n\n---\n---------- Forwarded message ----------\nFrom: ${from}\nDate: ${date}\nSubject: ${message.subject}\n\n${source}`;
}

export function buildEditAsNewBody(message: MailDetail) {
  return getMessageBodyText(message);
}
