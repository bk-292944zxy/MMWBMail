import type { MailAccountSummary } from "@/lib/mail-types";
import type { ComposeSessionOwnerStatus } from "@/composer/identity/session-context";

export type ComposeIdentityKind = "account" | "alias";

export type ComposeSenderIdentity = {
  id: string;
  kind: ComposeIdentityKind;
  accountId?: string;
  address: string;
  displayName: string;
  label: string;
  isDefault: boolean;
};

export type ComposeIdentityCapabilityFlags = {
  canSwitchAccount: boolean;
  canChooseSender: boolean;
  supportsAliases: boolean;
  canEditReplyTo: boolean;
};

export type ComposeIdentityState = {
  accountId?: string;
  ownerAccountId?: string;
  ownerStatus: ComposeSessionOwnerStatus;
  senderStatus: "ready" | "missing_sender";
  ownerLocked: boolean;
  sender: ComposeSenderIdentity | null;
  availableSenders: ComposeSenderIdentity[];
  replyTo: string;
  capabilityFlags: ComposeIdentityCapabilityFlags;
  signatureContextId: string | null;
};

export type ComposeIdentityResolutionInput = {
  accounts: MailAccountSummary[];
  preferredAccountId?: string;
  ownerAccountId?: string;
  ownerLocked?: boolean;
  persistedIdentity?: Partial<ComposeIdentityState> | null;
  persistedReplyTo?: string;
};

export type ResolvedSendIdentity = {
  accountId: string;
  senderId: string;
  fromAddress: string;
  fromName: string;
  replyTo: string;
};
