import type { ConversationCollection, ConversationSummary } from "@/lib/conversations/types";
import type { MailboxNode } from "@/lib/mailbox-navigation";
import type { MailSummary } from "@/lib/mail-types";

export type MailboxViewMode = "classic" | "new-mail";
export type InboxAttentionView = "new-mail" | "read";

export type SidebarMailboxTarget = {
  id: string;
  accountId: string;
  providerPath: string;
  name: string;
  count: number | null;
  unread: number | null;
  isVirtual: boolean;
  inboxAttentionView: InboxAttentionView | null;
  mailboxNode: MailboxNode;
};

export function isInboxMailboxNode(node: Pick<MailboxNode, "systemKey"> | null | undefined) {
  return node?.systemKey === "inbox";
}

export function resolveInboxAttentionView(input: {
  mailboxViewMode: MailboxViewMode;
  mailboxNode: Pick<MailboxNode, "systemKey"> | null | undefined;
  inboxAttentionView: InboxAttentionView | null;
}) {
  if (input.mailboxViewMode !== "new-mail" || !isInboxMailboxNode(input.mailboxNode)) {
    return null;
  }

  return input.inboxAttentionView ?? "new-mail";
}

export function buildSidebarMailboxTargets(
  mailboxNodes: MailboxNode[],
  input: {
    mailboxViewMode: MailboxViewMode;
    inboxCountsByPath?: Record<
      string,
      {
        newMailCount: number;
        readCount: number;
      }
    >;
  }
) {
  const targets: SidebarMailboxTarget[] = [];

  for (const mailboxNode of mailboxNodes) {
    if (input.mailboxViewMode === "new-mail" && isInboxMailboxNode(mailboxNode)) {
      const counts = input.inboxCountsByPath?.[mailboxNode.identity.providerPath];
      const unreadCount = counts?.newMailCount ?? mailboxNode.unread ?? 0;
      const totalCount = counts?.readCount ?? Math.max((mailboxNode.count ?? 0) - unreadCount, 0);

      targets.push({
        id: `${mailboxNode.identity.id}::new-mail`,
        accountId: mailboxNode.identity.accountId,
        providerPath: mailboxNode.identity.providerPath,
        name: "New Mail",
        count: unreadCount,
        unread: unreadCount,
        isVirtual: true,
        inboxAttentionView: "new-mail",
        mailboxNode
      });
      targets.push({
        id: `${mailboxNode.identity.id}::read`,
        accountId: mailboxNode.identity.accountId,
        providerPath: mailboxNode.identity.providerPath,
        name: "Read Mail",
        count: totalCount,
        unread: 0,
        isVirtual: true,
        inboxAttentionView: "read",
        mailboxNode
      });
      continue;
    }

    targets.push({
      id: mailboxNode.identity.id,
      accountId: mailboxNode.identity.accountId,
      providerPath: mailboxNode.identity.providerPath,
      name: mailboxNode.name,
      count: mailboxNode.count,
      unread: mailboxNode.unread,
      isVirtual: false,
      inboxAttentionView: null,
      mailboxNode
    });
  }

  return targets;
}

export function filterMessagesForInboxAttentionView(
  messages: MailSummary[],
  attentionView: InboxAttentionView | null
) {
  if (!attentionView) {
    return messages;
  }

  return messages.filter((message) =>
    attentionView === "new-mail" ? !message.seen : message.seen
  );
}

export function filterConversationSummariesForInboxAttentionView(
  conversations: ConversationCollection,
  attentionView: InboxAttentionView | null
) {
  if (!attentionView) {
    return conversations.summaries;
  }

  return conversations.summaries.filter((summary) => {
    const entity = conversations.byId.get(summary.id);
    if (!entity) {
      return false;
    }

    const hasUnread = entity.messages.some((message) => !message.raw.seen);
    return attentionView === "new-mail" ? hasUnread : !hasUnread;
  });
}

export function buildInboxAttentionCounts(
  messages: MailSummary[],
  threadingEnabled: boolean,
  conversations: ConversationCollection
) {
  if (threadingEnabled) {
    let newMailCount = 0;
    let readCount = 0;

    for (const summary of conversations.summaries) {
      const entity = conversations.byId.get(summary.id);
      const hasUnread = entity?.messages.some((message) => !message.raw.seen) ?? false;
      if (hasUnread) {
        newMailCount += 1;
      } else {
        readCount += 1;
      }
    }

    return { newMailCount, readCount };
  }

  let newMailCount = 0;
  let readCount = 0;

  for (const message of messages) {
    if (message.seen) {
      readCount += 1;
    } else {
      newMailCount += 1;
    }
  }

  return { newMailCount, readCount };
}

export function getNewMailEmptyMessage(attentionView: InboxAttentionView, isSearch: boolean) {
  if (isSearch) {
    return attentionView === "new-mail"
      ? "No new mail matches this search yet."
      : "No read inbox mail matches this search yet.";
  }

  return attentionView === "new-mail"
    ? "No new inbox mail needs attention right now."
    : "No read inbox mail in this view yet.";
}
