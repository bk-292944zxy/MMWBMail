import type {
  ComposeIdentityResolutionInput,
  ComposeIdentityState,
  ComposeSenderIdentity,
  ResolvedSendIdentity
} from "@/composer/identity/types";
import {
  resolveComposeSessionAccountId,
  type ComposeSessionContext
} from "@/composer/identity/session-context";
import type { MailAccountSummary } from "@/lib/mail-types";

function getAccountDisplayName(account: MailAccountSummary) {
  const trimmedLabel = account.label.trim();
  if (trimmedLabel && trimmedLabel.toLowerCase() !== account.email.trim().toLowerCase()) {
    return trimmedLabel;
  }

  return account.email.split("@")[0] ?? account.email;
}

export function createComposeSenderIdentityFromAccount(
  account: MailAccountSummary
): ComposeSenderIdentity {
  const displayName = getAccountDisplayName(account);
  return {
    id: `account:${account.id}:primary`,
    kind: "account",
    accountId: account.id,
    address: account.email,
    displayName,
    label: `${displayName} <${account.email}>`,
    isDefault: account.isDefault
  };
}

export function buildAvailableComposeSenders(
  accounts: MailAccountSummary[]
): ComposeSenderIdentity[] {
  return accounts.map(createComposeSenderIdentityFromAccount);
}

export function resolveAvailableSessionSenders(
  accounts: MailAccountSummary[],
  ownerAccountId?: string,
  ownerLocked?: boolean
) {
  const ownerAccount =
    ownerAccountId
      ? accounts.find((account) => account.id === ownerAccountId) ?? null
      : null;

  if (ownerLocked ?? Boolean(ownerAccountId)) {
    return ownerAccount ? buildAvailableComposeSenders([ownerAccount]) : [];
  }

  return buildAvailableComposeSenders(accounts);
}

function resolvePreferredSender(
  availableSenders: ComposeSenderIdentity[],
  preferredAccountId?: string,
  persistedIdentity?: Partial<ComposeIdentityState> | null
) {
  const persistedSenderId = persistedIdentity?.sender?.id;
  if (persistedSenderId) {
    const persistedMatch = availableSenders.find((sender) => sender.id === persistedSenderId);
    if (persistedMatch) {
      return persistedMatch;
    }

    return null;
  }

  if (preferredAccountId) {
    const preferredMatch = availableSenders.find(
      (sender) => sender.accountId === preferredAccountId
    );
    if (preferredMatch) {
      return preferredMatch;
    }
  }

  return (
    availableSenders.find((sender) => sender.isDefault) ??
    availableSenders[0] ??
    null
  );
}

export function resolveDefaultSenderIdentity(
  availableSenders: ComposeSenderIdentity[],
  preferredAccountId?: string,
  persistedIdentity?: Partial<ComposeIdentityState> | null
) {
  return resolvePreferredSender(availableSenders, preferredAccountId, persistedIdentity);
}

export function resolveComposeIdentityState(
  input: ComposeIdentityResolutionInput
): ComposeIdentityState {
  const ownerLocked = input.ownerLocked ?? Boolean(input.ownerAccountId);
  const ownerAccount =
    input.ownerAccountId
      ? input.accounts.find((account) => account.id === input.ownerAccountId) ?? null
      : null;
  const availableSenders = resolveAvailableSessionSenders(
    input.accounts,
    input.ownerAccountId,
    ownerLocked
  );
  const sender = resolveDefaultSenderIdentity(
    availableSenders,
    input.ownerAccountId ?? input.preferredAccountId,
    input.persistedIdentity
  );
  const accountId =
    input.ownerAccountId ??
    sender?.accountId ??
    input.preferredAccountId ??
    input.persistedIdentity?.accountId;
  const replyTo =
    input.persistedIdentity?.replyTo ??
    input.persistedReplyTo ??
    "";
  const ownerStatus =
    input.ownerAccountId && !ownerAccount ? "missing_account" : "ready";
  const senderStatus =
    input.persistedIdentity?.sender?.id && !sender ? "missing_sender" : "ready";

  return {
    accountId,
    ownerAccountId: input.ownerAccountId ?? accountId,
    ownerStatus,
    senderStatus,
    ownerLocked,
    sender,
    availableSenders,
    replyTo,
    capabilityFlags: {
      canSwitchAccount: !ownerLocked && availableSenders.length > 1,
      canChooseSender: availableSenders.length > 1,
      supportsAliases: availableSenders.some((sender) => sender.kind === "alias"),
      canEditReplyTo: ownerStatus === "ready"
    },
    signatureContextId: sender?.id ?? null
  };
}

export function getComposeAccountForIdentity(
  accounts: MailAccountSummary[],
  identity: ComposeIdentityState | null
) {
  const accountId = identity?.ownerAccountId ?? identity?.accountId;
  if (!accountId) {
    return null;
  }

  return accounts.find((account) => account.id === accountId) ?? null;
}

export function resolveSendIdentityForSession(
  sessionContext: ComposeSessionContext | null,
  identity: ComposeIdentityState | null,
  fallbackReplyTo = ""
): ResolvedSendIdentity | null {
  if (
    !identity?.sender ||
    sessionContext?.ownerStatus === "missing_account" ||
    identity.senderStatus === "missing_sender"
  ) {
    return null;
  }

  const accountId = resolveComposeSessionAccountId(sessionContext, identity);

  if (!accountId) {
    return null;
  }

  return {
    accountId,
    senderId: identity.sender.id,
    fromAddress: identity.sender.address,
    fromName: identity.sender.displayName,
    replyTo: identity.replyTo || fallbackReplyTo
  };
}
