import type { ComposeSessionContext } from "@/composer/identity/session-context";
import type { ComposeIntent } from "@/composer/session/compose-intent";
import type { ComposeIdentityState } from "@/composer/identity/types";
import type { ComposeContentState } from "@/composer/content/types";

export type ComposeSourceMessageMeta = {
  accountId?: string;
  uid: number;
  messageId: string | null;
  from: string;
  fromAddress: string;
  subject: string;
  date: string;
};

export type ComposeSessionUIState = {
  showCc: boolean;
  showBcc: boolean;
  showReplyTo: boolean;
  plainText: boolean;
};

export type ComposeSessionInit = {
  draftId: string;
  accountId?: string;
  context: ComposeSessionContext;
  identity: ComposeIdentityState | null;
  content: ComposeContentState | null;
  intent: ComposeIntent;
  sourceMessageMeta: ComposeSourceMessageMeta | null;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  signature: string;
  ui: ComposeSessionUIState;
};
