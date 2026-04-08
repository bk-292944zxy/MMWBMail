import {
  getComposeRecipientDedupeKey,
  normalizeRecipientGroups,
  normalizeRecipientStrings,
  parseComposeRecipient,
  parseComposeRecipientList,
  serializeComposeRecipient
} from "@/composer/recipients/normalizer";
import type { MailDetail } from "@/lib/mail-types";

export function deriveReplyRecipients(message: MailDetail) {
  const sender = parseComposeRecipient(message.fromAddress || message.from || "");

  return {
    to: sender?.valid ? [serializeComposeRecipient(sender)] : [],
    cc: [],
    bcc: []
  };
}

export function deriveReplyAllRecipients(
  message: MailDetail,
  options?: {
    selfAddresses?: string[];
  }
) {
  const sender = parseComposeRecipient(message.fromAddress || message.from || "");
  const selfKeys = new Set(
    parseComposeRecipientList(options?.selfAddresses ?? [])
      .filter((recipient) => recipient.valid)
      .map((recipient) => getComposeRecipientDedupeKey(recipient))
  );

  const to = sender?.valid && !selfKeys.has(getComposeRecipientDedupeKey(sender))
    ? [serializeComposeRecipient(sender)]
    : [];

  const ccPool = [
    ...parseComposeRecipientList(message.to)
      .filter(
        (recipient) =>
          recipient.valid &&
          !selfKeys.has(getComposeRecipientDedupeKey(recipient)) &&
          recipient.normalized !== sender?.normalized
      )
      .map(serializeComposeRecipient),
    ...parseComposeRecipientList(message.cc)
      .filter(
        (recipient) =>
          recipient.valid &&
          !selfKeys.has(getComposeRecipientDedupeKey(recipient)) &&
          recipient.normalized !== sender?.normalized
      )
      .map(serializeComposeRecipient)
  ];

  const normalized = normalizeRecipientGroups({
    to,
    cc: ccPool,
    bcc: []
  }, {
    excludeAddresses: Array.from(selfKeys)
  });

  if (normalized.to.length > 0) {
    return normalized;
  }

  const fallback = normalizeRecipientStrings([
    ...parseComposeRecipientList(message.to)
      .filter((recipient) => recipient.valid && !selfKeys.has(getComposeRecipientDedupeKey(recipient)))
      .map(serializeComposeRecipient),
    ...parseComposeRecipientList(message.cc)
      .filter((recipient) => recipient.valid && !selfKeys.has(getComposeRecipientDedupeKey(recipient)))
      .map(serializeComposeRecipient)
  ]);

  return {
    to: fallback.slice(0, 1),
    cc: fallback.slice(1),
    bcc: []
  };
}

export function deriveEditAsNewRecipients(message: MailDetail) {
  return normalizeRecipientGroups({
    to: normalizeRecipientStrings(message.to),
    cc: normalizeRecipientStrings(message.cc),
    bcc: []
  });
}
