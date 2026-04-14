import type { ComposeIdentityState, ComposeSenderIdentity } from "@/composer/identity/types";
import type { MailAccountSummary } from "@/lib/mail-types";

export type MailboxContextScope = "none" | "account" | "unified";
export type ComposeSessionInitializationSource =
  | "new"
  | "reply"
  | "reply_all"
  | "forward"
  | "edit_as_new"
  | "draft_resume";

export type ConnectedComposeAccount = {
  accountId: string;
  provider: MailAccountSummary["provider"]["kind"];
  capabilities: MailAccountSummary["provider"]["capabilities"];
  emailAddress: string;
  displayName: string;
  label: string;
  availableSenderIds: string[];
  defaultSenderId: string | null;
};

export type MailboxContext = {
  scope: MailboxContextScope;
  activeAccountId?: string;
  activeAccount: ConnectedComposeAccount | null;
};

export type ComposeSessionOwnerStatus = "ready" | "missing_account";

export type ComposeSessionContext = {
  sessionId: string;
  ownerAccountId?: string;
  ownerLocked: boolean;
  ownerStatus: ComposeSessionOwnerStatus;
  initializationSource: ComposeSessionInitializationSource;
  sourceAccountId?: string | null;
  sourceMessageId?: string | null;
  sourceMessageUid?: number | null;
};

export type DraftIdentitySnapshot = {
  ownerAccountId?: string;
  senderId?: string | null;
  replyTo?: string;
  ownerLocked?: boolean;
};

export type RestoreDraftIdentityResult = {
  context: ComposeSessionContext;
  blockedReason: string | null;
};

function findAccountById(
  accounts: MailAccountSummary[],
  accountId?: string | null
) {
  if (!accountId) {
    return null;
  }

  return accounts.find((account) => account.id === accountId) ?? null;
}

function getAccountDisplayName(account: MailAccountSummary) {
  const trimmedLabel = account.label.trim();
  if (trimmedLabel && trimmedLabel.toLowerCase() !== account.email.trim().toLowerCase()) {
    return trimmedLabel;
  }

  return account.email.split("@")[0] ?? account.email;
}

export function createConnectedComposeAccount(
  account: MailAccountSummary
): ConnectedComposeAccount {
  const primarySenderId = `account:${account.id}:primary`;

  return {
    accountId: account.id,
    provider: account.provider.kind,
    capabilities: account.provider.capabilities,
    emailAddress: account.email,
    displayName: getAccountDisplayName(account),
    label: account.label,
    availableSenderIds: [primarySenderId],
    defaultSenderId: primarySenderId
  };
}

export function resolveMailboxContext(
  accounts: MailAccountSummary[],
  activeAccountId?: string | null
): MailboxContext {
  if (!activeAccountId) {
    return {
      scope: "none",
      activeAccount: null
    };
  }

  const account = accounts.find((entry) => entry.id === activeAccountId) ?? null;
  return {
    scope: account ? "account" : "none",
    activeAccountId,
    activeAccount: account ? createConnectedComposeAccount(account) : null
  };
}

export function getActiveMailboxAccount(mailboxContext: MailboxContext | null) {
  return mailboxContext?.activeAccount ?? null;
}

export function resolveDefaultComposeOwner(
  accounts: MailAccountSummary[],
  mailboxContext?: MailboxContext | null,
  preferredAccountId?: string | null
) {
  return (
    findAccountById(accounts, preferredAccountId)?.id ??
    findAccountById(accounts, mailboxContext?.activeAccountId)?.id ??
    accounts.find((account) => account.isDefault)?.id ??
    accounts[0]?.id
  );
}

export function resolveComposeOwnerAccountId(input: {
  accounts: MailAccountSummary[];
  mailboxContext?: MailboxContext | null;
  sourceAccountId?: string | null;
  sessionAccountId?: string | null;
  preferredAccountId?: string | null;
}) {
  return (
    findAccountById(input.accounts, input.sourceAccountId)?.id ??
    findAccountById(input.accounts, input.sessionAccountId)?.id ??
    resolveDefaultComposeOwner(
      input.accounts,
      input.mailboxContext,
      input.preferredAccountId
    )
  );
}

export function resolveNewComposeOwner(
  accounts: MailAccountSummary[],
  mailboxContext: MailboxContext,
  preferredAccountId?: string | null
) {
  return resolveComposeOwnerAccountId({
    accounts,
    mailboxContext,
    preferredAccountId
  });
}

export function resolveReplyOwner(
  accounts: MailAccountSummary[],
  sourceAccountId?: string | null,
  mailboxContext?: MailboxContext | null,
  sessionAccountId?: string | null
) {
  return resolveComposeOwnerAccountId({
    accounts,
    mailboxContext,
    sourceAccountId,
    sessionAccountId
  });
}

export function createComposeSessionContext(input: {
  sessionId: string;
  ownerAccountId?: string | null;
  ownerLocked?: boolean;
  initializationSource: ComposeSessionInitializationSource;
  sourceAccountId?: string | null;
  sourceMessageId?: string | null;
  sourceMessageUid?: number | null;
  accounts: MailAccountSummary[];
}): ComposeSessionContext {
  const ownerAccountId = input.ownerAccountId ?? undefined;
  const hasOwner = ownerAccountId
    ? input.accounts.some((account) => account.id === ownerAccountId)
    : false;

  return {
    sessionId: input.sessionId,
    ownerAccountId,
    ownerLocked: input.ownerLocked ?? Boolean(ownerAccountId),
    ownerStatus: ownerAccountId && !hasOwner ? "missing_account" : "ready",
    initializationSource: input.initializationSource,
    sourceAccountId: input.sourceAccountId ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    sourceMessageUid: input.sourceMessageUid ?? null
  };
}

export function restoreDraftIdentity(
  accounts: MailAccountSummary[],
  snapshot?: DraftIdentitySnapshot | null,
  options?: {
    sessionId?: string;
    sourceAccountId?: string | null;
    sourceMessageId?: string | null;
    sourceMessageUid?: number | null;
  }
): RestoreDraftIdentityResult {
  const context = createComposeSessionContext({
    sessionId: options?.sessionId ?? "draft-resume",
    accounts,
    ownerAccountId: snapshot?.ownerAccountId,
    ownerLocked: snapshot?.ownerLocked ?? true,
    initializationSource: "draft_resume",
    sourceAccountId: options?.sourceAccountId,
    sourceMessageId: options?.sourceMessageId,
    sourceMessageUid: options?.sourceMessageUid
  });

  return {
    context,
    blockedReason:
      context.ownerStatus === "missing_account" && context.ownerAccountId
        ? "This draft belongs to a missing or disconnected account."
        : null
  };
}

export function canUseIdentity(
  sessionContext: ComposeSessionContext | null,
  sender: ComposeSenderIdentity | null
) {
  if (!sender) {
    return false;
  }

  if (!sessionContext?.ownerLocked) {
    return true;
  }

  return sender.accountId === sessionContext.ownerAccountId;
}

export function createDraftIdentitySnapshot(
  sessionContext: ComposeSessionContext | null,
  identity: ComposeIdentityState | null
): DraftIdentitySnapshot | null {
  if (!sessionContext && !identity) {
    return null;
  }

  return {
    ownerAccountId: sessionContext?.ownerAccountId ?? identity?.ownerAccountId,
    senderId: identity?.sender?.id ?? null,
    replyTo: identity?.replyTo ?? "",
    ownerLocked: sessionContext?.ownerLocked ?? identity?.ownerLocked ?? false
  };
}
