import type { ComposeSessionContext } from "@/composer/identity/session-context";
import type { ComposeIdentityState } from "@/composer/identity/types";
import type { ComposeContentState } from "@/composer/content/types";
import type { StoredComposerDraft } from "@/composer/drafts/draft-types";
import {
  createDraftResumeIntent,
  createMessageComposeIntent,
  createNewComposeIntent,
  type MessageComposeIntentKind
} from "@/composer/session/compose-intent";
import { getComposeSourceMessageMeta } from "@/composer/session/message-to-compose";
import {
  buildEditAsNewBody,
  buildForwardBody,
  buildNewMessageBody,
  buildReplyBody,
  getForwardSubject,
  getReplySubject
} from "@/composer/session/quote-builders";
import {
  deriveEditAsNewRecipients,
  deriveReplyAllRecipients,
  deriveReplyRecipients
} from "@/composer/session/recipient-derivation";
import type { ComposeSessionInit } from "@/composer/session/compose-session-types";
import { normalizeRecipientGroups } from "@/composer/recipients/normalizer";
import type { MailDetail } from "@/lib/mail-types";

type ComposeSessionBaseOptions = {
  draftId: string;
  accountId?: string;
  context: ComposeSessionContext;
  identity: ComposeIdentityState | null;
  content: ComposeContentState | null;
  signature: string;
  currentAccountEmail?: string | null;
};

function buildSessionSelfAddresses(
  identity: ComposeIdentityState | null,
  currentAccountEmail?: string | null
) {
  return [
    identity?.sender?.address ?? "",
    identity?.replyTo ?? "",
    currentAccountEmail ?? ""
  ].filter(Boolean);
}

export function createNewComposeSession(
  options: ComposeSessionBaseOptions
): ComposeSessionInit {
  return {
    draftId: options.draftId,
    accountId: options.accountId,
    context: options.context,
    identity: options.identity,
    content: options.content,
    intent: createNewComposeIntent(),
    sourceMessageMeta: null,
    to: [],
    cc: [],
    bcc: [],
    replyTo: "",
    subject: "",
    textBody: buildNewMessageBody(options.signature),
    signature: options.signature,
    ui: {
      showCc: false,
      showBcc: false,
      showReplyTo: false,
      plainText: false
    }
  };
}

export function createMessageComposeSession(
  kind: MessageComposeIntentKind,
  message: MailDetail,
  options: ComposeSessionBaseOptions
): ComposeSessionInit {
  const sourceMessageMeta = getComposeSourceMessageMeta(message);

  if (kind === "reply") {
    const recipients = deriveReplyRecipients(message);
    return {
      draftId: options.draftId,
      accountId: options.accountId,
      context: options.context,
      identity: options.identity,
      content: options.content,
      intent: createMessageComposeIntent(kind, message.uid, message.messageId),
      sourceMessageMeta,
      ...recipients,
      replyTo: "",
      subject: getReplySubject(message.subject),
      textBody: buildReplyBody(message, options.signature),
      signature: options.signature,
      ui: {
        showCc: false,
        showBcc: false,
        showReplyTo: false,
        plainText: false
      }
    };
  }

  if (kind === "reply_all") {
    const recipients = deriveReplyAllRecipients(message, {
      selfAddresses: buildSessionSelfAddresses(options.identity, options.currentAccountEmail)
    });
    return {
      draftId: options.draftId,
      accountId: options.accountId,
      context: options.context,
      identity: options.identity,
      content: options.content,
      intent: createMessageComposeIntent(kind, message.uid, message.messageId),
      sourceMessageMeta,
      ...recipients,
      replyTo: "",
      subject: getReplySubject(message.subject),
      textBody: buildReplyBody(message, options.signature),
      signature: options.signature,
      ui: {
        showCc: recipients.cc.length > 0,
        showBcc: false,
        showReplyTo: false,
        plainText: false
      }
    };
  }

  if (kind === "forward") {
    return {
      draftId: options.draftId,
      accountId: options.accountId,
      context: options.context,
      identity: options.identity,
      content: options.content,
      intent: createMessageComposeIntent(kind, message.uid, message.messageId),
      sourceMessageMeta,
      to: [],
      cc: [],
      bcc: [],
      replyTo: "",
      subject: getForwardSubject(message.subject),
      textBody: buildForwardBody(message, options.signature),
      signature: options.signature,
      ui: {
        showCc: false,
        showBcc: false,
        showReplyTo: false,
        plainText: false
      }
    };
  }

  const recipients = deriveEditAsNewRecipients(message);
  return {
    draftId: options.draftId,
    accountId: options.accountId,
    context: options.context,
    identity: options.identity,
    content: options.content,
    intent: createMessageComposeIntent(kind, message.uid, message.messageId),
    sourceMessageMeta,
    ...recipients,
    replyTo: "",
    subject: message.subject ?? "",
    textBody: buildEditAsNewBody(message),
    signature: options.signature,
    ui: {
      showCc: recipients.cc.length > 0,
      showBcc: false,
      showReplyTo: false,
      plainText: false
    }
  };
}

export function createDraftResumeComposeSession(
  draft: StoredComposerDraft
): ComposeSessionInit {
  const recipients = normalizeRecipientGroups({
    to: draft.to ?? [],
    cc: draft.cc ?? [],
    bcc: draft.bcc ?? []
  });

  return {
    draftId: draft.draftId,
    accountId: draft.accountId,
    context:
      draft.composeSessionContext ?? {
        sessionId: draft.draftId,
        ownerAccountId: draft.accountId,
        ownerLocked: Boolean(draft.accountId),
        ownerStatus: "ready",
        initializationSource: "draft_resume",
        sourceAccountId: draft.sourceMessageMeta?.accountId ?? null,
        sourceMessageId: draft.sourceMessageMeta?.messageId ?? null,
        sourceMessageUid: draft.sourceMessageMeta?.uid ?? null
      },
    identity: draft.composeIdentity ?? null,
    content: draft.composeContentState ?? null,
    intent: draft.composeIntent ?? createDraftResumeIntent(draft.draftId),
    sourceMessageMeta: draft.sourceMessageMeta ?? null,
    to: recipients.to,
    cc: recipients.cc,
    bcc: recipients.bcc,
    replyTo: draft.replyTo ?? "",
    subject: draft.subject ?? "",
    textBody: draft.textBody ?? "",
    htmlBody: draft.htmlBody ?? "",
    signature: draft.signature ?? "",
    ui: {
      showCc: (draft.cc?.length ?? 0) > 0,
      showBcc: (draft.bcc?.length ?? 0) > 0,
      showReplyTo: Boolean(draft.replyTo),
      plainText: false
    }
  };
}
