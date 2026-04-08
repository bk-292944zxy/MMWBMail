import type { MailSummary } from "@/lib/mail-types";

import type {
  ConversationCollection,
  ConversationEntity,
  ConversationKeySource,
  ConversationSortKey,
  ConversationSummary,
  NormalizedMessageEntity
} from "@/lib/conversations/types";

function normalizeConversationSubject(subject: string) {
  return subject.replace(/^(Re|Fwd|Fw):\s*/gi, "").trim().toLowerCase();
}

function displayParticipantLabel(value: string) {
  const match = value.match(/^(.+?)\s*</);

  if (match) {
    return match[1].trim();
  }

  return value.includes("@") ? value.split("@")[0] : value.trim();
}

function resolveConversationKey(message: MailSummary): {
  id: string;
  source: ConversationKeySource;
} {
  if (message.threadId?.trim()) {
    return {
      id: `thread:${message.threadId.trim()}`,
      source: "providerThreadId"
    };
  }

  if (message.references?.trim()) {
    const firstReference = message.references
      .split(/\s+/)
      .map((entry) => entry.trim())
      .find(Boolean);

    if (firstReference) {
      return {
        id: `ref:${firstReference}`,
        source: "references"
      };
    }
  }

  if (message.inReplyTo?.trim()) {
    return {
      id: `reply:${message.inReplyTo.trim()}`,
      source: "inReplyTo"
    };
  }

  const normalizedSubject = normalizeConversationSubject(message.subject);
  if (normalizedSubject) {
    return {
      id: `subject:${normalizedSubject}`,
      source: "subject"
    };
  }

  return {
    id: `message:${message.messageId || message.uid}`,
    source: "messageId"
  };
}

function compareConversationMessages(left: MailSummary, right: MailSummary) {
  const leftTime = new Date(left.date).getTime();
  const rightTime = new Date(right.date).getTime();

  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.uid - right.uid;
}

function compareConversationSummaries(
  left: ConversationSummary,
  right: ConversationSummary,
  sortBy: ConversationSortKey
) {
  if (sortBy === "name") {
    return left.latestMessage.senderLabel.localeCompare(right.latestMessage.senderLabel);
  }

  if (sortBy === "subject") {
    const leftSubject = left.subject || left.normalizedSubject;
    const rightSubject = right.subject || right.normalizedSubject;
    return leftSubject.localeCompare(rightSubject);
  }

  return new Date(right.latestDate).getTime() - new Date(left.latestDate).getTime();
}

function createNormalizedMessageEntity(
  message: MailSummary,
  conversationId: string,
  keySource: ConversationKeySource
): NormalizedMessageEntity {
  return {
    id: `message:${message.uid}`,
    uid: message.uid,
    conversationId,
    keySource,
    senderLabel: displayParticipantLabel(message.from),
    preview: message.preview,
    receivedAt: message.date,
    seen: message.seen,
    raw: message
  };
}

export function buildConversationCollection(
  messages: MailSummary[],
  sortBy: ConversationSortKey
): ConversationCollection {
  const groups = new Map<
    string,
    { keySource: ConversationKeySource; messages: MailSummary[] }
  >();

  for (const message of messages) {
    const key = resolveConversationKey(message);
    const currentGroup = groups.get(key.id);

    if (currentGroup) {
      currentGroup.messages.push(message);
      continue;
    }

    groups.set(key.id, {
      keySource: key.source,
      messages: [message]
    });
  }

  const byId = new Map<string, ConversationEntity>();
  const byMessageUid = new Map<number, string>();

  const entities = Array.from(groups.entries())
    .map(([conversationId, group]) => {
      const orderedMessages = [...group.messages]
        .sort(compareConversationMessages)
        .map((message) =>
          createNormalizedMessageEntity(message, conversationId, group.keySource)
        );
      const latestMessage = orderedMessages[orderedMessages.length - 1];
      const participantLabels = Array.from(
        new Set(orderedMessages.map((message) => message.senderLabel))
      );

      const entity: ConversationEntity = {
        id: conversationId,
        subject:
          latestMessage.raw.subject ||
          normalizeConversationSubject(latestMessage.raw.subject),
        normalizedSubject: normalizeConversationSubject(latestMessage.raw.subject),
        messages: orderedMessages,
        latestMessage,
        latestDate: latestMessage.receivedAt,
        unreadCount: orderedMessages.filter((message) => !message.seen).length,
        messageCount: orderedMessages.length,
        participantLabels,
        preview: latestMessage.preview
      };

      byId.set(entity.id, entity);
      for (const message of orderedMessages) {
        byMessageUid.set(message.uid, entity.id);
      }

      return entity;
    })
    .sort((left, right) =>
      compareConversationSummaries(
        {
          ...left,
          hasMultipleMessages: left.messageCount > 1
        },
        {
          ...right,
          hasMultipleMessages: right.messageCount > 1
        },
        sortBy
      )
    );

  const summaries: ConversationSummary[] = entities.map((entity) => ({
    id: entity.id,
    subject: entity.subject,
    normalizedSubject: entity.normalizedSubject,
    latestMessage: entity.latestMessage,
    latestDate: entity.latestDate,
    unreadCount: entity.unreadCount,
    messageCount: entity.messageCount,
    participantLabels: entity.participantLabels,
    preview: entity.preview,
    hasMultipleMessages: entity.messageCount > 1
  }));

  return {
    entities,
    summaries,
    byId,
    byMessageUid
  };
}
