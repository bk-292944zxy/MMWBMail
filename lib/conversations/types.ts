import type { MailSummary } from "@/lib/mail-types";

export type ConversationSortKey = "date" | "name" | "subject";

export type ConversationKeySource =
  | "providerThreadId"
  | "inReplyTo"
  | "references"
  | "subject"
  | "messageId";

export type NormalizedMessageEntity = {
  id: string;
  uid: number;
  conversationId: string;
  keySource: ConversationKeySource;
  senderLabel: string;
  preview: string;
  receivedAt: string;
  seen: boolean;
  raw: MailSummary;
};

export type ConversationEntity = {
  id: string;
  subject: string;
  normalizedSubject: string;
  messages: NormalizedMessageEntity[];
  latestMessage: NormalizedMessageEntity;
  latestDate: string;
  unreadCount: number;
  messageCount: number;
  participantLabels: string[];
  preview: string;
};

export type ConversationSummary = {
  id: string;
  subject: string;
  normalizedSubject: string;
  latestMessage: NormalizedMessageEntity;
  latestDate: string;
  unreadCount: number;
  messageCount: number;
  participantLabels: string[];
  preview: string;
  hasMultipleMessages: boolean;
};

export type ConversationCollection = {
  entities: ConversationEntity[];
  summaries: ConversationSummary[];
  byId: Map<string, ConversationEntity>;
  byMessageUid: Map<number, string>;
};

export type ConversationSelectionState = {
  selectedConversationId: string | null;
  selectedMessageUid: number | null;
};

export type ConversationViewState = {
  expandedConversationIds: Set<string>;
  expandedMessageUids: Set<number>;
};
