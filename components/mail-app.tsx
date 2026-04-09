"use client";

import {
  Fragment,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";

import { createExistingEditorAdapter } from "@/composer/adapters/existing-editor-adapter";
import { createComposeAttachmentService } from "@/composer/attachments/attachment-service";
import type { ComposeAttachmentPipelineAdapter } from "@/composer/attachments/adapters";
import { createComposePhotoService } from "@/composer/attachments/photo-service";
import type {
  AttachmentState,
  ComposeAttachmentService,
  ComposePhotoService
} from "@/composer/attachments/types";
import {
  buildScopedSignatureDefinition,
  resolveComposeContentState,
  upsertSignatureDefinition
} from "@/composer/content/resolver";
import type {
  ComposeContentState,
  ComposePresetDefinition,
  ComposeSignatureDefinition
} from "@/composer/content/types";
import { COMPOSER_COMMANDS } from "@/composer/commands/registry";
import type { ComposerCommand, ComposerCommandId } from "@/composer/commands/types";
import { buildComposerCommandContext } from "@/composer/context/build-command-context";
import {
  getComposeAccountForIdentity,
  resolveComposeIdentityState,
  resolveSendIdentityForSession
} from "@/composer/identity/resolver";
import {
  canUseIdentity,
  createComposeSessionContext,
  createDraftIdentitySnapshot,
  resolveMailboxContext,
  resolveNewComposeOwner,
  resolveReplyOwner,
  resolveDefaultComposeOwner,
  restoreDraftIdentity,
  type ComposeSessionContext
} from "@/composer/identity/session-context";
import type { ComposeIdentityState } from "@/composer/identity/types";
import type {
  ComposeCapabilityFlags,
  ComposeState,
  SelectionState
} from "@/composer/context/types";
import { createLocalStorageDraftAdapter, dataUrlToFile, fileToDataUrl } from "@/composer/drafts/draft-adapters";
import { createAutosaveService, type AutosaveService } from "@/composer/drafts/autosave-service";
import { createDraftService } from "@/composer/drafts/draft-service";
import type {
  DraftAutosaveStatus,
  DraftSnapshotInput,
  StoredComposerDraft
} from "@/composer/drafts/draft-types";
import {
  loadComposerToolbarPreferences,
  moveToolbarCommand,
  persistComposerToolbarPreferences,
  resetComposerToolbarPreferences,
  toggleToolbarCommandHidden,
  type ComposerToolbarPreferences
} from "@/composer/preferences/toolbar-preferences";
import {
  createDraftResumeComposeSession,
  createMessageComposeSession,
  createNewComposeSession
} from "@/composer/session/compose-session-initializer";
import type { ComposeIntent, MessageComposeIntentKind } from "@/composer/session/compose-intent";
import {
  appendNormalizedRecipientInput,
  normalizeRecipientGroups,
  normalizeStructuredRecipientGroups,
  normalizeRecipientStrings,
  recipientListIncludesValue,
  serializeStructuredRecipientGroups
} from "@/composer/recipients/normalizer";
import type { ComposeRecipientBucket } from "@/composer/recipients/types";
import type {
  ComposeSessionInit,
  ComposeSourceMessageMeta
} from "@/composer/session/compose-session-types";
import { buildConversationCollection } from "@/lib/conversations/resolver";
import type {
  ConversationSelectionState,
  ConversationSortKey,
  ConversationViewState
} from "@/lib/conversations/types";
import { resolveMailActionCapabilities } from "@/lib/message-actions/capabilities";
import {
  buildMailActionKey,
  executeMailActionRequest
} from "@/lib/message-actions/executor";
import {
  createMailboxQueryState,
  filterMessagesForMailboxQuery,
  getMailboxEmptyMessage,
  getMailboxResultState,
  normalizeMailboxSearchText,
  shouldResetSelectionForMailboxQueryChange,
  type MailboxQueryState
} from "@/lib/mailbox-query";
import {
  buildInboxAttentionCounts,
  buildSidebarMailboxTargets,
  filterConversationSummariesForInboxAttentionView,
  filterMessagesForInboxAttentionView,
  isInboxMailboxNode,
  resolveInboxAttentionView
} from "@/lib/new-mail-view";
import type {
  InboxAttentionView,
  MailboxViewMode,
  SidebarMailboxTarget
} from "@/lib/new-mail-view";
import {
  buildVisibleMessageRequestKey,
  createPendingMailMutation,
  pruneExpiredMailMutations,
  reconcileMessagesWithPendingMutations,
  reconcileVisibleSelection,
  type PendingMailMutation
} from "@/lib/mail-state-reconcile";
import {
  findMailboxNodeByPath,
  resolveMailboxNodes
} from "@/lib/mailbox-navigation";
import type {
  MailActionCapabilityMap,
  MailActionRequest,
  MailActionStatus
} from "@/lib/message-actions/types";
import type {
  MailAccountSummary,
  MailComposePayload,
  MailConnectionPayload,
  MailDetail,
  MailFolder,
  MailSummary,
  ReceivedMessageMedia
} from "@/lib/mail-types";
import {
  getSortFolderPresetByMailbox,
  getSortFolderPresentation,
  getSortFolderTooltip,
  SORT_FOLDER_PRESETS,
  type SortFolderPreset
} from "@/lib/sort-folders";
import { detectSpoof, detectUnverifiedSender } from "@/lib/sender-verification";

type SortKey = ConversationSortKey;
type PrintScope = "message" | "thread";
type PrintFormat = "print" | "pdf";
type BulkSelectionMenu = "sort" | "more" | null;
type ResponsiveInteractionMode = "desktop-workspace" | "mobile-stacked";
type MobileStackedScreen = "mailboxes" | "messages" | "viewer";
type SenderFilterScope = "general" | "prioritized";
type ScrollBridgedFrame = HTMLIFrameElement & {
  __mmwbmailScrollCleanup?: () => void;
};

type LightboxBridgedFrame = HTMLIFrameElement & {
  __mmwbmailLightboxCleanup?: () => void;
};

const WORKSPACE_MIN_SIDEBAR_WIDTH = 280;
const WORKSPACE_MIN_LIST_WIDTH = 320;
const WORKSPACE_MIN_VIEWER_WIDTH = 340;
const WORKSPACE_DIVIDER_WIDTH = 8;
const WORKSPACE_WIDE_BREAKPOINT = 1200;
const NEW_MAIL_AUTO_READ_DWELL_MS = 60_000;
const NEW_MAIL_SORT_PENDING_MUTATION_TTL_MS = 90_000;
const NEW_MAIL_EXIT_ANIMATION_MS = 140;

type LightboxImage = {
  src: string;
  saveSrc: string;
  alt: string;
};

type CropRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type CropHandle = "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";
type BrowserContactRecord = {
  name?: string[];
  email?: string[];
};
type LoadMessagesOptions = {
  force?: boolean;
  manageBusy?: boolean;
  accountIdOverride?: string;
  preserveSelection?: boolean;
  skipServerSync?: boolean;
};

const USER_DATA_VERSION = 3;
const DB_NAME = "mmwbmail";
const DB_VERSION = 1;
const STORE_MESSAGES = "messages";
const STORE_META = "meta";
const DRAFT_STORAGE_KEY = "mmwbmail-draft";

interface UserData {
  version: number;
  recentRecipients: string[];
  prioritizedSenders: { name: string; email: string; color: string }[];
  autoFilters: {
    senderName: string;
    senderEmail: string;
    keepDays: 1 | 7 | 30 | 60 | 90;
    createdAt: string;
  }[];
  blockedSenders: string[];
  pinnedMessages: string[];
  signatureDefinitions: ComposeSignatureDefinition[];
  presetDefinitions: ComposePresetDefinition[];
  prefs: {
    sidebarSize: "small" | "medium" | "large";
    signature: string;
    threadingEnabled: boolean;
    mailboxViewMode: MailboxViewMode;
    collapsedSortFolderVisibility: "essential_only" | "include_active_sort_folders";
    accountMailboxDisclosureStates: Record<string, AccountMailboxDisclosureState>;
    lightweightOnboardingDismissed: boolean;
  };
}

const DEFAULT_USER_DATA: UserData = {
  version: USER_DATA_VERSION,
  recentRecipients: [],
  prioritizedSenders: [],
  autoFilters: [],
  blockedSenders: [],
  pinnedMessages: [],
  signatureDefinitions: [],
  presetDefinitions: [],
  prefs: {
    sidebarSize: "medium",
    signature: "— Ben",
    threadingEnabled: true,
    mailboxViewMode: "classic",
    collapsedSortFolderVisibility: "essential_only",
    accountMailboxDisclosureStates: {},
    lightweightOnboardingDismissed: false
  }
};

type CachedMailSummary = MailSummary & {
  id: string;
  folder: string;
};

type DomainVerificationState = {
  domain: string;
  dmarcPolicy: string | null;
  bimiVerified: boolean;
  bimiLogoUrl: string | null;
  trancoRank: number | null;
  isEsp: boolean;
};

type SenderTrustTier = "red" | "amber" | "blue" | "verified";

type SenderTrustPresentation = {
  tier: SenderTrustTier;
  label: string;
  icon: string;
  summary: string;
  detail: string;
  signals: string[];
};

type SmartMailboxEmptyState = {
  eyebrow?: string;
  title: string;
  message: string;
  hint?: string;
};

type TrustAwareMessage = Pick<
  MailSummary,
  "from" | "fromAddress" | "authResultsDmarc" | "authResultsSpf"
>;

function makeCachedMessageId(uid: number, folder: string, accountId: string) {
  return `${accountId}:${folder}:${uid}`;
}

function resolveSenderTrustPresentation(
  message: TrustAwareMessage,
  domainVerification?: Pick<
    DomainVerificationState,
    "bimiVerified" | "domain" | "dmarcPolicy" | "isEsp" | "trancoRank"
  > | null
): SenderTrustPresentation {
  const spoof = detectSpoof(message);
  if (spoof.isSpoofed) {
    return {
      tier: "red",
      label: "High Risk",
      icon: "⚠",
      summary: "This sender looks unsafe.",
      detail: spoof.reason,
      signals: []
    };
  }

  const unverified = detectUnverifiedSender(message, domainVerification);
  if (unverified.isUnverified) {
    return {
      tier: "amber",
      label: "Caution",
      icon: "!",
      summary: "The sender identity could not be confirmed.",
      detail: unverified.reason,
      signals: unverified.signals
    };
  }

  if (domainVerification?.bimiVerified) {
    return {
      tier: "verified",
      label: "Verified",
      icon: "✓",
      summary: "This sender passed our strongest trust checks.",
      detail:
        "This sender passed domain verification checks and looks consistent with the organization it claims to be from.",
      signals: []
    };
  }

  return {
    tier: "blue",
    label: "Known Sender",
    icon: "•",
    summary: "No strong warning signals were detected.",
    detail:
      "We did not find a strong sender warning for this message, but the sender has not been fully verified.",
    signals: []
  };
}

function getSpecializedMailboxEmptyState(input: {
  mode: MailboxQueryState["mode"];
  attentionView: InboxAttentionView | null;
  sortPreset: SortFolderPreset | null;
  prioritizedSenderName: string | null;
}): SmartMailboxEmptyState | null {
  if (input.prioritizedSenderName) {
    return input.mode === "search"
      ? {
          eyebrow: "Prioritized Sender",
          title: `No messages from ${displaySender(input.prioritizedSenderName)}`,
          message: "This focused sender view only shows mail from people you chose to keep close at hand.",
          hint: "Empty can be normal here. New messages from this sender will appear as they arrive."
        }
      : {
          eyebrow: "Prioritized Sender",
          title: `Nothing from ${displaySender(input.prioritizedSenderName)} right now`,
          message: "This space keeps one important sender in focus without the rest of the inbox crowding in.",
          hint: "Quiet is good here. It fills when this sender writes you."
        };
  }

  if (input.attentionView === "new-mail") {
    return input.mode === "search"
      ? {
          eyebrow: "New Mail",
          title: "No New Mail matches",
          message: "New Mail is your active attention space for unread inbox messages that still need a look.",
          hint: "If it’s empty, you may already be caught up."
        }
      : {
          eyebrow: "New Mail",
          title: "You’re caught up",
          message: "New Mail holds unread inbox messages that still need your attention.",
          hint: "An empty New Mail view is a good sign."
        };
  }

  if (input.attentionView === "read") {
    return input.mode === "search"
      ? {
          eyebrow: "Read Mail",
          title: "No Read Mail matches",
          message: "Read Mail keeps already-seen inbox messages nearby without mixing them back into active attention.",
          hint: "Try a broader search if you expected something here."
        }
      : {
          eyebrow: "Read Mail",
          title: "No Read Mail yet",
          message: "Read Mail is where inbox messages go once you’ve already looked at them.",
          hint: "This space will fill naturally as you work through New Mail."
        };
  }

  if (input.sortPreset) {
    switch (input.sortPreset.key) {
      case "receipts":
        return input.mode === "search"
          ? {
              eyebrow: "Sort Folder",
              title: "No receipt matches",
              message: "Receipts keeps proof of purchase, invoices, and confirmations easy to retrieve later.",
              hint: "Sort messages here when you want a clean paper trail."
            }
          : {
              eyebrow: "Sort Folder",
              title: "No Receipts yet",
              message: "Receipts is for proof of purchase, invoices, charges, and confirmation mail worth keeping.",
              hint: "Sort mail here when you want it easy to find later."
            };
      case "travel":
        return input.mode === "search"
          ? {
              eyebrow: "Sort Folder",
              title: "No travel matches",
              message: "Travel keeps itineraries, bookings, and trip details together in one retrieval space.",
              hint: "Sort confirmations here so trips stay easy to reconstruct."
            }
          : {
              eyebrow: "Sort Folder",
              title: "No Travel yet",
              message: "Travel is for itineraries, booking confirmations, flights, hotels, and trip details.",
              hint: "It stays quiet until you start filing travel mail into it."
            };
      case "follow_up":
        return input.mode === "search"
          ? {
              eyebrow: "Sort Folder",
              title: "No follow-up matches",
              message: "Follow-Up is for messages you want to revisit intentionally, without leaving them loose in the inbox.",
              hint: "Sort mail here when it needs later action or another look."
            }
          : {
              eyebrow: "Sort Folder",
              title: "Nothing waiting in Follow-Up",
              message: "Follow-Up holds messages that still need attention, but not right this second.",
              hint: "Empty can mean you’ve cleared your pending loose ends."
            };
      case "reference":
        return input.mode === "search"
          ? {
              eyebrow: "Sort Folder",
              title: "No reference matches",
              message: "Reference is for useful information worth keeping, without treating it like active work.",
              hint: "Sort mail here when it should stay accessible but quiet."
            }
          : {
              eyebrow: "Sort Folder",
              title: "No Reference yet",
              message: "Reference keeps useful information nearby without asking for attention.",
              hint: "It fills with the mail you want to keep, not the mail you need to act on."
            };
    }
  }

  return null;
}

function escapeViewerHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildFallbackMessageDetail(message: MailSummary): MailDetail {
  const fallbackText =
    message.preview.trim() || message.subject.trim() || "Loading message body...";
  const escaped = escapeViewerHtml(fallbackText).replace(/\r?\n/g, "<br>");
  const html = `<p>${escaped}</p>`;

  return {
    ...message,
    text: fallbackText,
    html,
    emailBody: `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.6;
        color: #111827;
        background: #ffffff;
      }
      p {
        margin: 0;
      }
    </style>
  </head>
  <body>${html}</body>
</html>`
  };
}

function isLikelyImageUrl(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (
    normalized.startsWith("data:image/") ||
    normalized.startsWith("blob:") ||
    normalized.startsWith("cid:") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://")
  ) {
    return true;
  }

  return /\.(avif|bmp|gif|heic|heif|jpeg|jpg|png|svg|webp)(?:[?#].*)?$/i.test(normalized);
}

function isInlineViewerMedia(item: ReceivedMessageMedia) {
  return item.role === "inline-image" && item.viewerEligible;
}

function stampMessageAccount<T extends MailSummary>(message: T, accountId?: string | null): T {
  if (!accountId || message.accountId === accountId) {
    return message;
  }

  return {
    ...message,
    accountId
  };
}

function stampMessageAccountList<T extends MailSummary>(messages: T[], accountId?: string | null) {
  if (!accountId) {
    return messages;
  }

  return messages.map((message) => stampMessageAccount(message, accountId));
}

function compareMessages(left: MailSummary, right: MailSummary, sortBy: SortKey) {
  if (sortBy === "name") {
    return left.from.localeCompare(right.from);
  }

  if (sortBy === "subject") {
    return left.subject.localeCompare(right.subject);
  }

  return new Date(right.date).getTime() - new Date(left.date).getTime();
}

function isInboxFolder(folder: Pick<MailFolder, "name" | "path" | "specialUse">) {
  if (folder.specialUse === "\\Inbox" || folder.specialUse === "\\\\Inbox") {
    return true;
  }

  const name = folder.name.trim().toLowerCase();
  const path = folder.path.trim().toLowerCase();
  return name === "inbox" || path === "inbox" || path.endsWith("/inbox");
}

function orderFoldersByDefault(folders: MailFolder[]) {
  const inboxFolders: MailFolder[] = [];
  const otherFolders: MailFolder[] = [];

  for (const folder of folders) {
    if (isInboxFolder(folder)) {
      inboxFolders.push(folder);
    } else {
      otherFolders.push(folder);
    }
  }

  return [...inboxFolders, ...otherFolders];
}

type AccountMailboxDisclosureState = 1 | 2 | 3;

type SidebarMailboxDisclosureAnimation = {
  phase: "expanding" | "collapsing";
  previousVisibleIds: string[];
  previousQuietIds: string[];
  currentVisibleIds: string[];
  currentQuietIds: string[];
};

type SidebarMailDragState = {
  accountId: string;
  sourceFolderPath: string;
  target: MailActionRequest["target"];
  messageCount: number;
  clearSelectionOnSuccess: boolean;
};

function isSpamLikeMailboxTarget(target: SidebarMailboxTarget) {
  if (target.mailboxNode.systemKey === "spam") {
    return true;
  }

  const normalizedName = target.name.trim().toLowerCase();
  const normalizedPath = target.mailboxNode.identity.providerPath.trim().toLowerCase();

  return (
    normalizedName === "spam" ||
    normalizedName === "junk" ||
    normalizedPath.includes("spam") ||
    normalizedPath.includes("junk")
  );
}

function isHistoricalMailboxTarget(target: SidebarMailboxTarget) {
  return (
    target.mailboxNode.systemKey === "archive" ||
    target.mailboxNode.systemKey === "drafts" ||
    target.mailboxNode.systemKey === "sent"
  );
}

function isActiveBuiltInSortMailboxTarget(target: SidebarMailboxTarget) {
  if (target.isVirtual) {
    return false;
  }

  if (!getSortFolderPresetByMailbox(target.name, target.mailboxNode.identity.providerPath)) {
    return false;
  }

  return (target.count ?? 0) > 0;
}

function getAccountMailboxDisclosureTargets(
  mailboxTargets: SidebarMailboxTarget[],
  input: {
    disclosureState: AccountMailboxDisclosureState;
    mailboxViewMode: MailboxViewMode;
    activeProviderPath: string | null;
    activeInboxAttentionView: InboxAttentionView | null;
    includeActiveSortFoldersInCollapsed: boolean;
  }
) {
  const essentialTargets =
    input.mailboxViewMode === "new-mail"
      ? mailboxTargets.filter((target) => target.inboxAttentionView !== null)
      : mailboxTargets.filter((target) => isInboxMailboxNode(target.mailboxNode));
  const spamTarget =
    mailboxTargets.find((target) => target.mailboxNode.systemKey === "spam") ??
    mailboxTargets.find((target) => isSpamLikeMailboxTarget(target)) ??
    null;
  const workingTargets = mailboxTargets.filter((target) => !isHistoricalMailboxTarget(target));
  const historicalTargets = mailboxTargets.filter((target) => isHistoricalMailboxTarget(target));
  const activeBuiltInSortTargets = mailboxTargets.filter((target) =>
    isActiveBuiltInSortMailboxTarget(target)
  );

  const activeTarget = mailboxTargets.find(
    (target) =>
      target.mailboxNode.identity.providerPath === input.activeProviderPath &&
      target.inboxAttentionView === input.activeInboxAttentionView
  );

  const dedupeTargets = (targets: SidebarMailboxTarget[]) => {
    const seen = new Set<string>();
    const deduped: SidebarMailboxTarget[] = [];

    for (const target of targets) {
      if (seen.has(target.id)) {
        continue;
      }
      seen.add(target.id);
      deduped.push(target);
    }

    return deduped;
  };

  if (input.disclosureState === 1) {
    const primaryTargets = essentialTargets.length > 0 ? [...essentialTargets] : mailboxTargets.slice(0, 1);
    if (spamTarget) {
      primaryTargets.push(spamTarget);
    }
    if (input.includeActiveSortFoldersInCollapsed) {
      primaryTargets.push(...activeBuiltInSortTargets);
    }
    if (activeTarget) {
      primaryTargets.push(activeTarget);
    }

    return {
      visibleTargets: dedupeTargets(primaryTargets),
      quietTargets: [] as SidebarMailboxTarget[]
    };
  }

  if (input.disclosureState === 2) {
    const expandedTargets = [...workingTargets];
    if (activeTarget) {
      expandedTargets.push(activeTarget);
    }

    return {
      visibleTargets: dedupeTargets(expandedTargets),
      quietTargets: [] as SidebarMailboxTarget[]
    };
  }

  const fullWorkingTargets = [...workingTargets];
  if (activeTarget && !fullWorkingTargets.some((target) => target.id === activeTarget.id)) {
    fullWorkingTargets.push(activeTarget);
  }

  const visibleTargets = dedupeTargets(fullWorkingTargets);
  const visibleTargetIds = new Set(visibleTargets.map((target) => target.id));
  const quietTargets = dedupeTargets(
    historicalTargets.filter((target) => !visibleTargetIds.has(target.id))
  );

  return {
    visibleTargets,
    quietTargets
  };
}

function nextAccountMailboxDisclosureState(current: AccountMailboxDisclosureState) {
  if (current === 1) {
    return 2;
  }

  if (current === 2) {
    return 3;
  }

  return 1;
}

function mergeSidebarMailboxTargetsById(
  mailboxTargets: SidebarMailboxTarget[],
  targetIds: string[]
) {
  if (targetIds.length === 0) {
    return [] as SidebarMailboxTarget[];
  }

  const targetIdSet = new Set(targetIds);
  return mailboxTargets.filter((target) => targetIdSet.has(target.id));
}

function resolveResponsiveInteractionMode(input: {
  viewportWidth: number;
}): ResponsiveInteractionMode {
  return input.viewportWidth > WORKSPACE_WIDE_BREAKPOINT
    ? "desktop-workspace"
    : "mobile-stacked";
}

function resolveMobileStackedScreen(input: {
  hasAccounts: boolean;
  hasActiveMailboxContext: boolean;
  hasSelectedMessage: boolean;
}): MobileStackedScreen {
  if (!input.hasAccounts || !input.hasActiveMailboxContext) {
    return "mailboxes";
  }

  if (input.hasSelectedMessage) {
    return "viewer";
  }

  return "messages";
}

function getMobileMailboxRowHint(input: {
  inboxAttentionView: InboxAttentionView | null;
  sortFolderPresentation: ReturnType<typeof getSortFolderPresentation>;
  isMobileStackedMode: boolean;
}) {
  if (!input.isMobileStackedMode) {
    return null;
  }

  if (input.inboxAttentionView === "new-mail") {
    return "Unread inbox attention";
  }

  if (input.inboxAttentionView === "read") {
    return "Worked-through inbox";
  }

  if (!input.sortFolderPresentation) {
    return null;
  }

  switch (input.sortFolderPresentation.key) {
    case "receipts":
      return "Orders and invoices";
    case "travel":
      return "Trips and bookings";
    case "follow_up":
      return "Needs later attention";
    case "reference":
      return "Worth keeping handy";
    default:
      return "Quick Sort folder";
  }
}

function buildRecipientSuggestion(displayName?: string | null, address?: string | null) {
  const normalizedAddress = address?.trim() ?? "";
  const normalizedDisplay = displayName?.trim() ?? "";

  if (normalizedAddress) {
    if (
      normalizedDisplay &&
      !normalizedDisplay.includes("@") &&
      normalizedDisplay.toLowerCase() !== normalizedAddress.toLowerCase()
    ) {
      return normalizeRecipientStrings(`${normalizedDisplay} <${normalizedAddress}>`)[0] ?? null;
    }

    return normalizeRecipientStrings(normalizedAddress)[0] ?? null;
  }

  const normalized = normalizeRecipientStrings(normalizedDisplay);
  const fallback = normalized[0] ?? null;
  return fallback && fallback.includes("@") ? fallback : null;
}

function mergeRecipientSuggestionLists(existing: string[], incoming: string[]) {
  const merged = normalizeRecipientStrings([...incoming, ...existing]);
  return merged.slice(0, 120);
}

function browserSupportsSystemContacts() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const contactsApi = (
    navigator as Navigator & {
      contacts?: {
        select?: (
          properties: string[],
          options?: { multiple?: boolean }
        ) => Promise<BrowserContactRecord[]>;
      };
    }
  ).contacts;

  return typeof contactsApi?.select === "function";
}

function detectNotificationPlatform(): {
  canWebNotify: boolean;
  canBadge: boolean;
  isIosSafariTab: boolean;
  isInstalledPwa: boolean;
} {
  if (typeof window === "undefined") {
    return {
      canWebNotify: false,
      canBadge: false,
      isIosSafariTab: false,
      isInstalledPwa: false
    };
  }

  const ua = navigator.userAgent;
  const isIos =
    /iPad|iPhone|iPod/.test(ua) &&
    !(window as typeof window & { MSStream?: unknown }).MSStream;
  const isInstalledPwa =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const isIosSafariTab = isIos && !isInstalledPwa;
  const canWebNotify = "Notification" in window && !isIosSafariTab;
  const canBadge = "setAppBadge" in navigator;

  return { canWebNotify, canBadge, isIosSafariTab, isInstalledPwa };
}

function loadUserData(): UserData {
  if (typeof window === "undefined") {
    return DEFAULT_USER_DATA;
  }

  try {
    const raw = window.localStorage.getItem("mmwbmail-userdata");
    if (!raw) {
      return DEFAULT_USER_DATA;
    }

    const parsed = JSON.parse(raw) as Partial<UserData> & { version?: number };

    if (!parsed.version || parsed.version < USER_DATA_VERSION) {
      console.log(
        "mmwbmail: migrating user data from version",
        parsed.version,
        "→",
        USER_DATA_VERSION
      );
      return {
        ...DEFAULT_USER_DATA,
        ...parsed,
        prefs: {
          ...DEFAULT_USER_DATA.prefs,
          ...(parsed.prefs ?? {})
        },
        version: USER_DATA_VERSION
      };
    }

    return {
      ...DEFAULT_USER_DATA,
      ...parsed,
      prefs: {
        ...DEFAULT_USER_DATA.prefs,
        ...(parsed.prefs ?? {})
      }
    };
  } catch {
    return DEFAULT_USER_DATA;
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistUserData(data: UserData) {
  if (typeof window === "undefined") {
    return;
  }

  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistTimer = setTimeout(() => {
    try {
      window.localStorage.setItem("mmwbmail-userdata", JSON.stringify(data));
    } catch (error) {
      console.error("mmwbmail: failed to persist user data", error);
    }
  }, 500);
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const store = db.createObjectStore(STORE_MESSAGES, { keyPath: "id" });
        store.createIndex("folder", "folder", { unique: false });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("from", "from", { unique: false });
        store.createIndex("read", "seen", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function createComposeDraftId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cacheMessages(
  messages: MailSummary[],
  folder: string,
  accountId: string
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_MESSAGES, STORE_META], "readwrite");
    const msgStore = tx.objectStore(STORE_MESSAGES);
    const metaStore = tx.objectStore(STORE_META);
    const folderIndex = msgStore.index("folder");
    const existingKeysRequest = folderIndex.getAllKeys(folder);

    existingKeysRequest.onsuccess = () => {
      const keysToDelete = (existingKeysRequest.result as string[]).filter((key) =>
        key.startsWith(`${accountId}:${folder}:`)
      );

      for (const key of keysToDelete) {
        msgStore.delete(key);
      }

      for (const message of messages) {
        msgStore.put({
          ...message,
          id: makeCachedMessageId(message.uid, folder, accountId),
          folder
        } satisfies CachedMailSummary);
      }

      metaStore.put({
        key: `lastSync:${accountId}:${folder}`,
        value: new Date().toISOString(),
        count: messages.length
      });
    };

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (error) {
    console.error("mmwbmail: cache write failed", error);
  }
}

async function getCachedMessages(folder: string, accountId: string): Promise<MailSummary[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_MESSAGES, "readonly");
    const store = tx.objectStore(STORE_MESSAGES);
    const index = store.index("folder");
    const request = index.getAll(folder);

    return await new Promise((resolve, reject) => {
      request.onsuccess = () => {
        db.close();
        const results = (request.result as CachedMailSummary[])
          .filter((message) => message.id.startsWith(`${accountId}:${folder}:`))
          .map(({ id: _id, folder: _folder, ...message }) => message)
          .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
        resolve(results);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch {
    return [];
  }
}

async function removeCachedMessage(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_MESSAGES, "readwrite");
    tx.objectStore(STORE_MESSAGES).delete(id);
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // Ignore cache deletion failures.
  }
}

async function updateCachedMessage(
  id: string,
  changes: Partial<MailSummary>
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_MESSAGES, "readwrite");
    const store = tx.objectStore(STORE_MESSAGES);
    const request = store.get(id);

    await new Promise<void>((resolve) => {
      request.onsuccess = () => {
        if (request.result) {
          store.put({ ...request.result, ...changes });
        }
      };

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // Ignore cache update failures.
  }
}

async function getCacheTimestamp(folder: string, accountId: string): Promise<string | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_META, "readonly");
    const request = tx.objectStore(STORE_META).get(`lastSync:${accountId}:${folder}`);

    return await new Promise((resolve) => {
      request.onsuccess = () => {
        db.close();
        resolve((request.result as { value?: string } | undefined)?.value ?? null);
      };
      request.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}

async function clearFolderCache(folder: string, accountId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_MESSAGES, STORE_META], "readwrite");
    const store = tx.objectStore(STORE_MESSAGES);
    const index = store.index("folder");
    const metaStore = tx.objectStore(STORE_META);
    const request = index.getAllKeys(folder);

    request.onsuccess = () => {
      const keysToDelete = (request.result as string[]).filter((key) =>
        key.startsWith(`${accountId}:${folder}:`)
      );

      for (const key of keysToDelete) {
        store.delete(key);
      }

      metaStore.delete(`lastSync:${accountId}:${folder}`);
    };

    await new Promise<void>((resolve) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // Ignore cache clear failures.
  }
}

function clearMessageViewState(
  setSelectedUid: React.Dispatch<React.SetStateAction<number | null>>,
  setSelectedMessage: React.Dispatch<React.SetStateAction<MailDetail | null>>,
  setQuery: React.Dispatch<React.SetStateAction<string>>,
  setSenderFilter: React.Dispatch<React.SetStateAction<string | null>>,
  setSubjectFilter: React.Dispatch<React.SetStateAction<string | null>>,
  setSubjectPattern: React.Dispatch<React.SetStateAction<string | null>>
) {
  setSelectedMessage(null);
  setQuery("");
  setSenderFilter(null);
  setSubjectFilter(null);
  setSubjectPattern(null);
  setSelectedUid(null);
}

const defaultConnection: MailConnectionPayload = {
  email: "",
  password: "",
  imapHost: "",
  imapPort: 993,
  imapSecure: true,
  smtpHost: "",
  smtpPort: 465,
  smtpSecure: true,
  folder: "INBOX"
};

function getInMotionPreset(): Partial<MailConnectionPayload> {
  return {
    imapHost: "mail.makingmyworldbetter.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "mail.makingmyworldbetter.com",
    smtpPort: 465,
    smtpSecure: true
  };
}

function getDomainFromEmail(email: string) {
  const [, domain = ""] = email.trim().toLowerCase().split("@");
  return domain;
}

function getConnectionPreset(email: string): Partial<MailConnectionPayload> | null {
  const domain = getDomainFromEmail(email);

  if (domain === "makingmyworldbetter.com") {
    return getInMotionPreset();
  }

  return null;
}

function getActiveEditableElement(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  const el = document.activeElement as HTMLElement | null;
  if (!el) {
    return null;
  }

  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea") {
    return el;
  }

  if (el.isContentEditable || el.contentEditable === "true") {
    return el;
  }

  return null;
}

function execOnEditable(
  command: string,
  value?: string,
  fallbackEl?: HTMLElement | null
): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  const el = getActiveEditableElement() ?? fallbackEl ?? null;
  if (!el) {
    return false;
  }

  el.focus();
  return document.execCommand(command, false, value);
}

function queryEditableCommandValue(
  command: string,
  fallbackEl?: HTMLElement | null
): string {
  if (typeof document === "undefined") {
    return "";
  }

  const el = getActiveEditableElement() ?? fallbackEl ?? null;
  if (!el) {
    return "";
  }

  const value = document.queryCommandValue(command);
  return typeof value === "string" ? value : String(value ?? "");
}

function hasActiveEditable(): boolean {
  return getActiveEditableElement() !== null;
}

function normalizeComposeFontFamilyValue(value: string) {
  const normalized = value.replace(/["']/g, "").trim().toLowerCase();

  if (!normalized) {
    return "";
  }

  if (normalized.includes("inter")) return "Inter, sans-serif";
  if (normalized.includes("-apple-system") || normalized.includes("system-ui")) {
    return "-apple-system, sans-serif";
  }
  if (normalized.includes("georgia")) return "Georgia, serif";
  if (normalized.includes("times new roman")) return "Times New Roman, serif";
  if (normalized.includes("courier new")) return "Courier New, monospace";
  if (normalized.includes("arial")) return "Arial, sans-serif";
  if (normalized.includes("verdana")) return "Verdana, sans-serif";
  if (normalized.includes("trebuchet ms")) return "Trebuchet MS, sans-serif";

  return "";
}

function normalizeComposeFontSizeValue(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return "";
  }

  const mapped: Record<string, string> = {
    "1": "11",
    "2": "13",
    "3": "16",
    "4": "20",
    "5": "24",
    "6": "32",
    "7": "48"
  };

  return mapped[normalized] ?? normalized;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await parseJsonResponse<T>(response);

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET"
  });

  const data = await parseJsonResponse<T>(response);

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await parseJsonResponse<T>(response);

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

async function deleteJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "DELETE"
  });

  const data = await parseJsonResponse<T>(response);

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

async function parseJsonResponse<T>(response: Response): Promise<T & { error?: string }> {
  try {
    return (await response.json()) as T & { error?: string };
  } catch {
    const fallbackBody = await response.text().catch(() => "");
    const fallbackMessage =
      fallbackBody.trim() ||
      response.statusText ||
      `Request failed with status ${response.status}`;

    return {
      error: fallbackMessage
    } as T & { error?: string };
  }
}

function formatTimestamp(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(date));
}

function formatSinceDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(date));
}

function getSenderFilterValue(message: MailSummary) {
  return message.from;
}

function getPrimaryRecipientValue(message: Pick<MailSummary, "to">) {
  return message.to?.[0] ?? "No recipient";
}

function getFocusFilterValue(
  message: Pick<MailSummary, "from" | "to">,
  isSentFolder: boolean
) {
  return isSentFolder ? getPrimaryRecipientValue(message) : message.from;
}

function getFocusIdentityLabel(
  message: Pick<MailSummary, "from" | "to">,
  isSentFolder: boolean
) {
  return isSentFolder
    ? formatSentRowRecipient([getPrimaryRecipientValue(message)])
    : displaySender(message.from);
}

type ServerPreferencesPayload = {
  prioritizedSenders?: { name: string; email: string; color: string }[];
  autoFilters?: {
    senderName: string;
    senderEmail: string;
    keepDays: 1 | 7 | 30 | 60 | 90;
    createdAt: string;
  }[];
  blockedSenders?: string[];
};

function getSenderInitials(sender: string) {
  return sender
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getAvatarColor(seed: string) {
  let hash = 0;

  for (const character of seed) {
    hash = character.charCodeAt(0) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 60% 46%)`;
}

function displaySender(from: string): string {
  const match = from.match(/^(.+?)\s*</);

  if (match) {
    return match[1].trim();
  }

  return from.split("@")[0];
}

function displayFolderName(path: string) {
  return path.replace(/^INBOX\./i, "");
}

function formatSentRowRecipient(to: string[] | undefined): string {
  if (!to || to.length === 0) {
    return "No recipient";
  }

  const first = to[0];
  const nameMatch = first.match(/^(.+?)\s*</);
  const displayName = nameMatch
    ? nameMatch[1].trim()
    : first.includes("@")
      ? first.split("@")[0]
      : first.trim();

  if (to.length === 1) {
    return displayName;
  }

  return `${displayName}, +${to.length - 1} more`;
}

function matchesComposerShortcut(shortcut: string, event: KeyboardEvent | React.KeyboardEvent) {
  const normalized = shortcut.toLowerCase();
  const usesMeta = normalized.includes("meta+");
  const usesShift = normalized.includes("shift+");
  const usesAlt = normalized.includes("alt+");
  const key = normalized.split("+").at(-1) ?? "";

  return (
    (usesMeta ? event.metaKey || event.ctrlKey : !event.metaKey && !event.ctrlKey) &&
    (usesShift ? event.shiftKey : !event.shiftKey) &&
    (usesAlt ? event.altKey : !event.altKey) &&
    event.key.toLowerCase() === key
  );
}

const COMPACT_TOOLBAR_COMMAND_IDS: ComposerCommandId[] = [
  "font_family",
  "font_size",
  "bold",
  "italic",
  "underline",
  "link",
  "attach_file",
  "insert_image"
];

const SELECTION_TOOLBAR_COMMAND_IDS: ComposerCommandId[] = [
  "bold",
  "italic",
  "underline",
  "uppercase_selection",
  "lowercase_selection",
  "capitalize_selection",
  "link",
  "quote",
  "clear_formatting"
];

function messageMentionsAttachment(text: string) {
  return /\b(attach|attached|attachment|attachments|enclosed|enclosure)\b/i.test(text);
}

function renderComposerCommandIcon(command: ComposerCommand) {
  switch (command.icon) {
    case "plain_text":
      return (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 7h11" />
          <path d="M4 12h11" />
          <path d="M4 17h8" />
          <polyline points="17 8 20 11 17 14" />
        </svg>
      );
    case "bold":
      return <strong>B</strong>;
    case "italic":
      return <span className="fmt-italic">I</span>;
    case "underline":
      return <span className="fmt-underline">U</span>;
    case "strikethrough":
      return <span className="fmt-strike">S</span>;
    case "uppercase":
      return <span className="fmt-case-glyph fmt-case-upper">AA</span>;
    case "lowercase":
      return <span className="fmt-case-glyph fmt-case-lower">aa</span>;
    case "capitalize":
      return <span className="fmt-case-glyph fmt-case-title">Aa</span>;
    case "align_left":
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="15" y2="12" />
          <line x1="3" y1="18" x2="18" y2="18" />
        </svg>
      );
    case "align_center":
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="6" y1="12" x2="18" y2="12" />
          <line x1="4" y1="18" x2="20" y2="18" />
        </svg>
      );
    case "bullet_list":
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="9" y1="6" x2="20" y2="6" />
          <line x1="9" y1="12" x2="20" y2="12" />
          <line x1="9" y1="18" x2="20" y2="18" />
          <circle cx="4" cy="6" r="1" fill="currentColor" />
          <circle cx="4" cy="12" r="1" fill="currentColor" />
          <circle cx="4" cy="18" r="1" fill="currentColor" />
        </svg>
      );
    case "number_list":
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="10" y1="6" x2="21" y2="6" />
          <line x1="10" y1="12" x2="21" y2="12" />
          <line x1="10" y1="18" x2="21" y2="18" />
          <path d="M4 6h1v4" />
          <path d="M4 10h2" />
          <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
        </svg>
      );
    case "indent":
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="9" y1="12" x2="21" y2="12" />
          <line x1="9" y1="18" x2="21" y2="18" />
          <polyline points="3 10 7 12 3 14" />
        </svg>
      );
    case "link":
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      );
    case "quote":
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 17H6a2 2 0 0 1-2-2v-1a5 5 0 0 1 5-5h1v8Z" />
          <path d="M20 17h-4a2 2 0 0 1-2-2v-1a5 5 0 0 1 5-5h1v8Z" />
        </svg>
      );
    case "clear_formatting":
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7V4h16v3" />
          <path d="M9 20h6" />
          <path d="M12 4v16" />
          <path d="m4 20 16-16" />
        </svg>
      );
    case "attach":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      );
    case "image":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2" ry="2" />
          <circle cx="8.5" cy="9.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      );
    case "signature":
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21h6" />
          <path d="M12 3a6 6 0 0 1 6 6c0 5-6 5-6 10" />
          <path d="M9 21h12" />
        </svg>
      );
    case "save":
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
          <path d="M17 21v-8H7v8" />
          <path d="M7 3v5h8" />
        </svg>
      );
    case "schedule":
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 3" />
        </svg>
      );
    case "print":
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9V2h12v7" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <path d="M6 14h12v8H6z" />
        </svg>
      );
    default:
      return (
        <span className="fmt-command-fallback">
          {command.label
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() ?? "")
            .join("") || "•"}
        </span>
      );
  }
}

function formatPrintSender(from: string, fromAddress?: string | null) {
  return fromAddress ? `${from} <${fromAddress}>` : from;
}

function escapePrintText(value: string | null | undefined) {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PRINT_DISALLOWED_SELECTORS = [
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "link",
  "base",
  "meta[http-equiv='refresh']"
].join(", ");

function sanitizePrintableHtml(htmlContent: string, includeQuoted: boolean) {
  if (typeof DOMParser === "undefined") {
    const stripped = htmlContent
      .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
      .replace(/<html[\s\S]*?>/gi, "")
      .replace(/<\/html>/gi, "")
      .replace(/<head[\s\S]*?<\/head>/gi, "")
      .replace(/<body[^>]*>/gi, "")
      .replace(/<\/body>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
      .replace(/<object[\s\S]*?<\/object>/gi, "")
      .replace(/<embed[\s\S]*?>/gi, "")
      .replace(/\son[a-z-]+\s*=\s*(['"]).*?\1/gi, "");

    return includeQuoted
      ? stripped
      : stripped.replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "");
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(htmlContent, "text/html");

  parsed.querySelectorAll(PRINT_DISALLOWED_SELECTORS).forEach((node) => node.remove());

  if (!includeQuoted) {
    parsed.querySelectorAll("blockquote").forEach((node) => node.remove());
  }

  parsed.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();

      if (name.startsWith("on") || name === "srcdoc" || name === "formaction") {
        element.removeAttribute(attribute.name);
        return;
      }

      if (name === "style") {
        const safeStyle = value
          .replace(/expression\s*\([^)]*\)/gi, "")
          .replace(/url\((['"]?)\s*javascript:[^)]+\1\)/gi, "none");

        if (safeStyle.trim()) {
          element.setAttribute("style", safeStyle);
        } else {
          element.removeAttribute("style");
        }
        return;
      }

      if (
        ["href", "src", "xlink:href", "poster", "background"].includes(name) &&
        /^(?:javascript|vbscript):/i.test(value)
      ) {
        element.removeAttribute(attribute.name);
      }
    });
  });

  return parsed.body.innerHTML;
}

function transformComposeCaseValue(
  value: string,
  mode: "upper" | "lower" | "title"
) {
  if (mode === "upper") {
    return value.toUpperCase();
  }

  if (mode === "lower") {
    return value.toLowerCase();
  }

  return value.replace(/\b([A-Za-z])([A-Za-z']*)/g, (match, first, rest) => {
    return `${first.toUpperCase()}${rest.toLowerCase()}`;
  });
}

function getPrintableMessageHtml(message: MailDetail, includeQuoted: boolean) {
  let htmlContent = message.html?.trim() || message.emailBody?.trim() || "";

  if (!htmlContent && message.text) {
    return `<pre>${escapePrintText(message.text)}</pre>`;
  }

  const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch?.[1]) {
    htmlContent = bodyMatch[1];
  }

  return sanitizePrintableHtml(htmlContent, includeQuoted);
}

function buildPrintDocument(
  messages: MailDetail[],
  options: {
    includeHeaders: boolean;
    includeQuoted: boolean;
    scope: "message" | "thread";
  }
) {
  const titleSource = messages[messages.length - 1] ?? messages[0];
  const title = titleSource
    ? `${displaySender(titleSource.from)} - ${titleSource.subject} - ${titleSource.date}`
    : "Maximail";

  const blocks = messages
    .map((message, index) => {
      const bodyHtml = getPrintableMessageHtml(message, options.includeQuoted);
      const toLine = message.to?.join(", ") ?? "";

      return `
        <div class="print-msg-block" data-print-scope="${options.scope}">
          ${
            options.includeHeaders
              ? `
                <div class="print-msg-header">
                  <div class="print-msg-subject">${escapePrintText(message.subject)}</div>
                  <div class="print-msg-header-field"><span class="print-msg-label">From:</span> ${escapePrintText(message.from)} &lt;${escapePrintText(message.fromAddress)}&gt;</div>
                  <div class="print-msg-header-field"><span class="print-msg-label">To:</span> ${escapePrintText(toLine)}</div>
                  <div class="print-msg-header-field"><span class="print-msg-label">Date:</span> ${escapePrintText(message.date)}</div>
                </div>
              `
              : ""
          }
          <div class="print-msg-body">${bodyHtml}</div>
          ${
            messages.length > 1 && index < messages.length - 1
              ? '<hr class="print-msg-divider">'
              : ""
          }
        </div>
      `;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: http: https: cid:; style-src 'unsafe-inline'; font-src data: https:; media-src 'none'; frame-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
    <title>${escapePrintText(title)}</title>
    <style>
      body { font-family: -apple-system, 'Inter', Arial, sans-serif; font-size: 13px; line-height: 1.6; color: #000; margin: 0; padding: 20px; }
      img { max-width: 100%; height: auto; }
      a { color: #0a84ff; }
      a[href]::after { content: " (" attr(href) ")"; font-size: 10px; color: #666; word-break: break-all; }
      a[href^="#"]::after, a[href^="javascript"]::after, a[href^="mailto"]::after { content: none; }
      img[width="1"], img[height="1"] { display: none; }
      .print-msg-header { border-bottom: 1px solid #ccc; padding-bottom: 10px; margin-bottom: 16px; font-size: 11px; }
      .print-msg-header-field { margin-bottom: 3px; }
      .print-msg-label { font-weight: 700; min-width: 60px; display: inline-block; }
      .print-msg-subject { font-size: 18px; font-weight: 700; margin-bottom: 12px; color: #000; }
      .print-msg-divider { border: none; border-top: 2px solid #eee; margin: 24px 0; }
      @media print { @page { margin: 1.5cm } body { padding: 0; } }
      blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 12px; color: #555; }
      .print-msg-block { page-break-inside: avoid; margin-bottom: 32px; }
    </style>
  </head>
  <body>${blocks}</body>
</html>`;
}

function getInitialComposeHeight() {
  return typeof window !== "undefined" ? Math.min(560, window.innerHeight - 80) : 560;
}

function getComposeMinWidth() {
  return 420;
}

function getComposeMaxWidth() {
  if (typeof window === "undefined") {
    return 560;
  }

  return Math.max(getComposeMinWidth(), Math.floor(window.innerWidth * 0.7));
}

function getInitialComposeWidth() {
  return typeof window !== "undefined" ? Math.min(560, getComposeMaxWidth()) : 560;
}

function getDefaultComposePos(height: number, width = getInitialComposeWidth()) {
  if (typeof window === "undefined") {
    return { x: 0, y: 0 };
  }

  return {
    x: Math.round((window.innerWidth - width) / 2),
    y: Math.round(window.innerHeight - height)
  };
}

function transformCase(type: "upper" | "lower" | "title" | "sentence") {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return;
  }

  const range = selection.getRangeAt(0);
  const text = range.toString();
  let result = text;

  if (type === "upper") {
    result = text.toUpperCase();
  } else if (type === "lower") {
    result = text.toLowerCase();
  } else if (type === "title") {
    result = text.replace(/\w\S*/g, (word) =>
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    );
  } else if (type === "sentence") {
    result = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }

  range.deleteContents();
  range.insertNode(document.createTextNode(result));
  selection.removeAllRanges();
}

function renderFolderGlyph(folderName: string, folderPath: string) {
  const normalized = `${folderName} ${folderPath}`.toLowerCase();

  if (normalized.includes("trash")) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6M14 11v6" />
        <path d="M9 6V4h6v2" />
      </svg>
    );
  }

  if (normalized.includes("spam") || normalized.includes("junk")) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9a2.5 2.5 0 1 1 5 0c0 1.8-2.5 2.2-2.5 4" />
        <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function renderSortFolderGlyph(preset: SortFolderPreset) {
  if (preset.key === "follow_up") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="5" y="4" width="14" height="16" rx="2" />
        <path d="M9 8h6" />
        <path d="M9 12h6" />
        <path d="m9 16 1.5 1.5L15 13" />
      </svg>
    );
  }

  if (preset.key === "travel") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 18 3 20V6l6-2 6 2 6-2v14l-6 2-6-2Z" />
        <path d="M9 4v14" />
        <path d="M15 6v14" />
      </svg>
    );
  }

  if (preset.key === "reference") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M4 10h16" />
        <path d="M9 7h1" />
        <path d="M14 7h1" />
        <path d="M8 14h8" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M10 16h4" />
    </svg>
  );
}

function getSenderType(from: string, email: string): "svc" | "nl" | null {
  const svcDomains = [
    "apple.com",
    "google.com",
    "microsoft.com",
    "amazon.com",
    "paypal.com",
    "chase.com",
    "bankofamerica.com",
    "wellsfargo.com",
    "statefarm.com",
    "geico.com",
    "affirm.com"
  ];
  const nlKeywords = [
    "newsletter",
    "noreply",
    "no-reply",
    "notifications",
    "updates",
    "digest",
    "weekly",
    "daily",
    "mailer",
    "campaigns",
    "marketing",
    "promo",
    "news@",
    "info@",
    "hello@"
  ];

  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  const emailLower = email.toLowerCase();
  const fromLower = from.toLowerCase();

  if (svcDomains.some((entry) => domain.includes(entry))) {
    return "svc";
  }

  if (nlKeywords.some((entry) => emailLower.includes(entry) || fromLower.includes(entry))) {
    return "nl";
  }

  return null;
}

function detectSubjectPattern(subject: string, allMessages: MailSummary[]): string | null {
  const words = subject.trim().split(/\s+/);
  if (words.length < 4) {
    return null;
  }

  let best: string | null = null;

  for (let len = 3; len <= Math.min(5, words.length - 1); len++) {
    const prefix = words.slice(0, len).join(" ").toLowerCase();
    const matches = allMessages.filter(
      (message) =>
        message.subject.toLowerCase().startsWith(prefix) && message.subject !== subject
    );

    if (matches.length >= 2) {
      best = words.slice(0, len).join(" ");
    }
  }

  return best;
}

function detectUnsubscribe(msg: MailDetail): {
  found: boolean;
  url: string | null;
  method: "link" | null;
} {
  // 1. List-Unsubscribe header parsed at the fetch layer
  if (msg.listUnsubscribeUrl) {
    return { found: true, url: msg.listUnsubscribeUrl, method: "link" };
  }

  // 2. Anchor href containing "unsubscribe" in the HTML body
  if (msg.html) {
    // href before inner text
    const hrefBeforeRe = /href=["'](https?:\/\/[^"']*unsubscribe[^"']*)["']/i;
    const hrefBeforeMatch = msg.html.match(hrefBeforeRe);
    if (hrefBeforeMatch?.[1]) {
      return { found: true, url: hrefBeforeMatch[1], method: "link" };
    }
    // anchor tag whose inner text says "unsubscribe"
    const anchorTextRe = /<a[^>]+href=["']([^"']+)["'][^>]*>[^<]*unsubscribe[^<]*<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = anchorTextRe.exec(msg.html)) !== null) {
      const href = match[1];
      if (href.startsWith("http") || href.startsWith("mailto:")) {
        return { found: true, url: href, method: "link" };
      }
    }

    // 3. Proximity match — any anchor within a small window of "unsubscribe"
    const unsubscribeIndex = msg.html.search(/unsubscribe/i);
    if (unsubscribeIndex >= 0) {
      const windowStart = Math.max(0, unsubscribeIndex - 150);
      const windowEnd = Math.min(msg.html.length, unsubscribeIndex + 150);
      const nearbyHtml = msg.html.slice(windowStart, windowEnd);
      const nearbyHrefMatch = nearbyHtml.match(/href=["'](https?:\/\/[^"']+)["']/i);
      if (nearbyHrefMatch?.[1]) {
        return { found: true, url: nearbyHrefMatch[1], method: "link" };
      }
    }
  }

  // 4. Plain-text fallback — URL on same line as "unsubscribe"
  if (msg.text) {
    for (const line of msg.text.split(/\n/)) {
      if (/unsubscribe/i.test(line)) {
        const urlMatch = line.match(/(https?:\/\/\S+)/);
        if (urlMatch?.[1]) {
          return { found: true, url: urlMatch[1], method: "link" };
        }
      }
    }
  }

  return { found: false, url: null, method: null };
}

function useSwipe(
  onSwipeLeft: () => void,
  onSwipeRight: () => void,
  threshold: number,
  enabled: boolean
) {
  const ref = useRef<HTMLDivElement | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const dirLocked = useRef<"h" | "v" | null>(null);
  const didSwipe = useRef(false);
  const pointerActive = useRef(false);

  useEffect(() => {
    const node = ref.current;

    if (!node) {
      return;
    }

    if (!enabled) {
      node.style.transform = "";
      didSwipe.current = false;
      pointerActive.current = false;
      return;
    }

    const resetTransform = () => {
      node.style.transform = "";
    };

    const beginSwipe = (clientX: number, clientY: number) => {
      startX.current = clientX;
      startY.current = clientY;
      dirLocked.current = null;
      didSwipe.current = false;
      resetTransform();
    };

    const moveSwipe = (clientX: number, clientY: number, preventDefault?: () => void) => {
      const dx = clientX - startX.current;
      const dy = clientY - startY.current;

      if (!dirLocked.current) {
        if (Math.abs(dx) > Math.abs(dy) + 6) {
          dirLocked.current = "h";
        } else if (Math.abs(dy) > Math.abs(dx) + 6) {
          dirLocked.current = "v";
        } else {
          return;
        }
      }

      if (dirLocked.current === "v") {
        return;
      }

      didSwipe.current = true;
      preventDefault?.();
      const clamped = Math.max(-160, Math.min(160, dx));
      node.style.transform = `translateX(${clamped}px)`;
    };

    const endSwipe = (clientX: number) => {
      if (dirLocked.current !== "h") {
        resetTransform();
        return;
      }

      const dx = clientX - startX.current;
      resetTransform();

      if (dx <= -threshold) {
        onSwipeLeft();
      } else if (dx >= threshold) {
        onSwipeRight();
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      beginSwipe(event.touches[0]?.clientX ?? 0, event.touches[0]?.clientY ?? 0);
    };

    const onTouchMove = (event: TouchEvent) => {
      moveSwipe(
        event.touches[0]?.clientX ?? 0,
        event.touches[0]?.clientY ?? 0,
        () => event.preventDefault()
      );
    };

    const onTouchEnd = (event: TouchEvent) => {
      endSwipe(event.changedTouches[0]?.clientX ?? 0);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointerActive.current) {
        return;
      }

      moveSwipe(event.clientX, event.clientY, () => event.preventDefault());
    };

    const stopPointer = () => {
      pointerActive.current = false;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!pointerActive.current) {
        return;
      }

      endSwipe(event.clientX);
      stopPointer();
    };

    const onPointerCancel = () => {
      if (!pointerActive.current) {
        return;
      }

      resetTransform();
      stopPointer();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.button !== 0) {
        return;
      }

      pointerActive.current = true;
      beginSwipe(event.clientX, event.clientY);
      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
    };

    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", onTouchEnd, { passive: true });
    node.addEventListener("touchcancel", resetTransform, { passive: true });
    node.addEventListener("pointerdown", onPointerDown);

    return () => {
      stopPointer();
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", resetTransform);
      node.removeEventListener("pointerdown", onPointerDown);
    };
  }, [enabled, onSwipeLeft, onSwipeRight, threshold]);

  return { ref, didSwipe };
}

type SwipeRowProps = {
  message: MailSummary;
  selected: boolean;
  exiting?: boolean;
  dragEnabled: boolean;
  swipeEnabled: boolean;
  isSentFolder: boolean;
  isChecked: boolean;
  activeSwipeUid: number | null;
  setActiveSwipeUid: (uid: number | null) => void;
  onOpen: () => void;
  onSelect: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  onDragStart: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onFocus: () => void;
  onDelete: () => void;
  onToggleRead: () => void;
};

function SwipeRow({
  message,
  selected,
  exiting = false,
  dragEnabled,
  swipeEnabled,
  isSentFolder,
  isChecked,
  activeSwipeUid,
  setActiveSwipeUid,
  onOpen,
  onSelect,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onFocus,
  onDelete,
  onToggleRead
}: SwipeRowProps) {
  const [revealedSide, setRevealedSide] = useState<"left" | "right" | null>(null);
  const swipeThreshold =
    typeof window !== "undefined" && window.innerWidth < 480 ? 56 : 72;
  const { ref: swipeRef, didSwipe } = useSwipe(
    () => {
      setRevealedSide("left");
      setActiveSwipeUid(message.uid);
    },
    () => {
      setRevealedSide("right");
      setActiveSwipeUid(message.uid);
    },
    swipeThreshold,
    swipeEnabled
  );
  const spoofed = detectSpoof(message).isSpoofed;
  const sentRecipientLabel = formatSentRowRecipient(message.to);
  const rowIdentity = isSentFolder ? sentRecipientLabel : message.from;
  const rowAvatarSeed = isSentFolder ? (message.to?.[0] ?? "") : message.fromAddress;
  const rowAvatarLabel = isSentFolder
    ? getSenderInitials(sentRecipientLabel)
    : getSenderInitials(message.from || message.fromAddress);

  useEffect(() => {
    if (activeSwipeUid !== message.uid && revealedSide) {
      setRevealedSide(null);
    }
  }, [activeSwipeUid, message.uid, revealedSide]);

  useEffect(() => {
    if (!swipeEnabled && revealedSide) {
      setRevealedSide(null);
    }
  }, [revealedSide, swipeEnabled]);

  return (
    <div
      className={`swipe-row ${revealedSide ? `swipe-row-${revealedSide}` : ""} ${
        exiting ? "new-mail-exit" : ""
      } ${swipeEnabled ? "" : "swipe-row-disabled"}`}
    >
      <div className="swipe-actions swipe-actions-left" aria-hidden={revealedSide !== "right"}>
        <button
          type="button"
          className="swipe-action-btn"
          onClick={(event) => {
            event.stopPropagation();
            onFocus();
            setActiveSwipeUid(null);
            setRevealedSide(null);
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span>Focus</span>
        </button>
        <button
          type="button"
          className="swipe-action-btn"
          onClick={(event) => {
            event.stopPropagation();
            onToggleRead();
            setActiveSwipeUid(null);
            setRevealedSide(null);
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12H2" />
            <path d="m9 5-7 7 7 7" />
            <path d="M13 19h5a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-5" />
          </svg>
          <span>{message.seen ? "Unread" : "Read"}</span>
        </button>
      </div>

      <div className="swipe-actions swipe-actions-right" aria-hidden={revealedSide !== "left"}>
        <button
          type="button"
          className="swipe-action-btn swipe-action-btn-danger"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
            setActiveSwipeUid(null);
            setRevealedSide(null);
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4h6v2" />
          </svg>
          <span>Delete</span>
        </button>
      </div>

      <div
        ref={swipeRef}
        style={{ touchAction: swipeEnabled ? "pan-y" : "auto" }}
        className={`swipe-foreground ${revealedSide ? `swipe-foreground-${revealedSide}` : ""}`}
      >
        <div
        className={[
          "message-row",
          selected ? "selected" : "",
          !message.seen ? "unread" : "",
          spoofed ? "spoof-row" : ""
          ]
            .filter(Boolean)
            .join(" ")}
          role="button"
          tabIndex={0}
          draggable={dragEnabled}
          onDragStart={dragEnabled ? onDragStart : undefined}
          onDragEnd={dragEnabled ? onDragEnd : undefined}
          onClick={(event) => {
            if (didSwipe.current) {
              didSwipe.current = false;
              return;
            }

            if (revealedSide) {
              event.preventDefault();
              setActiveSwipeUid(null);
              setRevealedSide(null);
              return;
            }

            setActiveSwipeUid(null);
            onOpen();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpen();
            }
          }}
          onContextMenu={onContextMenu}
        >
          <div
            className={`row-checkbox ${isChecked ? "checked" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
            role="checkbox"
            aria-checked={isChecked}
            tabIndex={-1}
          >
            {isChecked ? (
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : null}
          </div>
          <div
            className="row-avatar"
            style={{ background: getAvatarColor(rowAvatarSeed) }}
          >
            {rowAvatarLabel}
          </div>
          <div className="row-body">
            <div className="row-top">
              <div className="row-sender-group">
                <span className="row-sender">{rowIdentity}</span>
                {!isSentFolder && spoofed ? (
                  <span className="sender-trust-row-warning" title="High Risk sender">
                    ⚠
                  </span>
                ) : null}
                {(() => {
                  const type = getSenderType(message.from, message.fromAddress ?? "");

                  if (!type) {
                    return null;
                  }

                  return (
                    <span className={`type-chip type-chip-${type}`}>
                      {type.toUpperCase()}
                    </span>
                  );
                })()}
                {!isSentFolder ? (
                  <button
                    type="button"
                    className="focus-pill"
                    onClick={(event) => {
                      event.stopPropagation();
                      onFocus();
                    }}
                  >
                    ⊙ Focus
                  </button>
                ) : null}
              </div>
              <span className="row-date">{formatTimestamp(message.date)}</span>
            </div>
            <div className="row-subject">
              {isSentFolder ? <span className="row-to-label">To:</span> : null}
              {message.subject}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface RecipientFieldProps {
  label: string;
  recipients: string[];
  onChange: (recipients: string[]) => void;
  suggestions: string[];
  comparisonRecipients?: string[];
  contactsEnabled?: boolean;
  onImportContacts?: () => void;
  trailing?: React.ReactNode;
}

interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

function RecipientField({
  label,
  recipients,
  onChange,
  suggestions,
  comparisonRecipients,
  contactsEnabled,
  onImportContacts,
  trailing
}: RecipientFieldProps) {
  const [inputVal, setInputVal] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredSuggestions =
    inputVal.length > 0
      ? suggestions
          .filter(
            (suggestion) =>
              suggestion.toLowerCase().includes(inputVal.toLowerCase()) &&
              !recipientListIncludesValue(comparisonRecipients ?? recipients, suggestion)
          )
          .slice(0, 6)
      : [];

  const addRecipient = (value: string) => {
    const nextRecipients = appendNormalizedRecipientInput(recipients, value);
    if (nextRecipients.length === recipients.length) {
      setInputVal("");
      setShowSuggestions(false);
      return;
    }

    onChange(nextRecipients);
    setInputVal("");
    setShowSuggestions(false);
  };

  const removeRecipient = (recipient: string) => {
    onChange(recipients.filter((value) => value !== recipient));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (["Enter", "Tab", ",", ";"].includes(event.key) && inputVal.trim()) {
      event.preventDefault();
      addRecipient(inputVal);
    } else if (event.key === "Backspace" && !inputVal && recipients.length > 0) {
      onChange(recipients.slice(0, -1));
    } else if (event.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  return (
    <div className="recipient-field" onClick={() => inputRef.current?.focus()}>
      <span className="recipient-label">{label}</span>
      <div className="recipient-chips-wrap">
        {recipients.map((recipient) => (
          <div key={recipient} className="recipient-chip">
            <span className="recipient-chip-text">{recipient}</span>
            <button
              type="button"
              className="recipient-chip-remove"
              onMouseDown={(event) => {
                event.preventDefault();
                removeRecipient(recipient);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <div className="recipient-input-wrap">
          <input
            ref={inputRef}
            className="recipient-input"
            value={inputVal}
            onChange={(event) => {
              setInputVal(event.target.value);
              setShowSuggestions(true);
            }}
            onKeyDown={onKeyDown}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData("text").trim();
              if (!pasted) {
                return;
              }

              const hasStructuredRecipientContent =
                /[,;\n]/.test(pasted) || pasted.includes("@") || pasted.includes("<");

              if (!hasStructuredRecipientContent) {
                return;
              }

              event.preventDefault();
              addRecipient(inputVal ? `${inputVal}, ${pasted}` : pasted);
            }}
            onBlur={() => {
              if (inputVal.trim()) {
                addRecipient(inputVal);
              }
              window.setTimeout(() => setShowSuggestions(false), 150);
            }}
            onFocus={() => {
              if (inputVal) {
                setShowSuggestions(true);
              }
            }}
            placeholder={recipients.length === 0 ? "Add recipient" : ""}
            size={Math.max(4, inputVal.length + 1)}
          />
          {showSuggestions && filteredSuggestions.length > 0 ? (
            <div className="recipient-suggestions">
              {filteredSuggestions.map((suggestion) => (
                <div
                  key={suggestion}
                  className="recipient-suggestion-item"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    addRecipient(suggestion);
                  }}
                >
                  <div
                    className="recipient-suggestion-avatar"
                    style={{ background: getAvatarColor(suggestion) }}
                  >
                    {getSenderInitials(suggestion)}
                  </div>
                  <div className="recipient-suggestion-text">
                    <div className="recipient-suggestion-name">
                      {displaySender(suggestion)}
                    </div>
                    <div className="recipient-suggestion-email">
                      {suggestion.match(/<(.+)>/)?.[1] ?? suggestion}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {contactsEnabled && onImportContacts ? (
          <button
            type="button"
            className="recipient-contact-btn"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onImportContacts}
            title="Add from system contacts"
          >
            Contacts
          </button>
        ) : null}
        {trailing ? <div className="recipient-trailing">{trailing}</div> : null}
      </div>
    </div>
  );
}

export function MailApp() {
  const [accounts, setAccounts] = useState<MailAccountSummary[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [connection, setConnection] = useState<MailConnectionPayload>(defaultConnection);
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [foldersByAccount, setFoldersByAccount] = useState<Record<string, MailFolder[]>>({});
  const [folderOrder, setFolderOrder] = useState<string[]>([]);
  const [draggedFolderPath, setDraggedFolderPath] = useState<string | null>(null);
  const [sidebarMailDragState, setSidebarMailDragState] = useState<SidebarMailDragState | null>(
    null
  );
  const [sidebarMailDragHoverTargetId, setSidebarMailDragHoverTargetId] = useState<string | null>(
    null
  );
  const [messages, setMessages] = useState<MailSummary[]>([]);
  const [selectedUids, setSelectedUids] = useState<Set<number>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<MailDetail | null>(null);
  const [mailActionStatuses, setMailActionStatuses] = useState<Record<string, MailActionStatus>>(
    {}
  );
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const [threadingEnabled, setThreadingEnabled] = useState(true);
  const [mailboxViewMode, setMailboxViewMode] = useState<MailboxViewMode>("classic");
  const [inboxAttentionView, setInboxAttentionView] = useState<InboxAttentionView | null>(null);
  const [expandedConversationIds, setExpandedConversationIds] = useState<Set<string>>(
    new Set()
  );
  const [expandedConversationMessageUids, setExpandedConversationMessageUids] =
    useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Connect a live mailbox to begin.");
  const [mailboxRefreshHint, setMailboxRefreshHint] = useState<{
    accountId: string;
    folderPath: string;
    message: string;
  } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMinimized, setComposeMinimized] = useState(false);
  const [composeWidth, setComposeWidth] = useState(getInitialComposeWidth);
  const [composeHeight, setComposeHeight] = useState(getInitialComposeHeight);
  const [composeDraft, setComposeDraft] = useState<StoredComposerDraft | null>(null);
  const [composeDraftId, setComposeDraftId] = useState<string | null>(null);
  const [composeSessionContext, setComposeSessionContext] =
    useState<ComposeSessionContext | null>(null);
  const [composeIdentity, setComposeIdentity] = useState<ComposeIdentityState | null>(null);
  const [composeIntent, setComposeIntent] = useState<ComposeIntent>({ kind: "new" });
  const [composeSourceMessageMeta, setComposeSourceMessageMeta] =
    useState<ComposeSourceMessageMeta | null>(null);
  const [composeDraftStatus, setComposeDraftStatus] =
    useState<DraftAutosaveStatus>("idle");
  const [composeDraftSavedAt, setComposeDraftSavedAt] = useState<string | null>(null);
  const [composeDraftError, setComposeDraftError] = useState<string | null>(null);
  const [composePos, setComposePos] = useState<{ x: number; y: number } | null>(null);
  const [composeToList, setComposeToList] = useState<string[]>([]);
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const composeSubjectInputRef = useRef<HTMLInputElement | null>(null);
  const composeEditorRef = useRef<HTMLDivElement | null>(null);
  const composePlainTextRef = useRef<HTMLTextAreaElement | null>(null);
  const composeDragRef = useRef<boolean>(false);
  const composeDragStartX = useRef<number>(0);
  const composeDragStartY = useRef<number>(0);
  const composeDragOriginX = useRef<number>(0);
  const composeDragOriginY = useRef<number>(0);
  const composeResizeRef = useRef<{
    edge: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    startW: number;
    startH: number;
  } | null>(null);
  const [composeCcList, setComposeCcList] = useState<string[]>([]);
  const [composeBccList, setComposeBccList] = useState<string[]>([]);
  const [composeReplyTo, setComposeReplyTo] = useState("");
  const [composeAttachments, setComposeAttachments] = useState<File[]>([]);
  const [composeWordCount, setComposeWordCount] = useState({ words: 0, chars: 0 });
  const [composeDragOver, setComposeDragOver] = useState(false);
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
  const [imgRect, setImgRect] = useState<DOMRect | null>(null);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropSourceImg, setCropSourceImg] = useState<HTMLImageElement | null>(null);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cropCanvasSize, setCropCanvasSize] = useState({ width: 0, height: 0 });
  const [cropNaturalSize, setCropNaturalSize] = useState({ width: 0, height: 0 });
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [showReplyTo, setShowReplyTo] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printTargetUid, setPrintTargetUid] = useState<number | null>(null);
  const [printScope, setPrintScope] = useState<PrintScope>("message");
  const [printFormat, setPrintFormat] = useState<PrintFormat>("print");
  const [printIncludeHeaders, setPrintIncludeHeaders] = useState(true);
  const [printIncludeQuoted, setPrintIncludeQuoted] = useState(true);
  const savedRangeRef = useRef<Range | null>(null);
  const resizingRef = useRef<{
    corner: "nw" | "ne" | "sw" | "se";
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    aspectRatio: number;
  } | null>(null);
  const [composePlainText, setComposePlainText] = useState(false);
  const [composeSelectionState, setComposeSelectionState] = useState<SelectionState>({
    hasSelection: false,
    text: "",
    isCollapsed: true
  });
  const [composeToolbarPreferences, setComposeToolbarPreferences] =
    useState<ComposerToolbarPreferences>(() => loadComposerToolbarPreferences());
  const [composeToolbarMenuOpen, setComposeToolbarMenuOpen] = useState(false);
  const [composeToolbarOverflowOpen, setComposeToolbarOverflowOpen] = useState(false);
  const [composeQuickInsertOpen, setComposeQuickInsertOpen] = useState(false);
  const [composeToolbarMenuPosition, setComposeToolbarMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [composeToolbarOverflowPosition, setComposeToolbarOverflowPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [composeQuickInsertPosition, setComposeQuickInsertPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [composeSelectionToolbarPos, setComposeSelectionToolbarPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [composeFormatSelection, setComposeFormatSelection] = useState<{
    fontFamily: string;
    fontSize: string;
  }>({
    fontFamily: "",
    fontSize: ""
  });
  const [defaultSignature, setDefaultSignature] = useState("— Ben");
  const [signature, setSignature] = useState("— Ben");
  const [signatureDefinitions, setSignatureDefinitions] = useState<ComposeSignatureDefinition[]>([]);
  const [presetDefinitions, setPresetDefinitions] = useState<ComposePresetDefinition[]>([]);
  const [composeContentState, setComposeContentState] = useState<ComposeContentState | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [senderFilter, setSenderFilter] = useState<string | null>(null);
  const [senderFilterScope, setSenderFilterScope] = useState<SenderFilterScope | null>(null);
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  const [subjectPattern, setSubjectPattern] = useState<string | null>(null);
  const [senderTrustExpandedUid, setSenderTrustExpandedUid] = useState<number | null>(null);
  const [unsubscribeConfirm, setUnsubscribeConfirm] = useState(false);
  const [unsubConfirmOpen, setUnsubConfirmOpen] = useState(false);
  const [domainVerification, setDomainVerification] = useState<DomainVerificationState | null>(
    null
  );
  const [suspiciousLinks, setSuspiciousLinks] = useState<string[]>([]);
  const [bimiAvatarFailed, setBimiAvatarFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImages, setLightboxImages] = useState<LightboxImage[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [lightboxRotation, setLightboxRotation] = useState(0);
  const [lightboxOffset, setLightboxOffset] = useState({ x: 0, y: 0 });
  const [lightboxDragging, setLightboxDragging] = useState(false);
  const [moveFolderOpen, setMoveFolderOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<MailSummary | MailDetail | null>(null);
  const [moveConversationTargetId, setMoveConversationTargetId] = useState<string | null>(null);
  const [bulkMoveActive, setBulkMoveActive] = useState(false);
  const [sortMenuUid, setSortMenuUid] = useState<number | null>(null);
  const [bulkSelectionMenu, setBulkSelectionMenu] = useState<BulkSelectionMenu>(null);
  const [hasAppliedPreset, setHasAppliedPreset] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<
    "ui" | "account" | "sorting" | "blocked" | "rules"
  >("ui");
  const [accountFormMode, setAccountFormMode] = useState<"add" | "edit" | null>(null);
  const [accountFormTarget, setAccountFormTarget] = useState<string | null>(null);
  const [accountFormError, setAccountFormError] = useState<string | null>(null);
  const [accountFormSuccess, setAccountFormSuccess] = useState<string | null>(null);
  const [storedPasswordHintVisible, setStoredPasswordHintVisible] = useState(false);
  const [blockedSearch, setBlockedSearch] = useState("");
  const [selectedBlockedSenders, setSelectedBlockedSenders] = useState<Set<string>>(new Set());
  const [blockedSelectionAnchor, setBlockedSelectionAnchor] = useState<string | null>(null);
  const [editableActive, setEditableActive] = useState(false);
  const composeToolbarMenuRef = useRef<HTMLDivElement | null>(null);
  const composeToolbarTriggerRef = useRef<HTMLButtonElement | null>(null);
  const composeToolbarPopoverRef = useRef<HTMLDivElement | null>(null);
  const composeToolbarOverflowRef = useRef<HTMLDivElement | null>(null);
  const composeToolbarOverflowPopoverRef = useRef<HTMLDivElement | null>(null);
  const composeQuickInsertRef = useRef<HTMLDivElement | null>(null);
  const composeQuickInsertPopoverRef = useRef<HTMLDivElement | null>(null);
  const draftServiceRef = useRef(
    createDraftService(createLocalStorageDraftAdapter())
  );
  const autosaveServiceRef = useRef<AutosaveService | null>(null);
  const composeLocalRevisionRef = useRef(0);
  const composeLastSavedRevisionRef = useRef(0);
  const [sidebarSize, setSidebarSize] = useState<"small" | "medium" | "large">(
    "medium"
  );
  const [collapsedSortFolderVisibility, setCollapsedSortFolderVisibility] = useState<
    "essential_only" | "include_active_sort_folders"
  >("essential_only");
  const [recentRecipients, setRecentRecipients] = useState<string[]>([]);
  const [accountMailboxDisclosureStates, setAccountMailboxDisclosureStates] = useState<
    Record<string, AccountMailboxDisclosureState>
  >({});
  const [lightweightOnboardingDismissed, setLightweightOnboardingDismissed] = useState(false);
  const [accountMailboxDisclosureAnimations, setAccountMailboxDisclosureAnimations] = useState<
    Record<string, SidebarMailboxDisclosureAnimation>
  >({});
  const accountMailboxDisclosureAnimationTimeoutsRef = useRef<Record<string, number>>({});
  const [newMailExitingMessageUids, setNewMailExitingMessageUids] = useState<Set<number>>(
    new Set()
  );
  const [newMailExitingConversationIds, setNewMailExitingConversationIds] = useState<
    Set<string>
  >(new Set());
  const [deleteTarget, setDeleteTarget] = useState<MailSummary | null>(null);
  const [blockSender, setBlockSender] = useState(false);
  const [blockedSenders, setBlockedSenders] = useState<Set<string>>(new Set());
  const [pinnedMessages, setPinnedMessages] = useState<Set<string>>(new Set());
  const [prioritizedSenders, setPrioritizedSenders] = useState<
    {
      name: string;
      email: string;
      color: string;
    }[]
  >([]);
  const [cleanupMode, setCleanupMode] = useState(false);
  const [cleanupExpandedSender, setCleanupExpandedSender] = useState<string | null>(null);
  const [cleanupExpandedMsg, setCleanupExpandedMsg] = useState<number | null>(null);
  const [cleanupPreviewCache, setCleanupPreviewCache] = useState<Record<number, MailDetail>>({});
  const [cleanupSortMenuSender, setCleanupSortMenuSender] = useState<string | null>(null);
  const [keepRecentTarget, setKeepRecentTarget] = useState<MailSummary | null>(null);
  const [keepRecentDays, setKeepRecentDays] = useState<1 | 7 | 30 | 60 | 90>(30);
  const [sidebarCtx, setSidebarCtx] = useState<{
    x: number;
    y: number;
    sender: { name: string; email: string; color: string };
  } | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<{
    x: number;
    y: number;
    accountId: string;
    accountEmail: string;
    folderPath: string;
    folderName: string;
  } | null>(null);
  const [autoFilters, setAutoFilters] = useState<
    {
      senderName: string;
      senderEmail: string;
      keepDays: 1 | 7 | 30 | 60 | 90;
      createdAt: string;
    }[]
  >([]);
  const [autoFilterTarget, setAutoFilterTarget] = useState<{
    name: string;
    email: string;
  } | null>(null);
  const [autoFilterDays, setAutoFilterDays] = useState<1 | 7 | 30 | 60 | 90>(30);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const cleanupSortMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileViewerMenuRef = useRef<HTMLDivElement | null>(null);
  const [swipeHintShown, setSwipeHintShown] = useState(false);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [activeSwipeUid, setActiveSwipeUid] = useState<number | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [userDataReady, setUserDataReady] = useState(false);
  const [notifPlatform] = useState(() => detectNotificationPlatform());
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(
    () => {
      if (typeof window === "undefined" || !("Notification" in window)) {
        return "unsupported";
      }

      if (detectNotificationPlatform().isIosSafariTab) {
        return "unsupported";
      }

      return Notification.permission;
    }
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    msg: MailSummary;
  } | null>(null);
  const [mobileViewerMenuOpen, setMobileViewerMenuOpen] = useState(false);
  const [listAreaContextMenu, setListAreaContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [responsiveInteractionMode, setResponsiveInteractionMode] =
    useState<ResponsiveInteractionMode>("mobile-stacked");
  const [mobileStackedScreen, setMobileStackedScreen] =
    useState<MobileStackedScreen>("mailboxes");
  const [workspacePaneWidths, setWorkspacePaneWidths] = useState({
    sidebar: 360,
    list: 420
  });
  const [workspaceActiveDivider, setWorkspaceActiveDivider] = useState<"sidebar" | "list" | null>(
    null
  );
  const [workspaceHoveredDivider, setWorkspaceHoveredDivider] = useState<
    "sidebar" | "list" | null
  >(null);
  const [workspacePaneSettling, setWorkspacePaneSettling] = useState(false);
  const composeAttachmentDataUrlCacheRef = useRef<WeakMap<File, string | Promise<string>>>(
    new WeakMap()
  );
  const workspaceRef = useRef<HTMLElement | null>(null);
  const workspacePaneSettlingTimerRef = useRef<number | null>(null);
  const bulkSortMenuRef = useRef<HTMLDivElement | null>(null);
  const bulkMoreMenuRef = useRef<HTMLDivElement | null>(null);
  const lightboxAreaRef = useRef<HTMLDivElement | null>(null);
  const lightboxImageRef = useRef<HTMLImageElement | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cropImageRef = useRef<HTMLImageElement | null>(null);
  const previousResponsiveInteractionModeRef = useRef<ResponsiveInteractionMode>(
    responsiveInteractionMode
  );
  const restoredAccountIdRef = useRef<string | null>(null);
  const restoredFolderRef = useRef<string | null>(null);
  const activeAccountIdRef = useRef<string | null>(null);
  const explicitActiveAccountIdRef = useRef<string | null>(null);
  const didBootstrapAccountsRef = useRef(false);
  const previousMailboxQueryRef = useRef<ReturnType<typeof createMailboxQueryState> | null>(null);
  const autoSyncInFlightRef = useRef(false);
  const refreshFromEventTimerRef = useRef<number | null>(null);
  const visibleMessageLoadSeqRef = useRef(0);
  const latestVisibleMessageLoadRef = useRef<{ key: string; seq: number } | null>(null);
  const pendingMailMutationsRef = useRef<Record<string, PendingMailMutation>>({});
  const pendingMailMutationTimersRef = useRef<Record<string, number>>({});
  const prevMessageUidsRef = useRef<Set<number>>(new Set());
  const openMessageSeqRef = useRef(0);
  const newMailReadDelayRef = useRef<{
    uid: number;
    accountId: string;
    folderPath: string;
    startedAt: number;
  } | null>(null);
  const composeAttachmentIdsRef = useRef<WeakMap<File, string>>(new WeakMap());
  const composeAttachmentIdCounterRef = useRef(0);
  const cropInteractionRef = useRef<{
    mode: CropHandle;
    pointerId: number;
    startX: number;
    startY: number;
    startRect: CropRect;
  } | null>(null);
  const lightboxPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lightboxPanRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const lastEditableRef = useRef<HTMLElement | null>(null);
  const isWideWorkspace = responsiveInteractionMode === "desktop-workspace";
  const isMobileStackedMode = responsiveInteractionMode === "mobile-stacked";

  const clearAccountMailboxDisclosureAnimation = useCallback((accountId: string) => {
    const timeoutId = accountMailboxDisclosureAnimationTimeoutsRef.current[accountId];
    if (typeof timeoutId === "number") {
      window.clearTimeout(timeoutId);
      delete accountMailboxDisclosureAnimationTimeoutsRef.current[accountId];
    }

    setAccountMailboxDisclosureAnimations((current) => {
      if (!current[accountId]) {
        return current;
      }

      const next = { ...current };
      delete next[accountId];
      return next;
    });
  }, []);

  const queueAccountMailboxDisclosureAnimation = useCallback(
    (accountId: string, animation: SidebarMailboxDisclosureAnimation) => {
      const timeoutId = accountMailboxDisclosureAnimationTimeoutsRef.current[accountId];
      if (typeof timeoutId === "number") {
        window.clearTimeout(timeoutId);
      }

      setAccountMailboxDisclosureAnimations((current) => ({
        ...current,
        [accountId]: animation
      }));

      accountMailboxDisclosureAnimationTimeoutsRef.current[accountId] = window.setTimeout(() => {
        clearAccountMailboxDisclosureAnimation(accountId);
      }, 170);
    },
    [clearAccountMailboxDisclosureAnimation]
  );

  useEffect(() => {
    return () => {
      Object.values(accountMailboxDisclosureAnimationTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
    };
  }, []);

  useEffect(() => {
    return () => {
      if (workspacePaneSettlingTimerRef.current !== null) {
        window.clearTimeout(workspacePaneSettlingTimerRef.current);
      }
    };
  }, []);

  const clampWorkspacePaneWidths = useCallback(
    (
      requested: {
        sidebar: number;
        list: number;
      },
      containerWidth: number
    ) => {
      const availableWidth = Math.max(
        containerWidth - WORKSPACE_DIVIDER_WIDTH * 2,
        WORKSPACE_MIN_SIDEBAR_WIDTH + WORKSPACE_MIN_LIST_WIDTH + WORKSPACE_MIN_VIEWER_WIDTH
      );
      const maxSidebar = Math.max(
        WORKSPACE_MIN_SIDEBAR_WIDTH,
        availableWidth - WORKSPACE_MIN_LIST_WIDTH - WORKSPACE_MIN_VIEWER_WIDTH
      );
      const sidebar = Math.min(
        Math.max(requested.sidebar, WORKSPACE_MIN_SIDEBAR_WIDTH),
        maxSidebar
      );
      const maxList = Math.max(
        WORKSPACE_MIN_LIST_WIDTH,
        availableWidth - sidebar - WORKSPACE_MIN_VIEWER_WIDTH
      );
      const list = Math.min(Math.max(requested.list, WORKSPACE_MIN_LIST_WIDTH), maxList);

      return { sidebar, list };
    },
    []
  );
  const returnMobileStackedToMessages = useCallback(() => {
    if (selectedMessage || selectedUid !== null) {
      openMessageSeqRef.current += 1;
      setSelectedMessage(null);
      setSelectedUid(null);
    }

    setMobileStackedScreen("messages");
  }, [selectedMessage, selectedUid]);
  const returnMobileStackedToMailboxes = useCallback(() => {
    setMobileStackedScreen("mailboxes");
  }, []);

  const blockedSenderList = useMemo(
    () => Array.from(blockedSenders).sort((left, right) => left.localeCompare(right)),
    [blockedSenders]
  );
  const filteredBlockedSenders = useMemo(() => {
    const query = blockedSearch.trim().toLowerCase();
    if (!query) {
      return blockedSenderList;
    }

    return blockedSenderList.filter((sender) => sender.toLowerCase().includes(query));
  }, [blockedSearch, blockedSenderList]);
  const visibleSelectedBlockedCount = useMemo(
    () =>
      filteredBlockedSenders.filter((sender) => selectedBlockedSenders.has(sender)).length,
    [filteredBlockedSenders, selectedBlockedSenders]
  );
  const lightboxPinchRef = useRef<{
    distance: number;
    zoom: number;
  } | null>(null);
  const deferredQuery = useDeferredValue(query);
  const composeRecipientState = useMemo(
    () =>
      normalizeStructuredRecipientGroups({
        to: composeToList,
        cc: composeCcList,
        bcc: composeBccList
      }),
    [composeBccList, composeCcList, composeToList]
  );
  const composeRecipients = useMemo(
    () => serializeStructuredRecipientGroups(composeRecipientState),
    [composeRecipientState]
  );
  const composeAllRecipients = useMemo(
    () => [...composeRecipients.to, ...composeRecipients.cc, ...composeRecipients.bcc],
    [composeRecipients]
  );
  const composeTo = composeRecipients.to.join(", ");
  const composeCc = composeRecipients.cc.join(", ");
  const composeBcc = composeRecipients.bcc.join(", ");
  const activeAccount = useMemo(
    () => accounts.find((account) => account.id === activeAccountId) ?? null,
    [accounts, activeAccountId]
  );
  const shouldShowLightweightOnboarding =
    userDataReady && !lightweightOnboardingDismissed && accounts.length > 0;
  const composeAccount = useMemo(
    () => getComposeAccountForIdentity(accounts, composeIdentity),
    [accounts, composeIdentity]
  );
  const mailboxContext = useMemo(
    () => resolveMailboxContext(accounts, activeAccountId),
    [accounts, activeAccountId]
  );
  const currentFolderPath = connection.folder || activeAccount?.defaultFolder || "INBOX";
  const activeMailboxNodes = useMemo(
    () =>
      activeAccountId
        ? resolveMailboxNodes(folders, {
            accountId: activeAccountId,
            providerKind: activeAccount?.provider.kind ?? "imap-smtp",
            providerCapabilities: activeAccount?.provider.capabilities
          })
        : [],
    [activeAccount?.provider.capabilities, activeAccount?.provider.kind, activeAccountId, folders]
  );
  const activeMailboxNode = useMemo(
    () => findMailboxNodeByPath(activeMailboxNodes, currentFolderPath),
    [activeMailboxNodes, currentFolderPath]
  );
  const activeInboxAttentionView = useMemo(
    () =>
      resolveInboxAttentionView({
        mailboxViewMode,
        mailboxNode: activeMailboxNode,
        inboxAttentionView
      }),
    [activeMailboxNode, inboxAttentionView, mailboxViewMode]
  );
  const isReadMailAttentionView = activeInboxAttentionView === "read";
  const isScopedNewMailReadDelayActive =
    mailboxViewMode === "new-mail" && activeInboxAttentionView === "new-mail";
  const currentAccountEmail = activeAccount?.email || connection.email;
  const composeSessionAccountId =
    composeSessionContext?.ownerAccountId ?? composeIdentity?.ownerAccountId ?? undefined;
  const composeSessionAccountEmail =
    composeIdentity?.sender?.address ??
    composeAccount?.email ??
    (composeSessionContext ? "" : currentAccountEmail);
  const composeSessionFromLabel =
    composeIdentity?.sender?.label ??
    (composeSessionAccountEmail ? composeSessionAccountEmail : "Select sender");
  const composeActiveSignatureLabel =
    composeContentState?.activeSignatureLabel ?? "Default signature";
  const quickInsertPresets = useMemo(
    () => composeContentState?.presets ?? [],
    [composeContentState]
  );
  const mailActionCapabilities = useMemo<MailActionCapabilityMap>(
    () =>
      resolveMailActionCapabilities(
        {
          providerKind: activeAccount?.provider.kind,
          providerCapabilities:
            activeAccount?.provider.capabilities ?? {
              supportsServerSideThreads: false,
              supportsLabels: false,
              supportsServerSideSearch: false,
              supportsPushSync: false,
              supportsProviderOAuth: false,
              usesSmtpSend: true
            },
          currentFolderPath,
          currentMailboxSystemKey: activeMailboxNode?.systemKey ?? null,
          availableFolderPaths: activeMailboxNodes.map((node) => node.identity.providerPath)
        },
        folders
      ),
    [
      activeAccount?.provider.capabilities,
      activeAccount?.provider.kind,
      activeMailboxNodes,
      currentFolderPath,
      folders
    ]
  );
  const mailActionBusy = useMemo(
    () => Object.values(mailActionStatuses).some((entry) => entry.phase === "running"),
    [mailActionStatuses]
  );
  const usingStoredAccountCredentials = Boolean(activeAccount);
  const hasInMotionPreset = Boolean(getConnectionPreset(connection.email || currentAccountEmail));
  const accountSettingsDirty = useMemo(() => {
    const normalizedConnection = {
      email: connection.email.trim().toLowerCase(),
      imapHost: connection.imapHost.trim().toLowerCase(),
      imapPort: connection.imapPort,
      imapSecure: connection.imapSecure,
      smtpHost: connection.smtpHost.trim().toLowerCase(),
      smtpPort: connection.smtpPort,
      smtpSecure: connection.smtpSecure
    };

    if (activeAccount) {
      return (
        normalizedConnection.email !== activeAccount.email.trim().toLowerCase() ||
        normalizedConnection.imapHost !== activeAccount.imapHost.trim().toLowerCase() ||
        normalizedConnection.imapPort !== activeAccount.imapPort ||
        normalizedConnection.imapSecure !== activeAccount.imapSecure ||
        normalizedConnection.smtpHost !== activeAccount.smtpHost.trim().toLowerCase() ||
        normalizedConnection.smtpPort !== activeAccount.smtpPort ||
        normalizedConnection.smtpSecure !== activeAccount.smtpSecure ||
        connection.password.trim().length > 0
      );
    }

    return (
      normalizedConnection.email.length > 0 ||
      connection.password.trim().length > 0 ||
      normalizedConnection.imapHost !== defaultConnection.imapHost ||
      normalizedConnection.imapPort !== defaultConnection.imapPort ||
      normalizedConnection.imapSecure !== defaultConnection.imapSecure ||
      normalizedConnection.smtpHost !== defaultConnection.smtpHost ||
      normalizedConnection.smtpPort !== defaultConnection.smtpPort ||
      normalizedConnection.smtpSecure !== defaultConnection.smtpSecure
    );
  }, [activeAccount, connection]);

  useEffect(() => {
    if (!composeOpen) {
      return;
    }

    setComposeIdentity((current) =>
      resolveComposeIdentityState({
        accounts,
        preferredAccountId: composeSessionContext?.ownerAccountId ?? current?.accountId ?? undefined,
        ownerAccountId: composeSessionContext?.ownerAccountId,
        ownerLocked: composeSessionContext?.ownerLocked,
        persistedIdentity: current,
        persistedReplyTo: composeReplyTo
      })
    );
  }, [accounts, composeOpen, composeReplyTo, composeSessionContext]);
  useEffect(() => {
    if (!composeOpen || !composeIdentity) {
      return;
    }

    if (composeSessionContext?.ownerStatus === "missing_account") {
      setStatus("This compose session belongs to a missing or disconnected account.");
      return;
    }

    if (composeIdentity.senderStatus === "missing_sender") {
      setStatus("The selected sender for this compose session is no longer available.");
    }
  }, [composeIdentity, composeOpen, composeSessionContext]);
  useEffect(() => {
    if (!composeOpen || composeSessionContext) {
      return;
    }

    const ownerAccountId = resolveDefaultComposeOwner(
      accounts,
      mailboxContext,
      composeIdentity?.ownerAccountId ?? composeIdentity?.accountId
    );

    if (!ownerAccountId) {
      return;
    }

    setComposeSessionContext(
      createComposeSessionContext({
        sessionId: composeDraftId ?? `compose-session-${Date.now()}`,
        accounts,
        ownerAccountId,
        ownerLocked: true,
        initializationSource:
          composeIntent.kind === "reply" ||
          composeIntent.kind === "reply_all" ||
          composeIntent.kind === "forward" ||
          composeIntent.kind === "edit_as_new" ||
          composeIntent.kind === "draft_resume"
            ? composeIntent.kind
            : "new",
        sourceAccountId: composeSourceMessageMeta?.accountId ?? null,
        sourceMessageId: composeSourceMessageMeta?.messageId ?? null,
        sourceMessageUid: composeSourceMessageMeta?.uid ?? null
      })
    );
  }, [
    accounts,
    composeDraftId,
    composeIdentity,
    composeIntent,
    composeOpen,
    composeSessionContext,
    composeSourceMessageMeta,
    mailboxContext
  ]);
  useEffect(() => {
    if (!composeOpen) {
      return;
    }

    const nextContent = resolveComposeContentForSession(
      composeIdentity,
      composeIntent,
      composeContentState
    );

    setComposeContentState((current) => {
      if (JSON.stringify(current) === JSON.stringify(nextContent)) {
        return current;
      }

      return nextContent;
    });
    setSignature((current) =>
      current === nextContent.activeSignatureText ? current : nextContent.activeSignatureText
    );
  }, [
    composeContentState,
    composeIdentity,
    composeIntent,
    composeOpen,
    defaultSignature,
    presetDefinitions,
    signatureDefinitions
  ]);
  const imageAttachments = composeAttachments.filter((file) =>
    file.type.startsWith("image/")
  );
  const fileAttachments = composeAttachments.filter(
    (file) => !file.type.startsWith("image/")
  );
  const senderSuggestions = useMemo(() => {
    const messageSuggestions: string[] = [];

    for (const message of messages) {
      const senderSuggestion = buildRecipientSuggestion(message.from, message.fromAddress);
      if (senderSuggestion) {
        messageSuggestions.push(senderSuggestion);
      }

      for (const recipient of normalizeRecipientStrings(message.to)) {
        if (recipient.includes("@")) {
          messageSuggestions.push(recipient);
        }
      }

      for (const recipient of normalizeRecipientStrings(message.cc)) {
        if (recipient.includes("@")) {
          messageSuggestions.push(recipient);
        }
      }
    }

    return mergeRecipientSuggestionLists(recentRecipients, messageSuggestions);
  }, [messages, recentRecipients]);
  const contactsPickerSupported = browserSupportsSystemContacts();
  const showToast = useCallback((message: string, type: Toast["type"] = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((current) => [...current, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3200);
  }, []);

  const syncUnreadIndicators = useCallback(
    (nextMessages: MailSummary[]) => {
      if (typeof document === "undefined") {
        return;
      }

      const totalUnread = nextMessages.filter((message) => !message.seen).length;
      document.title = document.hasFocus()
        ? "Maximail"
        : totalUnread > 0
          ? `(${totalUnread}) Maximail`
          : "Maximail";

      if (!notifPlatform.canBadge || typeof navigator === "undefined") {
        return;
      }

      const badgeNavigator = navigator as Navigator & {
        setAppBadge?: (value?: number) => Promise<void>;
        clearAppBadge?: () => Promise<void>;
      };

      if (document.hasFocus() || totalUnread === 0) {
        void badgeNavigator.clearAppBadge?.().catch(() => {});
        return;
      }

      void badgeNavigator.setAppBadge?.(totalUnread).catch(() => {});
    },
    [notifPlatform.canBadge]
  );

  const syncServerPreferences = useCallback(
    (accountId: string, payload: ServerPreferencesPayload) => {
      void patchJson(`/api/accounts/${accountId}/preferences`, payload).catch(() => {
        // Keep local preferences even if the server sync misses.
      });
    },
    []
  );

  const loadServerPreferences = useCallback(
    async (accountId: string) => {
      try {
        const result = await getJson<{
          prioritizedSenders: { name: string; email: string; color: string }[];
          autoFilters: {
            senderName: string;
            senderEmail: string;
            keepDays: 1 | 7 | 30 | 60 | 90;
            createdAt: string;
          }[];
          blockedSenders: string[];
        }>(`/api/accounts/${accountId}/preferences`);

        if (result.prioritizedSenders.length > 0) {
          setPrioritizedSenders(result.prioritizedSenders);
        }

        setAutoFilters((local) => {
          const serverEmails = new Set(result.autoFilters.map((rule) => rule.senderEmail));
          const localOnly = local.filter((rule) => !serverEmails.has(rule.senderEmail));
          return [...result.autoFilters, ...localOnly];
        });

        setBlockedSenders((local) => new Set([...local, ...result.blockedSenders]));
      } catch {
        // Local preferences remain available offline.
      }
    },
    []
  );

  const openAutoFilterEditor = useCallback(
    (target: { name: string; email: string }) => {
      setAutoFilterTarget(target);
      const existing = autoFilters.find(
        (filterRule) =>
          (target.email && filterRule.senderEmail === target.email) ||
          filterRule.senderName === target.name
      );
      setAutoFilterDays(existing?.keepDays ?? 30);
    },
    [autoFilters]
  );

  const requestNotificationPermission = useCallback(async () => {
    if (!notifPlatform.canWebNotify) {
      return;
    }

    try {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
      if (result === "granted") {
        showToast("Notifications enabled", "success");
        new Notification("Maximail notifications are on", {
          body: "You'll be notified when new mail arrives.",
          icon: "/icon-192.png",
          tag: "maximail-permission-confirmed"
        });
      }
    } catch {
      // Some browsers throw if this is not called from a user gesture.
    }
  }, [notifPlatform.canWebNotify, showToast]);

  useEffect(() => {
    const onFocus = () => {
      const el = getActiveEditableElement();
      if (el) {
        lastEditableRef.current = el;
      }
      setEditableActive(!!el);
    };
    const onBlur = () => {
      window.setTimeout(() => {
        const el = getActiveEditableElement();
        if (el) {
          lastEditableRef.current = el;
        }
        setEditableActive(!!el);
      }, 100);
    };

    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    onFocus();

    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
    };
  }, []);

  const applyAccountToConnection = useCallback(
    (account: MailAccountSummary, folderOverride?: string | null) => {
      const nextFolder = folderOverride || account.defaultFolder || "INBOX";
      setConnection((current) => ({
        ...current,
        email: account.email,
        password: current.email === account.email ? current.password : "",
        imapHost: account.imapHost,
        imapPort: account.imapPort,
        imapSecure: account.imapSecure,
        smtpHost: account.smtpHost,
        smtpPort: account.smtpPort,
        smtpSecure: account.smtpSecure,
        folder: nextFolder
      }));
    },
    []
  );

  const loadFoldersForAccount = useCallback(
    async (accountId: string, sync = false) => {
      const folderResponse = await getJson<{ folders: MailFolder[] }>(
        `/api/accounts/${accountId}/folders${sync ? "?sync=true" : ""}`
      );
      setFoldersByAccount((current) => ({
        ...current,
        [accountId]: folderResponse.folders
      }));

      if (accountId === activeAccountIdRef.current) {
        setFolders(folderResponse.folders);
      }

      return folderResponse.folders;
    },
    []
  );

  const loadPersistedAccounts = useCallback(
    async (preferredAccountId?: string | null) => {
      const response = await getJson<{ accounts: MailAccountSummary[] }>("/api/accounts");
      const nextAccounts = response.accounts;
      setAccounts(nextAccounts);
      setFoldersByAccount((current) => {
        const allowed = new Set(nextAccounts.map((account) => account.id));
        return Object.fromEntries(
          Object.entries(current).filter(([accountId]) => allowed.has(accountId))
        );
      });

      if (
        explicitActiveAccountIdRef.current &&
        !nextAccounts.some((account) => account.id === explicitActiveAccountIdRef.current)
      ) {
        explicitActiveAccountIdRef.current = null;
      }

      if (nextAccounts.length === 0) {
        explicitActiveAccountIdRef.current = null;
        setActiveAccountId(null);
        setFolders([]);
        setMessages([]);
        setSelectedMessage(null);
        setSelectedUid(null);
        return null;
      }

      const nextActiveAccount =
        nextAccounts.find((account) => account.id === preferredAccountId) ??
        nextAccounts.find((account) => account.id === explicitActiveAccountIdRef.current) ??
        nextAccounts.find((account) => account.id === activeAccountIdRef.current) ??
        nextAccounts.find((account) => account.id === restoredAccountIdRef.current) ??
        nextAccounts.find((account) => account.isDefault) ??
        nextAccounts[0];

      if (!nextActiveAccount) {
        setActiveAccountId(null);
        setMessages([]);
        setSelectedMessage(null);
        setSelectedUid(null);
        return null;
      }

      if (preferredAccountId) {
        explicitActiveAccountIdRef.current = nextActiveAccount.id;
      }

      const currentActiveAccountId = activeAccountIdRef.current;
      const accountChanged = currentActiveAccountId !== nextActiveAccount.id;

      if (accountChanged) {
        setMessages([]);
        setSelectedMessage(null);
        setSelectedUid(null);
        setActiveAccountId(nextActiveAccount.id);
        applyAccountToConnection(nextActiveAccount, restoredFolderRef.current);
      }

      return nextActiveAccount;
    },
    [applyAccountToConnection]
  );

  const activateAccount = useCallback(
    async (
      account: MailAccountSummary,
      options?: { sync?: boolean; makeDefault?: boolean; folderOverride?: string | null }
    ) => {
      const folder = options?.folderOverride || account.defaultFolder || "INBOX";

      if (options?.makeDefault) {
        await patchJson<{ account: MailAccountSummary }>(`/api/accounts/${account.id}`, {
          makeDefault: true
        });
      }

      explicitActiveAccountIdRef.current = account.id;
      setMessages([]);
      setSelectedMessage(null);
      setSelectedUid(null);
      setActiveAccountId(account.id);
      applyAccountToConnection(account, folder);
      await loadFoldersForAccount(account.id, options?.sync ?? false);

      const loadedMessages = await loadMessages(folder, {
        force: options?.sync ?? false,
        manageBusy: false,
        accountIdOverride: account.id,
        preserveSelection: false
      });

      clearMessageViewState(
        setSelectedUid,
        setSelectedMessage,
        setQuery,
        setSenderFilter,
        setSubjectFilter,
        setSubjectPattern
      );
      if (loadedMessages[0]) {
        await loadMessageIntoReader(loadedMessages[0], {
          accountId: account.id,
          folderPath: folder,
          markSeen: false
        });
      } else {
        setSelectedUid(null);
      }
      setStatus(`Loaded ${loadedMessages.length} messages from ${folder}.`);
    },
    [applyAccountToConnection, loadFoldersForAccount, loadMessageIntoReader]
  );

  const getComposeAttachmentId = useCallback((file: File) => {
    const existing = composeAttachmentIdsRef.current.get(file);
    if (existing) {
      return existing;
    }

    composeAttachmentIdCounterRef.current += 1;
    const nextId = `compose-attachment-${composeAttachmentIdCounterRef.current}`;
    composeAttachmentIdsRef.current.set(file, nextId);
    return nextId;
  }, []);

  const getComposeAttachmentState = useCallback(
    (draftId?: string): AttachmentState[] =>
      composeAttachments.map((file) => ({
        draftId,
        attachmentId: getComposeAttachmentId(file),
        name: file.name,
        size: file.size,
        type: file.type,
        kind: file.type.startsWith("image/") ? "photo" : "file",
        inline: file.type.startsWith("image/")
      })),
    [composeAttachments, getComposeAttachmentId]
  );

  const updateComposeReplyToValue = useCallback((value: string) => {
    setComposeReplyTo(value);
    setComposeIdentity((current) =>
      current
        ? {
            ...current,
            replyTo: value
          }
        : current
    );
  }, []);

  const updateComposeRecipientBucket = useCallback(
    (bucket: ComposeRecipientBucket, values: string[]) => {
      const nextRecipients = normalizeRecipientGroups({
        to: bucket === "to" ? values : composeToList,
        cc: bucket === "cc" ? values : composeCcList,
        bcc: bucket === "bcc" ? values : composeBccList
      });

      setComposeToList(nextRecipients.to);
      setComposeCcList(nextRecipients.cc);
      setComposeBccList(nextRecipients.bcc);
    },
    [composeBccList, composeCcList, composeToList]
  );

  const importSystemContactsForBucket = useCallback(
    async (bucket: ComposeRecipientBucket) => {
      if (!browserSupportsSystemContacts()) {
        setStatus("System contacts aren't available in this browser.");
        return;
      }

      try {
        const contactsApi = (
          navigator as Navigator & {
            contacts?: {
              select?: (
                properties: string[],
                options?: { multiple?: boolean }
              ) => Promise<BrowserContactRecord[]>;
            };
          }
        ).contacts;

        const contacts = (await contactsApi?.select?.(["name", "email"], {
          multiple: true
        })) ?? [];

        if (contacts.length === 0) {
          return;
        }

        const importedRecipients = contacts.flatMap((contact) => {
          const displayName = contact.name?.find((value) => value.trim()) ?? "";

          return (contact.email ?? [])
            .map((email) => buildRecipientSuggestion(displayName, email))
            .filter((value): value is string => Boolean(value));
        });

        if (importedRecipients.length === 0) {
          setStatus("No usable contact email addresses were selected.");
          return;
        }

        const nextRecipients = normalizeRecipientStrings([
          ...(bucket === "to" ? composeToList : bucket === "cc" ? composeCcList : composeBccList),
          ...importedRecipients
        ]);

        updateComposeRecipientBucket(bucket, nextRecipients);
        setRecentRecipients((current) =>
          mergeRecipientSuggestionLists(current, importedRecipients)
        );
      } catch (error) {
        setStatus(
          error instanceof Error ? error.message : "Unable to import system contacts."
        );
      }
    },
    [composeBccList, composeCcList, composeToList, updateComposeRecipientBucket]
  );

  function resolveComposeContentForSession(
    identity: ComposeIdentityState | null,
    intent: ComposeIntent,
    persistedState?: Partial<ComposeContentState> | null
  ) {
    return resolveComposeContentState({
      identity,
      intent,
      signatureDefinitions,
      presetDefinitions,
      fallbackSignature: defaultSignature,
      persistedState
    });
  }

  const switchComposeSenderIdentity = useCallback(
    (senderId: string) => {
      setComposeIdentity((current) => {
        const resolved = resolveComposeIdentityState({
          accounts,
          preferredAccountId:
            composeSessionContext?.ownerAccountId ?? current?.accountId ?? undefined,
          ownerAccountId: composeSessionContext?.ownerAccountId,
          ownerLocked: composeSessionContext?.ownerLocked,
          persistedIdentity: current,
          persistedReplyTo: composeReplyTo
        });
        const nextSender =
          resolved.availableSenders.find((sender) => sender.id === senderId) ?? resolved.sender;

        if (!nextSender || !canUseIdentity(composeSessionContext, nextSender)) {
          return resolved;
        }

        const nextIdentity = {
          ...resolved,
          accountId: nextSender.accountId,
          sender: nextSender,
          signatureContextId: nextSender.id
        };
        const nextContent = resolveComposeContentState({
          identity: nextIdentity,
          intent: composeIntent,
          signatureDefinitions,
          presetDefinitions,
          fallbackSignature: defaultSignature,
          persistedState: composeContentState
        });

        setComposeContentState(nextContent);
        setSignature(nextContent.activeSignatureText);

        if (
          composeLocalRevisionRef.current === 0 &&
          composeContentState?.defaultSignatureInserted &&
          composeContentState.activeSignatureText.trim() &&
          nextContent.activeSignatureText.trim()
        ) {
          const nextBody = composeBody.replace(
            composeContentState.activeSignatureText,
            nextContent.activeSignatureText
          );

          if (nextBody !== composeBody) {
            setComposeBody(nextBody);
            updateComposeCounts(nextBody);
            window.setTimeout(() => {
              const editor = composeEditorRef.current;
              if (editor && !composePlainText) {
                editor.innerHTML = nextBody.replace(/\n/g, "<br/>");
              }
            }, 0);
          }
        }

        return nextIdentity;
      });
    },
    [
      accounts,
      composeBody,
      composeContentState,
      composeIntent,
      composePlainText,
      composeReplyTo,
      composeSessionContext,
      defaultSignature,
      presetDefinitions,
      signatureDefinitions
    ]
  );

  const buildComposeDraftSnapshot = useCallback(
    async (localRevision = composeLocalRevisionRef.current): Promise<DraftSnapshotInput | null> => {
      if (!composeOpen || !composeDraftId) {
        return null;
      }

      const editor = composeEditorRef.current;
      const htmlBody = composePlainText
        ? composeBody.replace(/\n/g, "<br/>")
        : editor?.innerHTML ?? composeBody;
      const attachmentState = getComposeAttachmentState(composeDraftId);
      const attachments = await Promise.all(
        composeAttachments.map(async (file, index) => ({
          ...attachmentState[index],
          dataUrl: await (async () => {
            const cached = composeAttachmentDataUrlCacheRef.current.get(file);
            if (cached) {
              return await cached;
            }

            const next = fileToDataUrl(file)
              .then((dataUrl) => {
                composeAttachmentDataUrlCacheRef.current.set(file, dataUrl);
                return dataUrl;
              })
              .catch((error) => {
                composeAttachmentDataUrlCacheRef.current.delete(file);
                throw error;
              });

            composeAttachmentDataUrlCacheRef.current.set(file, next);
            return await next;
          })()
        }))
      );

      return {
        draftId: composeDraftId,
        accountId: composeSessionContext?.ownerAccountId ?? composeIdentity?.ownerAccountId,
        composeSessionContext,
        draftIdentitySnapshot: createDraftIdentitySnapshot(
          composeSessionContext,
          composeIdentity
        ),
        composeIdentity,
        composeContentState,
        composeIntent,
        sourceMessageMeta: composeSourceMessageMeta,
        subject: composeSubject,
        to: composeRecipients.to,
        cc: composeRecipients.cc,
        bcc: composeRecipients.bcc,
        replyTo: composeReplyTo,
        htmlBody,
        textBody: composeBody,
        signature,
        attachments,
        localRevision,
        lastSavedRevision: composeLastSavedRevisionRef.current
      };
    },
    [
      composeAttachments,
      composeBody,
      composeContentState,
      composeDraftId,
      composeIdentity,
      composeIntent,
      composeOpen,
      composePlainText,
      composeRecipients.bcc,
      composeRecipients.cc,
      composeRecipients.to,
      composeSourceMessageMeta,
      composeReplyTo,
      composeSessionContext,
      composeSubject,
      createDraftIdentitySnapshot,
      getComposeAttachmentState,
      signature
    ]
  );

  const clearPersistedComposeDraft = useCallback(async () => {
    await draftServiceRef.current.clearDraft(DRAFT_STORAGE_KEY);
    setComposeDraft(null);
    setComposeDraftId(null);
    setComposeSessionContext(null);
    setComposeIdentity(null);
    setComposeContentState(null);
    setComposeIntent({ kind: "new" });
    setComposeSourceMessageMeta(null);
    setComposeDraftStatus("idle");
    setComposeDraftSavedAt(null);
    setComposeDraftError(null);
    composeLocalRevisionRef.current = 0;
    composeLastSavedRevisionRef.current = 0;
    autosaveServiceRef.current?.cancel();
  }, []);

  const handleBlockedSenderSelection = useCallback(
    (sender: string, event: ReactMouseEvent<HTMLButtonElement>) => {
      if (event.shiftKey && blockedSelectionAnchor) {
        const anchorIndex = filteredBlockedSenders.indexOf(blockedSelectionAnchor);
        const currentIndex = filteredBlockedSenders.indexOf(sender);

        if (anchorIndex !== -1 && currentIndex !== -1) {
          const [start, end] =
            anchorIndex < currentIndex
              ? [anchorIndex, currentIndex]
              : [currentIndex, anchorIndex];
          const range = filteredBlockedSenders.slice(start, end + 1);

          setSelectedBlockedSenders((current) => {
            const next =
              event.metaKey || event.ctrlKey ? new Set(current) : new Set<string>();
            range.forEach((entry) => next.add(entry));
            return next;
          });
          setBlockedSelectionAnchor(sender);
          return;
        }
      }

      if (event.metaKey || event.ctrlKey) {
        setSelectedBlockedSenders((current) => {
          const next = new Set(current);
          if (next.has(sender)) {
            next.delete(sender);
          } else {
            next.add(sender);
          }
          return next;
        });
        setBlockedSelectionAnchor(sender);
        return;
      }

      setSelectedBlockedSenders(new Set([sender]));
      setBlockedSelectionAnchor(sender);
    },
    [blockedSelectionAnchor, filteredBlockedSenders]
  );

  const handleUnblockSelectedSenders = useCallback(() => {
    if (selectedBlockedSenders.size === 0) {
      return;
    }

    const toUnblock = new Set(selectedBlockedSenders);
    setBlockedSenders((current) => {
      const next = new Set(current);
      toUnblock.forEach((sender) => next.delete(sender));
      return next;
    });
    setSelectedBlockedSenders(new Set());
    setBlockedSelectionAnchor(null);
    showToast(
      `${toUnblock.size} sender${toUnblock.size === 1 ? "" : "s"} unblocked`
    );
  }, [selectedBlockedSenders, showToast]);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    setSelectedBlockedSenders((current) => {
      const next = new Set(
        Array.from(current).filter((sender) => blockedSenders.has(sender))
      );
      return next.size === current.size ? current : next;
    });

    if (blockedSelectionAnchor && !blockedSenders.has(blockedSelectionAnchor)) {
      setBlockedSelectionAnchor(null);
    }
  }, [blockedSelectionAnchor, blockedSenders]);

  useEffect(() => {
    const visibleBlocked = new Set(filteredBlockedSenders);

    setSelectedBlockedSenders((current) => {
      const next = new Set(
        Array.from(current).filter((sender) => visibleBlocked.has(sender))
      );
      return next.size === current.size ? current : next;
    });

    if (blockedSelectionAnchor && !visibleBlocked.has(blockedSelectionAnchor)) {
      setBlockedSelectionAnchor(null);
    }
  }, [blockedSelectionAnchor, filteredBlockedSenders]);

  useEffect(() => {
    if (settingsOpen) {
      if (settingsTab === "account" && accountFormMode === null && accounts.length === 0) {
        openAddAccount();
      }
      return;
    }

    setBlockedSearch("");
    setSelectedBlockedSenders(new Set());
    setBlockedSelectionAnchor(null);
    closeAccountForm();
  }, [accountFormMode, accounts.length, settingsOpen, settingsTab]);

  useEffect(() => {
    if (
      accountFormMode === "edit" &&
      accountFormTarget &&
      !accounts.some((account) => account.id === accountFormTarget)
    ) {
      closeAccountForm();
    }
  }, [accountFormMode, accountFormTarget, accounts]);

  useEffect(() => {
    setStoredPasswordHintVisible(Boolean(activeAccount) && connection.password.trim().length === 0);
  }, [activeAccount, connection.password]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    syncUnreadIndicators(messages);
  }, [messages, syncUnreadIndicators]);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Service worker registration is optional for installability support.
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const clamp = () => {
      setComposeHeight((height) => Math.min(height, window.innerHeight - 80));
      setComposeWidth((width) => Math.min(width, getComposeMaxWidth()));
      setComposePos((current) => {
        if (!current) {
          return current;
        }

        const width = Math.min(composeWidth, getComposeMaxWidth());
        const height = composeHeight;

        return {
          x: Math.max(0, Math.min(current.x, window.innerWidth - width)),
          y: Math.max(80, Math.min(current.y, window.innerHeight - height))
        };
      });
    };

    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [composeHeight, composeWidth]);

  useEffect(() => {
    activeAccountIdRef.current = activeAccountId;
  }, [activeAccountId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (didBootstrapAccountsRef.current) {
      return;
    }
    didBootstrapAccountsRef.current = true;
    restoredAccountIdRef.current = window.sessionStorage.getItem("mmwbmail-active-account-id");
    restoredFolderRef.current = window.sessionStorage.getItem("mmwbmail-active-folder");
    explicitActiveAccountIdRef.current = restoredAccountIdRef.current;

    void loadPersistedAccounts(restoredAccountIdRef.current)
      .then(async (account) => {
        if (!account) {
          setStatus("Connect a live mailbox to begin.");
          return;
        }

        try {
          await activateAccount(account, {
            sync: false,
            folderOverride: restoredFolderRef.current
          });
        } catch {
          // Leave the account selected even if the first folder read fails.
        }

        setStatus(`Account ready for ${account.email}.`);
      })
      .catch(() => {
        setStatus("Connect a live mailbox to begin.");
      });
  }, [activateAccount, loadPersistedAccounts]);

  useEffect(() => {
    const saved = window.sessionStorage.getItem("mmwbmail-folder-order");
    const hasCustomOrder =
      window.sessionStorage.getItem("mmwbmail-folder-order-custom") === "1";

    if (!saved || !hasCustomOrder) {
      return;
    }

    try {
      const parsed = JSON.parse(saved) as string[];
      setFolderOrder(parsed);
    } catch {
      window.sessionStorage.removeItem("mmwbmail-folder-order");
      window.sessionStorage.removeItem("mmwbmail-folder-order-custom");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (activeAccountId) {
      window.sessionStorage.setItem("mmwbmail-active-account-id", activeAccountId);
    } else {
      window.sessionStorage.removeItem("mmwbmail-active-account-id");
    }
  }, [activeAccountId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (currentFolderPath) {
      window.sessionStorage.setItem("mmwbmail-active-folder", currentFolderPath);
    } else {
      window.sessionStorage.removeItem("mmwbmail-active-folder");
    }
  }, [currentFolderPath]);

  useEffect(() => {
    prevMessageUidsRef.current = new Set();
  }, [activeAccountId, currentFolderPath]);

  useEffect(() => {
    if (!activeAccountId) {
      return;
    }

    setFoldersByAccount((current) => {
      if (current[activeAccountId] === folders) {
        return current;
      }

      return {
        ...current,
        [activeAccountId]: folders
      };
    });
  }, [activeAccountId, folders]);

  useEffect(() => {
    if (accounts.length === 0) {
      return;
    }

    accounts.forEach((account) => {
      if (!foldersByAccount[account.id]) {
        void loadFoldersForAccount(account.id, !account.lastSyncedAt);
      }
    });
  }, [accounts, foldersByAccount, loadFoldersForAccount]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const close = () => setContextMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!listAreaContextMenu) {
      return;
    }

    const close = () => setListAreaContextMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [listAreaContextMenu]);

  useEffect(() => {
    if (!sidebarCtx) {
      return;
    }

    const close = () => setSidebarCtx(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [sidebarCtx]);

  useEffect(() => {
    if (!folderContextMenu) {
      return;
    }

    const close = () => setFolderContextMenu(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [folderContextMenu]);

  useEffect(() => {
    if (sortMenuUid === null) {
      return;
    }

    const close = (event: MouseEvent) => {
      if (sortMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setSortMenuUid(null);
    };

    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [sortMenuUid]);

  useEffect(() => {
    if (cleanupSortMenuSender === null) {
      return;
    }

    const close = (event: MouseEvent) => {
      if (cleanupSortMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setCleanupSortMenuSender(null);
    };

    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [cleanupSortMenuSender]);

  useEffect(() => {
    if (!bulkSelectionMenu) {
      return;
    }

    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (bulkSelectionMenu === "sort" && bulkSortMenuRef.current?.contains(target)) {
        return;
      }
      if (bulkSelectionMenu === "more" && bulkMoreMenuRef.current?.contains(target)) {
        return;
      }

      setBulkSelectionMenu(null);
    };

    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [bulkSelectionMenu]);

  useEffect(() => {
    if (!mobileViewerMenuOpen) {
      return;
    }

    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (mobileViewerMenuRef.current?.contains(target)) {
        return;
      }

      setMobileViewerMenuOpen(false);
    };

    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [mobileViewerMenuOpen]);

  useEffect(() => {
    setMobileViewerMenuOpen(false);
  }, [isMobileStackedMode, selectedMessage?.uid]);

  useEffect(() => {
    const syncWorkspaceMode = () => {
      const nextInteractionMode = resolveResponsiveInteractionMode({
        viewportWidth: window.innerWidth
      });
      const wide = nextInteractionMode === "desktop-workspace";
      setResponsiveInteractionMode(nextInteractionMode);
      if (!wide) {
        return;
      }

      const containerWidth = workspaceRef.current?.clientWidth ?? 0;
      if (containerWidth > 0) {
        setWorkspacePaneWidths((current) => clampWorkspacePaneWidths(current, containerWidth));
      }
    };

    syncWorkspaceMode();
    window.addEventListener("resize", syncWorkspaceMode);
    return () => window.removeEventListener("resize", syncWorkspaceMode);
  }, [clampWorkspacePaneWidths]);

  useEffect(() => {
    const previousInteractionMode = previousResponsiveInteractionModeRef.current;

    if (
      previousInteractionMode !== responsiveInteractionMode &&
      responsiveInteractionMode === "mobile-stacked"
    ) {
      setMobileStackedScreen(
        resolveMobileStackedScreen({
          hasAccounts: accounts.length > 0,
          hasActiveMailboxContext: Boolean(activeAccountId && currentFolderPath),
          hasSelectedMessage: Boolean(selectedMessage)
        })
      );
    }

    if (
      previousInteractionMode !== responsiveInteractionMode &&
      previousInteractionMode === "mobile-stacked" &&
      responsiveInteractionMode === "desktop-workspace" &&
      mobileStackedScreen !== "viewer"
    ) {
      openMessageSeqRef.current += 1;
      setSelectedMessage(null);
      setSelectedUid(null);
    }

    previousResponsiveInteractionModeRef.current = responsiveInteractionMode;
  }, [
    accounts.length,
    activeAccountId,
    currentFolderPath,
    mobileStackedScreen,
    responsiveInteractionMode,
    selectedMessage
  ]);

  useEffect(() => {
    if (!isMobileStackedMode) {
      return;
    }

    setMobileStackedScreen((current) => {
      if (accounts.length === 0 || !activeAccountId || !currentFolderPath) {
        return current === "mailboxes" ? current : "mailboxes";
      }

      if (current === "viewer" && !selectedMessage) {
        return "messages";
      }

      return current;
    });
  }, [accounts.length, activeAccountId, currentFolderPath, isMobileStackedMode, selectedMessage]);

  useEffect(() => {
    if (!openMenu) {
      return;
    }

    const close = () => {
      setOpenMenu(null);
      setOpenSubmenu(null);
    };

    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [openMenu]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const coarse = window.matchMedia("(pointer: coarse)").matches;
    setIsCoarsePointer(coarse);

    if (coarse && !swipeHintShown) {
      const timer = window.setTimeout(() => setSwipeHintShown(true), 4000);
      return () => window.clearTimeout(timer);
    }
  }, [swipeHintShown]);

  useEffect(() => {
    setSortMenuUid(null);
  }, [activeAccountId, currentFolderPath, selectedUid]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const data = loadUserData();
    setRecentRecipients(data.recentRecipients ?? []);
    setPrioritizedSenders(data.prioritizedSenders);
    setAutoFilters(data.autoFilters);
    setBlockedSenders(new Set(data.blockedSenders));
    setPinnedMessages(new Set(data.pinnedMessages));
    setSidebarSize(data.prefs.sidebarSize);
    setDefaultSignature(data.prefs.signature);
    setSignatureDefinitions(data.signatureDefinitions ?? []);
    setPresetDefinitions(data.presetDefinitions ?? []);
    setThreadingEnabled(data.prefs.threadingEnabled ?? true);
    setMailboxViewMode(data.prefs.mailboxViewMode ?? "classic");
    setCollapsedSortFolderVisibility(
      data.prefs.collapsedSortFolderVisibility ?? "essential_only"
    );
    setAccountMailboxDisclosureStates(data.prefs.accountMailboxDisclosureStates ?? {});
    setLightweightOnboardingDismissed(data.prefs.lightweightOnboardingDismissed ?? false);
    setUserDataReady(true);
  }, []);

  useEffect(() => {
    if (!userDataReady || !activeAccountId) {
      return;
    }

    void loadServerPreferences(activeAccountId);
  }, [activeAccountId, loadServerPreferences, userDataReady]);

  useEffect(() => {
    if (!userDataReady) {
      return;
    }

    persistUserData({
      version: USER_DATA_VERSION,
      recentRecipients,
      prioritizedSenders,
      autoFilters,
      blockedSenders: Array.from(blockedSenders),
      pinnedMessages: Array.from(pinnedMessages),
      signatureDefinitions,
      presetDefinitions,
      prefs: {
        sidebarSize,
        signature: defaultSignature,
        threadingEnabled,
        mailboxViewMode,
        collapsedSortFolderVisibility,
        accountMailboxDisclosureStates,
        lightweightOnboardingDismissed
      }
    });

    if (activeAccountId) {
      syncServerPreferences(activeAccountId, {
        prioritizedSenders: Array.from(prioritizedSenders),
        autoFilters,
        blockedSenders: Array.from(blockedSenders)
      });
    }
  }, [
    activeAccountId,
    autoFilters,
    blockedSenders,
    pinnedMessages,
    presetDefinitions,
    prioritizedSenders,
    recentRecipients,
    sidebarSize,
    signatureDefinitions,
    syncServerPreferences,
    defaultSignature,
    accountMailboxDisclosureStates,
    collapsedSortFolderVisibility,
    mailboxViewMode,
    threadingEnabled,
    lightweightOnboardingDismissed,
    userDataReady
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    void draftServiceRef.current
      .recoverDraft({ storageKey: DRAFT_STORAGE_KEY })
      .then(({ draft }) => {
        if (!draft) {
          return;
        }

        setComposeDraft(draft);
        setComposeDraftId(draft.draftId);
        setComposeDraftStatus("saved");
        setComposeDraftSavedAt(draft.savedAt ?? draft.updatedAt);
        composeLocalRevisionRef.current = draft.localRevision;
        composeLastSavedRevisionRef.current = draft.lastSavedRevision;
      })
      .catch(() => {
        // Ignore malformed saved draft state.
      });
  }, []);

  useEffect(() => {
    autosaveServiceRef.current = createAutosaveService({
      debounceMs: 1400,
      saveDraft: async (input) => {
        const result = await draftServiceRef.current.saveDraft(input);
        setComposeDraft(result.draft);
        return result;
      },
      onStatusChange: (state) => {
        setComposeDraftStatus(state.status);
        setComposeDraftError(state.error ?? null);
        if (state.savedAt) {
          setComposeDraftSavedAt(state.savedAt);
        }
        composeLastSavedRevisionRef.current = state.lastSavedRevision;
      }
    });

    return () => {
      autosaveServiceRef.current?.cancel();
      autosaveServiceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !composeOpen || !composeDraftId) {
      return;
    }

    composeLocalRevisionRef.current += 1;
    draftServiceRef.current.markLocalDirty({
      draftId: composeDraftId,
      localRevision: composeLocalRevisionRef.current
    });

    const autosave = autosaveServiceRef.current;
    if (!autosave) {
      return;
    }

    void buildComposeDraftSnapshot(composeLocalRevisionRef.current).then((snapshot) => {
      if (!snapshot) {
        return;
      }

      autosave.schedule({
        storageKey: DRAFT_STORAGE_KEY,
        draft: snapshot
      });
    });
  }, [
    buildComposeDraftSnapshot,
    composeBccList,
    composeBody,
    composeCcList,
    composeDraftId,
    composeOpen,
    composePlainText,
    composeReplyTo,
    composeSubject,
    composeToList,
    composeAttachments,
    signature
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !composeOpen || !composeDraftId) {
      return;
    }

    const flushDraft = () => {
      void buildComposeDraftSnapshot(composeLocalRevisionRef.current).then((snapshot) => {
        if (!snapshot || !autosaveServiceRef.current) {
          return;
        }

        void autosaveServiceRef.current.flush({
          storageKey: DRAFT_STORAGE_KEY,
          draft: snapshot
        });
      });
    };

    window.addEventListener("pagehide", flushDraft);
    window.addEventListener("beforeunload", flushDraft);
    return () => {
      window.removeEventListener("pagehide", flushDraft);
      window.removeEventListener("beforeunload", flushDraft);
    };
  }, [buildComposeDraftSnapshot, composeDraftId, composeOpen]);

  useEffect(() => {
    if (!composeOpen || !composeEditorRef.current) {
      return;
    }

    composeEditorRef.current.innerHTML = composeBody.replace(/\n/g, "<br/>");
  }, [composeOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    persistComposerToolbarPreferences(composeToolbarPreferences);
  }, [composeToolbarPreferences]);

  useEffect(() => {
    if (!composeOpen) {
      setComposeToolbarMenuOpen(false);
      setComposeToolbarOverflowOpen(false);
      setComposeQuickInsertOpen(false);
      setComposeSelectionToolbarPos(null);
      setComposeFormatSelection({
        fontFamily: "",
        fontSize: ""
      });
      setComposeSelectionState({
        hasSelection: false,
        text: "",
        isCollapsed: true
      });
      return;
    }

    const syncSelectionState = () => {
      const selectionToolbarWidth = 212;
      const selectionToolbarHeight = 38;
      const viewportPadding = 8;

      if (composePlainText) {
        const textarea = composePlainTextRef.current;
        if (!textarea || document.activeElement !== textarea) {
          setComposeSelectionToolbarPos(null);
          setComposeFormatSelection({
            fontFamily: "",
            fontSize: ""
          });
          setComposeSelectionState({
            hasSelection: false,
            text: "",
            isCollapsed: true
          });
          return;
        }

        const start = textarea.selectionStart ?? 0;
        const end = textarea.selectionEnd ?? start;
        const selectedText = textarea.value.slice(start, end);
        setComposeSelectionToolbarPos(null);
        setComposeSelectionState({
          hasSelection: selectedText.length > 0,
          text: selectedText,
          isCollapsed: start === end
        });
        return;
      }

      const editor = composeEditorRef.current;
      const selection = window.getSelection();
      const anchorNode = selection?.anchorNode ?? null;

      if (!editor || !selection || !anchorNode || !editor.contains(anchorNode)) {
        setComposeSelectionToolbarPos(null);
        setComposeFormatSelection({
          fontFamily: "",
          fontSize: ""
        });
        setComposeSelectionState({
          hasSelection: false,
          text: "",
          isCollapsed: true
        });
        return;
      }

      if (selection.rangeCount > 0) {
        savedRangeRef.current = selection.getRangeAt(0).cloneRange();
      }

      const text = selection.toString();
      const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      const rect = range?.getBoundingClientRect();
      if (
        rect &&
        !selection.isCollapsed &&
        text.trim().length > 0 &&
        rect.width > 0 &&
        rect.height > 0
      ) {
        const preferredLeft = rect.left + rect.width / 2 - selectionToolbarWidth / 2;
        const clampedLeft = Math.max(
          viewportPadding,
          Math.min(preferredLeft, window.innerWidth - selectionToolbarWidth - viewportPadding)
        );
        const openAbove = rect.top >= selectionToolbarHeight + 18;
        const top = openAbove
          ? Math.max(viewportPadding, rect.top - selectionToolbarHeight - 10)
          : Math.min(rect.bottom + 10, window.innerHeight - selectionToolbarHeight - viewportPadding);

        setComposeSelectionToolbarPos({
          top,
          left: clampedLeft
        });
      } else {
        setComposeSelectionToolbarPos(null);
      }

      const nextFontFamily = normalizeComposeFontFamilyValue(
        queryEditableCommandValue("fontName", editor)
      );
      const nextFontSize = normalizeComposeFontSizeValue(
        queryEditableCommandValue("fontSize", editor)
      );

      setComposeFormatSelection((current) =>
        current.fontFamily === nextFontFamily && current.fontSize === nextFontSize
          ? current
          : {
              fontFamily: nextFontFamily,
              fontSize: nextFontSize
            }
      );

      setComposeSelectionState({
        hasSelection: text.length > 0,
        text,
        isCollapsed: selection.isCollapsed
      });
    };

    syncSelectionState();
    document.addEventListener("selectionchange", syncSelectionState);
    window.addEventListener("resize", syncSelectionState);
    window.addEventListener("scroll", syncSelectionState, true);
    return () => {
      document.removeEventListener("selectionchange", syncSelectionState);
      window.removeEventListener("resize", syncSelectionState);
      window.removeEventListener("scroll", syncSelectionState, true);
    };
  }, [composeOpen, composePlainText]);

  useEffect(() => {
    if (!composeToolbarMenuOpen && !composeToolbarOverflowOpen && !composeQuickInsertOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideCustomize = composeToolbarMenuRef.current?.contains(target);
      const insideCustomizePopover = composeToolbarPopoverRef.current?.contains(target);
      const insideOverflow = composeToolbarOverflowRef.current?.contains(target);
      const insideOverflowPopover =
        composeToolbarOverflowPopoverRef.current?.contains(target);
      const insideQuickInsert = composeQuickInsertRef.current?.contains(target);
      const insideQuickInsertPopover =
        composeQuickInsertPopoverRef.current?.contains(target);

      if (
        !insideCustomize &&
        !insideCustomizePopover &&
        !insideOverflow &&
        !insideOverflowPopover &&
        !insideQuickInsert &&
        !insideQuickInsertPopover
      ) {
        setComposeToolbarMenuOpen(false);
        setComposeToolbarMenuPosition(null);
        setComposeToolbarOverflowOpen(false);
        setComposeToolbarOverflowPosition(null);
        setComposeQuickInsertOpen(false);
        setComposeQuickInsertPosition(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [composeQuickInsertOpen, composeToolbarMenuOpen, composeToolbarOverflowOpen]);

  useEffect(() => {
    if (!composeToolbarMenuOpen) {
      setComposeToolbarMenuPosition(null);
      return;
    }

    const syncToolbarMenuPosition = () => {
      updateComposeToolbarMenuPosition();
    };

    syncToolbarMenuPosition();
    window.addEventListener("resize", syncToolbarMenuPosition);
    window.addEventListener("scroll", syncToolbarMenuPosition, true);
    return () => {
      window.removeEventListener("resize", syncToolbarMenuPosition);
      window.removeEventListener("scroll", syncToolbarMenuPosition, true);
    };
  }, [composeToolbarMenuOpen, updateComposeToolbarMenuPosition]);

  useEffect(() => {
    if (!composeToolbarOverflowOpen) {
      setComposeToolbarOverflowPosition(null);
      return;
    }

    const syncToolbarOverflowPosition = () => {
      const nextPosition = getComposeToolbarOverlayPosition(
        composeToolbarOverflowRef.current,
        240,
        280
      );
      setComposeToolbarOverflowPosition(nextPosition);
    };

    syncToolbarOverflowPosition();
    window.addEventListener("resize", syncToolbarOverflowPosition);
    window.addEventListener("scroll", syncToolbarOverflowPosition, true);
    return () => {
      window.removeEventListener("resize", syncToolbarOverflowPosition);
      window.removeEventListener("scroll", syncToolbarOverflowPosition, true);
    };
  }, [composeToolbarOverflowOpen]);

  useEffect(() => {
    if (!composeQuickInsertOpen) {
      setComposeQuickInsertPosition(null);
      return;
    }

    const syncQuickInsertPosition = () => {
      const nextPosition = getComposeToolbarOverlayPosition(
        composeQuickInsertRef.current,
        240,
        260
      );
      setComposeQuickInsertPosition(nextPosition);
    };

    syncQuickInsertPosition();
    window.addEventListener("resize", syncQuickInsertPosition);
    window.addEventListener("scroll", syncQuickInsertPosition, true);
    return () => {
      window.removeEventListener("resize", syncQuickInsertPosition);
      window.removeEventListener("scroll", syncQuickInsertPosition, true);
    };
  }, [composeQuickInsertOpen]);

  useEffect(() => {
    setSenderTrustExpandedUid(null);
    setUnsubscribeConfirm(false);
    setBimiAvatarFailed(false);
  }, [selectedMessage?.uid]);

  useEffect(() => {
    setDomainVerification(null);

    if (!selectedMessage?.fromAddress) {
      return;
    }

    const domain = getDomainFromEmail(selectedMessage.fromAddress);

    if (!domain) {
      return;
    }

    let cancelled = false;

    void postJson<DomainVerificationState>("/api/account/verify-domain", { domain })
      .then((result) => {
        if (!cancelled) {
          setDomainVerification({
            domain: result.domain,
            dmarcPolicy: result.dmarcPolicy,
            bimiVerified: result.bimiVerified,
            bimiLogoUrl: result.bimiLogoUrl,
            trancoRank: result.trancoRank,
            isEsp: result.isEsp
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDomainVerification(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedMessage?.uid, selectedMessage?.fromAddress]);

  useEffect(() => {
    setSuspiciousLinks([]);

    if (!selectedMessage || detectSpoof(selectedMessage).isSpoofed) {
      return;
    }

    if (!selectedMessage.html && !selectedMessage.text) {
      return;
    }

    const urls = Array.from(
      new Set(
        Array.from(
          selectedMessage.html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi),
          (match) => match[1]
        )
      )
    ).slice(0, 50);

    if (urls.length === 0) {
      return;
    }

    let cancelled = false;

    void postJson<{
      matches?: Array<{
        threat?: {
          url?: string;
        };
      }>;
      skipped?: boolean;
    }>("/api/account/check-links", {
      urls
    })
      .then((result) => {
        if (cancelled || result.skipped) {
          return;
        }

        const flaggedUrls = Array.from(
          new Set(
            (result.matches ?? [])
              .map((match) => match.threat?.url)
              .filter((url): url is string => Boolean(url))
          )
        );
        setSuspiciousLinks(flaggedUrls);
      })
      .catch(() => {
        if (!cancelled) {
          setSuspiciousLinks([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedMessage?.uid, selectedMessage?.html, selectedMessage?.text]);

  useEffect(() => {
    if (!selectedImg) {
      return;
    }

    const update = () => setImgRect(selectedImg.getBoundingClientRect());
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [selectedImg]);

  useEffect(() => {
    if (!composeOpen || composePlainText) {
      setSelectedImg(null);
      setImgRect(null);
      closeCropModal();
    }
  }, [composeOpen, composePlainText]);

  useEffect(() => {
    if (!cropModalOpen || !cropSourceImg || !cropCanvasRef.current) {
      return;
    }

    let cancelled = false;
    const image = new Image();

    image.onload = () => {
      if (cancelled || !cropCanvasRef.current) {
        return;
      }

      const maxWidth = 600;
      const maxHeight = 500;
      const scale = Math.min(
        maxWidth / image.naturalWidth,
        maxHeight / image.naturalHeight,
        1
      );
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = cropCanvasRef.current;
      const context = canvas.getContext("2d");

      cropImageRef.current = image;
      canvas.width = width;
      canvas.height = height;
      setCropCanvasSize({ width, height });
      setCropNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
      setCropRect({ x: 0, y: 0, w: width, h: height });

      if (context) {
        context.clearRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
      }
    };

    image.onerror = () => {
      if (!cancelled) {
        showToast("Couldn't open crop tool", "error");
        closeCropModal();
      }
    };

    image.src = cropSourceImg.src;

    return () => {
      cancelled = true;
      cropImageRef.current = null;
    };
  }, [cropModalOpen, cropSourceImg, showToast]);

  useEffect(() => {
    if (!cropModalOpen || !cropRect || !cropCanvasRef.current || !cropImageRef.current) {
      return;
    }

    const canvas = cropCanvasRef.current;
    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(cropImageRef.current, 0, 0, canvas.width, canvas.height);
  }, [cropModalOpen, cropRect]);

  useEffect(() => {
    if (!lightboxOpen) {
      return;
    }

    resetLightboxView();
  }, [lightboxIndex, lightboxOpen]);

  useEffect(() => {
    if (typeof window === "undefined" || !activeAccountId) {
      return;
    }

    const runBackgroundSync = async () => {
      if (autoSyncInFlightRef.current || document.hidden) {
        return;
      }

      autoSyncInFlightRef.current = true;

      try {
        await postJson(`/api/accounts/${activeAccountId}/sync`, {
          folderPaths: [currentFolderPath]
        });
        await refreshFolderCounts(activeAccountId);
        await loadMessages(currentFolderPath, {
          force: true,
          manageBusy: false,
          accountIdOverride: activeAccountId,
          preserveSelection: true,
          skipServerSync: true
        });
      } catch {
        // Ignore background sync failures and keep the current UI state.
      } finally {
        autoSyncInFlightRef.current = false;
      }
    };

    const handleVisible = () => {
      if (!document.hidden) {
        if (notifPlatform.canBadge) {
          const badgeNavigator = navigator as Navigator & {
            clearAppBadge?: () => Promise<void>;
          };
          void badgeNavigator.clearAppBadge?.().catch(() => {});
        }
        document.title = "Maximail";
        if (notifPlatform.canWebNotify) {
          setNotifPermission(Notification.permission);
        }
        void runBackgroundSync();
      }
    };

    const interval = window.setInterval(() => {
      void runBackgroundSync();
    }, 60_000);

    window.addEventListener("focus", handleVisible);
    window.addEventListener("online", handleVisible);
    document.addEventListener("visibilitychange", handleVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleVisible);
      window.removeEventListener("online", handleVisible);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [activeAccountId, currentFolderPath, notifPlatform.canBadge, notifPlatform.canWebNotify]);

  useEffect(() => {
    if (typeof window === "undefined" || !activeAccountId) {
      return;
    }

    let source: EventSource | null = null;
    let pollInterval: number | null = null;
    let pollCursor = new Date().toISOString();
    let disposed = false;

    const queueRefresh = (payload?: {
      events?: Array<{ folderPath?: string | null }>;
      cursor?: string;
    }) => {
      if (payload?.cursor) {
        pollCursor = payload.cursor;
      }

      try {
        const hasRelevantEvent =
          payload?.events?.some(
            (entry) => !entry.folderPath || entry.folderPath === currentFolderPath
          ) ?? false;

        if (payload?.events && !hasRelevantEvent) {
          return;
        }
      } catch {
        // Fall back to a conservative refresh if payload inspection fails.
      }

      if (refreshFromEventTimerRef.current) {
        window.clearTimeout(refreshFromEventTimerRef.current);
      }

      refreshFromEventTimerRef.current = window.setTimeout(() => {
        void refreshFolderCounts(activeAccountId);
        void loadMessages(currentFolderPath, {
          force: true,
          manageBusy: false,
          accountIdOverride: activeAccountId,
          preserveSelection: true,
          skipServerSync: true
        });
      }, 250);
    };

    const pollEvents = async () => {
      try {
        const response = await getJson<{
          events?: Array<{ folderPath?: string | null }>;
          cursor?: string;
        }>(
          `/api/accounts/${activeAccountId}/events?mode=poll&since=${encodeURIComponent(pollCursor)}`
        );
        if (!disposed) {
          queueRefresh(response);
        }
      } catch {
        // Silent fallback; background sync and future polls will retry.
      }
    };

    const startPolling = () => {
      if (pollInterval != null || disposed) {
        return;
      }

      void pollEvents();
      pollInterval = window.setInterval(() => {
        void pollEvents();
      }, 15_000);
    };

    if (typeof EventSource !== "undefined") {
      source = new EventSource(
        `/api/accounts/${activeAccountId}/events?since=${encodeURIComponent(pollCursor)}`
      );

      source.onmessage = (event) => {
        try {
          queueRefresh(
            JSON.parse(event.data) as {
              events?: Array<{ folderPath?: string | null }>;
              cursor?: string;
            }
          );
        } catch {
          queueRefresh();
        }
      };

      source.onerror = () => {
        source?.close();
        source = null;
        startPolling();
      };
    } else {
      startPolling();
    }

    return () => {
      disposed = true;
      if (refreshFromEventTimerRef.current) {
        window.clearTimeout(refreshFromEventTimerRef.current);
        refreshFromEventTimerRef.current = null;
      }
      if (pollInterval != null) {
        window.clearInterval(pollInterval);
      }
      source?.close();
    };
  }, [activeAccountId, currentFolderPath, getJson, loadMessages, refreshFolderCounts]);

  function persistConnection(nextConnection: MailConnectionPayload) {
    setConnection(nextConnection);
    setAccountFormError(null);
  }

  function describeAccountConnectError(error: unknown, accountWillBeRemoved: boolean) {
    const rawMessage =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "Unable to connect this account.";
    const normalized = rawMessage.toLowerCase();
    const authFailure =
      normalized.includes("auth") ||
      normalized.includes("login failed") ||
      normalized.includes("invalid credentials") ||
      normalized.includes("invalid login") ||
      normalized.includes("password") ||
      normalized.includes("username") ||
      normalized.includes("not authenticated");

    if (authFailure) {
      return accountWillBeRemoved
        ? "Maximail couldn't sign in to that account. Check the email address, password, and incoming/outgoing server settings, then try again. The account was not added."
        : "Maximail couldn't sign in to that account. Check the email address, password, and incoming/outgoing server settings, then try again.";
    }

    return accountWillBeRemoved ? `${rawMessage} The account was not added.` : rawMessage;
  }

  function describeAccountDeleteError(error: unknown) {
    const rawMessage =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "Maximail couldn't remove that account right now.";
    const normalized = rawMessage.toLowerCase();

    if (
      normalized.includes("not found") ||
      normalized.includes("no record was found")
    ) {
      return "That account was already removed. Refresh Settings if it still appears.";
    }

    if (normalized.includes("foreign key") || normalized.includes("constraint")) {
      return "Maximail couldn't finish removing that account because some saved mailbox data is still linked to it. Try again.";
    }

    return rawMessage;
  }

  function persistFolderOrder(nextOrder: string[]) {
    setFolderOrder(nextOrder);
    window.sessionStorage.setItem("mmwbmail-folder-order", JSON.stringify(nextOrder));
    window.sessionStorage.setItem("mmwbmail-folder-order-custom", "1");
  }

  function reorderFolders(sourcePath: string, targetPath: string) {
    if (sourcePath === targetPath) {
      return;
    }

    const currentPaths = orderedFolders.map((folder) => folder.path);
    const sourceIndex = currentPaths.indexOf(sourcePath);
    const targetIndex = currentPaths.indexOf(targetPath);

    if (sourceIndex === -1 || targetIndex === -1) {
      return;
    }

    const nextPaths = [...currentPaths];
    const [moved] = nextPaths.splice(sourceIndex, 1);
    nextPaths.splice(targetIndex, 0, moved);
    persistFolderOrder(nextPaths);
  }

  function applyPresetFromEmail(email: string, announce = true) {
    const preset = getConnectionPreset(email);

    if (!preset) {
      return false;
    }

    const nextConnection = {
      ...connection,
      email,
      ...preset
    };

    persistConnection(nextConnection);
    setHasAppliedPreset(true);

    if (announce) {
      setStatus("Applied InMotion defaults for makingmyworldbetter.com.");
    }

    return true;
  }

  function applyInMotionPreset(announce = true) {
    const nextConnection = {
      ...connection,
      ...getInMotionPreset()
    };

    persistConnection(nextConnection);
    setHasAppliedPreset(true);

    if (announce) {
      setStatus("Applied InMotion defaults.");
    }
  }

  const runAutoFilters = useCallback(
    async (
      currentMessages: MailSummary[],
      folder = currentFolderPath,
      accountIdOverride?: string
    ) => {
      if (autoFilters.length === 0) {
        return currentMessages;
      }

      const resolvedAccountId = accountIdOverride ?? activeAccountId;
      if (!resolvedAccountId) {
        return currentMessages;
      }

      console.log("Running auto-filters:", autoFilters.length, "rules");

      let updatedMessages = [...currentMessages];
      const allUidsToDelete: number[] = [];

      for (const rule of autoFilters) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - rule.keepDays);

        const toRemove = updatedMessages.filter(
          (message) =>
            message.from === rule.senderName &&
            new Date(message.date).getTime() < cutoff.getTime()
        );

        if (toRemove.length > 0) {
          console.log(`Auto-filter: removing ${toRemove.length} from ${rule.senderName}`);
          const uids = toRemove
            .map((message) => message.uid)
            .filter((uid): uid is number => Boolean(uid));
          allUidsToDelete.push(...uids);
          updatedMessages = updatedMessages.filter(
            (message) =>
              message.from !== rule.senderName ||
              new Date(message.date).getTime() >= cutoff.getTime()
          );
        }
      }

      if (allUidsToDelete.length > 0) {
        setMessages(updatedMessages);
        await Promise.all(
          allUidsToDelete.map((uid) =>
            removeCachedMessage(makeCachedMessageId(uid, folder, resolvedAccountId))
          )
        );

        try {
          await postJson<{
            success: true;
            deletedCount: number;
            movedToTrash: boolean;
          }>(`/api/accounts/${resolvedAccountId}/bulk-delete`, {
            folder,
            uids: allUidsToDelete,
            moveToTrash: true
          });
          await refreshFolderCounts(resolvedAccountId);
        } catch (error) {
          console.error("Auto-filter batch delete failed:", error);
        }
      }

      return updatedMessages;
    },
    [activeAccountId, autoFilters, currentFolderPath]
  );

  useEffect(() => {
    if (autoFilters.length === 0) {
      return;
    }

    const interval = window.setInterval(() => {
      void runAutoFilters(messages);
    }, 24 * 60 * 60 * 1000);

    return () => window.clearInterval(interval);
  }, [autoFilters, messages, runAutoFilters]);

  async function loadMessages(folder: string, options?: LoadMessagesOptions) {
    const force = options?.force ?? false;
    const manageBusy = options?.manageBusy ?? true;
    const preserveSelection = options?.preserveSelection ?? false;
    const skipServerSync = options?.skipServerSync ?? false;
    const resolvedAccountId = options?.accountIdOverride ?? activeAccountId;
    const requestMailboxNode =
      resolvedAccountId === activeAccountId
        ? findMailboxNodeByPath(activeMailboxNodes, folder)
        : null;
    const activeQueryForFolder =
      requestMailboxNode?.identity.id === mailboxQuery.target.mailboxId ? mailboxQuery : null;
    const serverSearchActive = Boolean(
      resolvedAccountId === activeAccountId && activeQueryForFolder?.usesServerSideSearch
    );
    const requestKey = buildVisibleMessageRequestKey({
      accountId: resolvedAccountId,
      folderPath: folder,
      resultKey: activeQueryForFolder?.resultKey ?? null
    });
    const requestSeq = ++visibleMessageLoadSeqRef.current;
    latestVisibleMessageLoadRef.current = {
      key: requestKey,
      seq: requestSeq
    };
    const canApplyVisibleState = () =>
      latestVisibleMessageLoadRef.current?.key === requestKey &&
      latestVisibleMessageLoadRef.current?.seq === requestSeq;
    const clearVisibleSelection = () => {
      openMessageSeqRef.current += 1;
      setSelectedMessage(null);
    };

    if (!resolvedAccountId) {
      if (canApplyVisibleState()) {
        setMessages([]);
      }
      return [];
    }

    if (manageBusy) {
      setIsBusy(true);
    }

    let visibleMessages: MailSummary[] = [];

    try {
      prunePendingMailMutationsNow();
      const cached = reconcileMessagesWithPendingMutations(
        stampMessageAccountList(await getCachedMessages(folder, resolvedAccountId), resolvedAccountId),
        pendingMailMutationsRef.current,
        {
          accountId: resolvedAccountId,
          folderPath: folder
        }
      );
      if (cached.length > 0) {
        visibleMessages = cached;
        if (canApplyVisibleState()) {
          setMessages(cached);
        }
        const cachedSelection = reconcileVisibleSelection(cached, {
          selectedUid,
          selectedMessageUid: selectedMessage?.uid ?? null,
          selectedMessageAccountId: selectedMessage?.accountId ?? null,
          preserveSelection,
          scopeAccountId: resolvedAccountId
        });
        if (canApplyVisibleState()) {
          setSelectedUid(cachedSelection.selectedUid);
        }
        if (cachedSelection.clearSelectedMessage && canApplyVisibleState()) {
          clearVisibleSelection();
        }
        console.log(`mmwbmail: loaded ${cached.length} cached messages for ${folder}`);
      }

      const lastSync =
        force || serverSearchActive ? null : await getCacheTimestamp(folder, resolvedAccountId);
      const cacheAge = lastSync
        ? (Date.now() - new Date(lastSync).getTime()) / 1000 / 60
        : Number.POSITIVE_INFINITY;

      if (!force && !serverSearchActive && cacheAge < 5 && cached.length > 0) {
        console.log(
          `mmwbmail: cache is ${Math.round(cacheAge)}min old — skipping IMAP fetch`
        );
        return cached;
      }

      const searchParams = new URLSearchParams({
        folder
      });
      if (force && !skipServerSync) {
        searchParams.set("sync", "true");
      }
      if (serverSearchActive) {
        searchParams.set("q", activeQueryForFolder?.normalizedSearchText ?? "");
        if (activeQueryForFolder) {
          searchParams.set("mailboxType", activeQueryForFolder.target.mailboxType);
          searchParams.set("sourceKind", activeQueryForFolder.target.sourceKind);
          if (activeQueryForFolder.target.systemKey) {
            searchParams.set("systemKey", activeQueryForFolder.target.systemKey);
          }
        }
      }

      const response = await getJson<{ messages: MailSummary[] }>(
        `/api/accounts/${resolvedAccountId}/messages?${searchParams.toString()}`
      );
      const fresh = reconcileMessagesWithPendingMutations(
        stampMessageAccountList(response.messages, resolvedAccountId),
        pendingMailMutationsRef.current,
        {
          accountId: resolvedAccountId,
          folderPath: folder
        }
      );

      const folderMeta = folders.find((entry) => entry.path === folder);
      if (
        !serverSearchActive &&
        fresh.length === 0 &&
        cached.length > 0 &&
        (folderMeta?.count ?? 0) > 0
      ) {
        console.warn(
          `mmwbmail: ignoring suspicious empty refresh for ${folder}; keeping ${cached.length} cached messages`
        );
        if (canApplyVisibleState()) {
          setMessages(cached);
        }
        return cached;
      }

      if (!serverSearchActive) {
        await cacheMessages(fresh, folder, resolvedAccountId);
      }
      const nextMessages = await runAutoFilters(fresh, folder, resolvedAccountId);
      if (canApplyVisibleState()) {
        setMessages(nextMessages);
        setMailboxRefreshHint((current) =>
          current?.accountId === resolvedAccountId && current?.folderPath === folder
            ? null
            : current
        );
        const newlyArrived = serverSearchActive
          ? []
          : nextMessages.filter(
              (message) => !message.seen && !prevMessageUidsRef.current.has(message.uid)
            );
        const isInitialLoad = serverSearchActive ? true : prevMessageUidsRef.current.size === 0;

        if (!isInitialLoad && newlyArrived.length > 0) {
          if (newlyArrived.length === 1) {
            const message = newlyArrived[0];
            showToast(
              `New message from ${displaySender(message.from)}: ${message.subject.slice(0, 45)}${
                message.subject.length > 45 ? "…" : ""
              }`,
              "info"
            );
          } else {
            showToast(`${newlyArrived.length} new messages arrived`, "info");
          }

          if (notifPlatform.canWebNotify && Notification.permission === "granted") {
            if (newlyArrived.length === 1) {
              const message = newlyArrived[0];
              const notification = new Notification(displaySender(message.from), {
                body: message.subject,
                tag: `maximail-msg-${message.uid}`,
                icon: "/icon-192.png",
                silent: false
              });
              notification.onclick = () => {
                window.focus();
                void openMessage(message.uid);
                notification.close();
              };
            } else {
              const notification = new Notification(
                `Maximail — ${newlyArrived.length} new messages`,
                {
                  body: newlyArrived
                    .slice(0, 3)
                    .map((message) => displaySender(message.from))
                    .join(", "),
                  tag: "maximail-batch",
                  icon: "/icon-192.png"
                }
              );
              notification.onclick = () => {
                window.focus();
                notification.close();
              };
            }
          }
        }

        if (!serverSearchActive) {
          prevMessageUidsRef.current = new Set(nextMessages.map((message) => message.uid));
          syncUnreadIndicators(nextMessages);
        }
      }
      visibleMessages = nextMessages;
      const nextSelection = reconcileVisibleSelection(nextMessages, {
        selectedUid,
        selectedMessageUid: selectedMessage?.uid ?? null,
        selectedMessageAccountId: selectedMessage?.accountId ?? null,
        preserveSelection,
        scopeAccountId: resolvedAccountId
      });
      if (canApplyVisibleState()) {
        setSelectedUid(nextSelection.selectedUid);
      }
      if (nextSelection.clearSelectedMessage && canApplyVisibleState()) {
        clearVisibleSelection();
      }
      console.log(`mmwbmail: fetched ${fresh.length} fresh messages, cache updated`);
      return nextMessages;
    } catch (error) {
      console.error("mmwbmail: IMAP fetch failed", error);
      if (visibleMessages.length === 0) {
        throw error;
      }
      return visibleMessages;
    } finally {
      if (manageBusy) {
        setIsBusy(false);
      }
    }
  }

  async function saveAccountSettings() {
    const targetFolder = connection.folder?.trim() || activeAccount?.defaultFolder || "INBOX";
    const normalizedEmail = connection.email.trim().toLowerCase();
    const normalizedImapHost = connection.imapHost.trim().toLowerCase();
    const normalizedSmtpHost = connection.smtpHost.trim().toLowerCase();
    const shouldReuseStoredAccount =
      Boolean(activeAccount) &&
      connection.password.trim().length === 0 &&
      activeAccount?.email === normalizedEmail &&
      activeAccount.imapHost === normalizedImapHost &&
      activeAccount.imapPort === connection.imapPort &&
      activeAccount.imapSecure === connection.imapSecure &&
      activeAccount.smtpHost === normalizedSmtpHost &&
      activeAccount.smtpPort === connection.smtpPort &&
      activeAccount.smtpSecure === connection.smtpSecure &&
      (activeAccount.defaultFolder || "INBOX") === targetFolder;

    if (activeAccount && shouldReuseStoredAccount) {
      applyAccountToConnection(activeAccount, targetFolder);
      return { account: activeAccount, folder: targetFolder };
    }

    const accountResponse = await postJson<{ account: MailAccountSummary }>("/api/accounts", {
      ...connection,
      folder: targetFolder,
      label: connection.email.trim() || "Mailbox"
    });
    const createdAccount = !accounts.some((entry) => entry.id === accountResponse.account.id);
    const nextAccount =
      (await loadPersistedAccounts(accountResponse.account.id)) ?? accountResponse.account;
    applyAccountToConnection(nextAccount, targetFolder);
    return { account: nextAccount, folder: targetFolder, createdAccount };
  }

  async function verifyAccountConnection() {
    const targetFolder = connection.folder?.trim() || activeAccount?.defaultFolder || "INBOX";

    await postJson<{ folders: MailFolder[] }>("/api/account/folders", {
      ...connection,
      folder: targetFolder
    });
  }

  async function connectMailbox() {
    setIsBusy(true);
    setAccountFormError(null);
    setAccountFormSuccess(null);
    setStatus("Saving account and syncing mailbox...");

    const priorActiveAccountId = activeAccountIdRef.current;
    let createdAccountId: string | null = null;
    let shouldRollbackCreatedAccount = false;

    try {
      if (accountFormMode === "add") {
        await verifyAccountConnection();
      }

      const { account, folder, createdAccount } = await saveAccountSettings();
      if (createdAccount) {
        createdAccountId = account.id;
        shouldRollbackCreatedAccount = true;
      }
      await activateAccount(account, {
        sync: true,
        folderOverride: folder
      });

      const successMessage =
        accountFormMode === "add"
          ? `${account.email} was added and is ready to use.`
          : `${account.email} was updated successfully.`;
      setAccountFormSuccess(successMessage);
      setStatus(successMessage);
      showToast(accountFormMode === "add" ? "Account added" : "Account updated");
      setSettingsTab("account");
      closeAccountForm();
      return true;
    } catch (error) {
      if (shouldRollbackCreatedAccount && createdAccountId) {
        try {
          await deleteJson<{
            success: true;
            deletedAccountId: string;
            nextAccountId: string | null;
          }>(`/api/accounts/${createdAccountId}`);
        } catch (rollbackError) {
          console.error("mmwbmail: failed to rollback account add after sync/auth failure", rollbackError);
        }

        try {
          await loadPersistedAccounts(priorActiveAccountId ?? undefined);
        } catch (restoreError) {
          console.error("mmwbmail: failed to restore account list after rollback", restoreError);
        }
      }

      const message = describeAccountConnectError(error, shouldRollbackCreatedAccount);
      setAccountFormError(message);
      setStatus(message);
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function loadMessageIntoReader(
    message: MailSummary,
    input?: {
      accountId?: string | null;
      folderPath?: string;
      markSeen?: boolean;
    }
  ) {
    const resolvedAccountId = input?.accountId ?? activeAccountId;
    const resolvedFolderPath = input?.folderPath ?? currentFolderPath;

    if (!resolvedAccountId) {
      setStatus("Connect an account first.");
      return;
    }

    const requestSeq = ++openMessageSeqRef.current;
    const fallbackMessage = stampMessageAccount(message, resolvedAccountId);
    setSelectedUid(message.uid);
    setSelectedMessage(buildFallbackMessageDetail(fallbackMessage));
    setStatus("Loading message...");

    try {
      const response = await getJson<{ message: MailDetail }>(
        `/api/accounts/${resolvedAccountId}/messages/${message.uid}?folder=${encodeURIComponent(
          resolvedFolderPath
        )}`
      );
      if (openMessageSeqRef.current !== requestSeq) {
        return;
      }
      const resolvedMessage = stampMessageAccount(response.message, resolvedAccountId);
      const shouldMarkSeen = Boolean(input?.markSeen) && !resolvedMessage.seen;
      const nextSelectedMessage = shouldMarkSeen
        ? { ...resolvedMessage, seen: true }
        : resolvedMessage;
      setSelectedMessage(nextSelectedMessage);
      setStatus(`Viewing "${resolvedMessage.subject}".`);

      if (shouldMarkSeen) {
        setMessages((current) =>
          current.map((entry) =>
            entry.uid === message.uid ? { ...entry, seen: true } : entry
          )
        );
        void updateCachedMessage(
          makeCachedMessageId(message.uid, resolvedFolderPath, resolvedAccountId),
          { seen: true }
        );

        try {
          await postJson<{ success: true }>(`/api/accounts/${resolvedAccountId}/flag`, {
            folder: resolvedFolderPath,
            uids: [message.uid],
            flag: "\\Seen",
            action: "add"
          });
          await refreshFolderCounts(resolvedAccountId);
        } catch (error) {
          console.error("Flag update failed:", error);
          setMessages((current) =>
            current.map((entry) =>
              entry.uid === message.uid ? { ...entry, seen: false } : entry
            )
          );
          void updateCachedMessage(
            makeCachedMessageId(message.uid, resolvedFolderPath, resolvedAccountId),
            { seen: false }
          );
          setSelectedMessage((current) =>
            current && current.uid === message.uid ? { ...current, seen: false } : current
          );
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to open message.");
    }
  }

  const markMessageSeenForContext = useCallback(
    async (input: {
      uid: number;
      accountId: string;
      folderPath: string;
    }) => {
      const targetMessage =
        (selectedMessage?.uid === input.uid ? selectedMessage : null) ??
        messages.find((message) => message.uid === input.uid) ??
        null;

      if (targetMessage?.seen) {
        return;
      }

      setMessages((current) =>
        current.map((entry) => (entry.uid === input.uid ? { ...entry, seen: true } : entry))
      );
      void updateCachedMessage(
        makeCachedMessageId(input.uid, input.folderPath, input.accountId),
        { seen: true }
      );
      setSelectedMessage((current) =>
        current && current.uid === input.uid ? { ...current, seen: true } : current
      );

      try {
        await postJson<{ success: true }>(`/api/accounts/${input.accountId}/flag`, {
          folder: input.folderPath,
          uids: [input.uid],
          flag: "\\Seen",
          action: "add"
        });
        await refreshFolderCounts(input.accountId);
      } catch (error) {
        console.error("Flag update failed:", error);
        setMessages((current) =>
          current.map((entry) => (entry.uid === input.uid ? { ...entry, seen: false } : entry))
        );
        void updateCachedMessage(
          makeCachedMessageId(input.uid, input.folderPath, input.accountId),
          { seen: false }
        );
        setSelectedMessage((current) =>
          current && current.uid === input.uid ? { ...current, seen: false } : current
        );
      }
    },
    [messages, refreshFolderCounts, selectedMessage]
  );

  async function openMessage(uid: number) {
    if (!activeAccountId) {
      setStatus("Connect an account first.");
      return;
    }

    const fallbackMessage = messages.find((message) => message.uid === uid);
    if (!fallbackMessage) {
      setStatus("Message unavailable.");
      return;
    }

    if (isMobileStackedMode) {
      setMobileStackedScreen("viewer");
    }

    await loadMessageIntoReader(fallbackMessage, {
      accountId: activeAccountId,
      folderPath: currentFolderPath,
      markSeen: !isScopedNewMailReadDelayActive
    });
  }

  async function loadCleanupPreview(uid: number) {
    if (cleanupPreviewCache[uid]) {
      return cleanupPreviewCache[uid];
    }

    if (!activeAccountId) {
      throw new Error("No active account.");
    }

    const response = await getJson<{ message: MailDetail }>(
      `/api/accounts/${activeAccountId}/messages/${uid}?folder=${encodeURIComponent(
        currentFolderPath
      )}`
    );
    const resolvedMessage = stampMessageAccount(response.message, activeAccountId);
    setCleanupPreviewCache((current) => ({ ...current, [uid]: resolvedMessage }));
    return resolvedMessage;
  }

  async function resolveMessageDetail(message: MailSummary | MailDetail) {
    if ("emailBody" in message) {
      return message;
    }

    if (selectedMessage?.uid === message.uid) {
      return selectedMessage;
    }

    return loadCleanupPreview(message.uid);
  }

  async function refreshCurrentFolder(folder = currentFolderPath) {
    const resolvedAccountId = activeAccountId;
    try {
      const refreshedMessages = await loadMessages(folder, {
        force: true,
        preserveSelection: true
      });
      setMailboxRefreshHint(null);
      clearMessageViewState(
        setSelectedUid,
        setSelectedMessage,
        setQuery,
        setSenderFilter,
        setSubjectFilter,
        setSubjectPattern
      );
      if (refreshedMessages[0]) {
        await loadMessageIntoReader(refreshedMessages[0], {
          accountId: resolvedAccountId,
          folderPath: folder,
          markSeen: false
        });
      } else {
        setSelectedUid(null);
      }
      setStatus(`Mailbox refreshed for ${folder}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to refresh mailbox.";
      if (resolvedAccountId) {
        setMailboxRefreshHint({
          accountId: resolvedAccountId,
          folderPath: folder,
          message
        });
      }
      setStatus(message);
    }
  }

  const isCurrentTrashView =
    Boolean(activeAccountId) && activeMailboxNode?.systemKey === "trash";

  async function emptyTrashForAccount(
    accountId: string,
    folderPath: string,
    accountEmail?: string
  ) {
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(
            `Empty Trash for ${accountEmail ?? "this account"}? This permanently deletes all messages currently in Trash.`
          );

    if (!confirmed) {
      return false;
    }

    setIsBusy(true);

    try {
      const result = await postJson<{ success: true; deletedCount: number }>(
        `/api/accounts/${accountId}/empty-trash`,
        {
          folder: folderPath
        }
      );

      await clearFolderCache(folderPath, accountId);
      await refreshFolderCounts(accountId);

      if (activeAccountIdRef.current === accountId && currentFolderPath === folderPath) {
        const refreshedMessages = await loadMessages(folderPath, {
          force: true,
          accountIdOverride: accountId,
          preserveSelection: false
        });
        clearMessageViewState(
          setSelectedUid,
          setSelectedMessage,
          setQuery,
          setSenderFilter,
          setSubjectFilter,
          setSubjectPattern
        );
        setSelectedUid(refreshedMessages[0]?.uid ?? null);
      }

      showToast(
        result.deletedCount > 0
          ? `Emptied Trash for ${accountEmail ?? "account"}`
          : `Trash already empty for ${accountEmail ?? "account"}`
      );
      setStatus(
        result.deletedCount > 0
          ? `Trash emptied for ${accountEmail ?? "account"}.`
          : `Trash was already empty for ${accountEmail ?? "account"}.`
      );
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to empty trash.");
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function refreshFolderCounts(accountIdOverride?: string) {
    const resolvedAccountId = accountIdOverride ?? activeAccountId;
    if (!resolvedAccountId) {
      return;
    }

    try {
      const folderResponse = await getJson<{ folders: MailFolder[] }>(
        `/api/accounts/${resolvedAccountId}/folders`
      );
      setFoldersByAccount((current) => ({
        ...current,
        [resolvedAccountId]: folderResponse.folders
      }));
      if (resolvedAccountId === activeAccountId) {
        setFolders(folderResponse.folders);
      }
    } catch {
      // Ignore count refresh failures and keep the current sidebar state.
    }
  }

  function createMessageActionTarget(uid: number): MailActionRequest["target"] {
    return {
      scope: "message",
      messageUids: [uid]
    };
  }

  function createConversationActionTarget(
    conversationId: string
  ): MailActionRequest["target"] | null {
    const conversation = conversations.byId.get(conversationId);
    if (!conversation) {
      return null;
    }

    return {
      scope: "conversation",
      conversationId,
      messageUids: conversation.messages.map((message) => message.uid)
    };
  }

  function prunePendingMailMutationsNow() {
    pendingMailMutationsRef.current = pruneExpiredMailMutations(pendingMailMutationsRef.current);
  }

  function registerPendingMailMutation(
    request: MailActionRequest,
    ttlMs?: number
  ) {
    const mutation = createPendingMailMutation(request, Date.now(), ttlMs);
    if (!mutation) {
      return;
    }

    prunePendingMailMutationsNow();
    pendingMailMutationsRef.current[mutation.key] = mutation;

    const existingTimer = pendingMailMutationTimersRef.current[mutation.key];
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }

    pendingMailMutationTimersRef.current[mutation.key] = window.setTimeout(() => {
      delete pendingMailMutationsRef.current[mutation.key];
      delete pendingMailMutationTimersRef.current[mutation.key];
    }, Math.max(mutation.expiresAt - Date.now(), 0));
  }

  function clearPendingMailMutation(actionKey: string) {
    const timer = pendingMailMutationTimersRef.current[actionKey];
    if (timer) {
      window.clearTimeout(timer);
      delete pendingMailMutationTimersRef.current[actionKey];
    }

    delete pendingMailMutationsRef.current[actionKey];
  }

  function applyOptimisticMailAction(request: MailActionRequest) {
    const affectedUids = new Set(request.target.messageUids);
    const removesFromCurrentFolder = [
      "archive",
      "delete",
      "spam",
      "not_spam",
      "move",
      "restore"
    ].includes(request.kind);

    if (removesFromCurrentFolder) {
      setMessages((current) =>
        current.filter((message) => !affectedUids.has(message.uid))
      );
      setSelectedUids((current) => {
        const next = new Set(Array.from(current).filter((uid) => !affectedUids.has(uid)));
        return next.size === current.size ? current : next;
      });

      if (selectedMessage && affectedUids.has(selectedMessage.uid)) {
        setSelectedMessage(null);
      }

      if (selectedUid !== null && affectedUids.has(selectedUid)) {
        setSelectedUid(null);
      }

      void Promise.all(
        request.target.messageUids.map((uid) =>
          removeCachedMessage(makeCachedMessageId(uid, currentFolderPath, request.accountId))
        )
      );
      return;
    }

    const optimisticPatch =
      request.kind === "mark_read"
        ? { seen: true }
        : request.kind === "mark_unread"
          ? { seen: false }
          : request.kind === "star"
            ? { flagged: true }
            : request.kind === "unstar"
              ? { flagged: false }
              : null;

    if (!optimisticPatch) {
      return;
    }

    setMessages((current) =>
      current.map((message) =>
        affectedUids.has(message.uid) ? { ...message, ...optimisticPatch } : message
      )
    );
    setSelectedMessage((current) =>
      current && affectedUids.has(current.uid) ? { ...current, ...optimisticPatch } : current
    );
    void Promise.all(
      request.target.messageUids.map((uid) =>
        updateCachedMessage(
          makeCachedMessageId(uid, currentFolderPath, request.accountId),
          optimisticPatch
        )
      )
    );
  }

  async function dispatchMailAction(
    request: MailActionRequest,
    options?: {
      clearSelectionOnSuccess?: boolean;
      pendingMutationTtlMs?: number;
      toastMessage?: string;
      failureMessage?: string;
    }
  ) {
    const capability = mailActionCapabilities[request.kind];

    if (!capability?.supported) {
      const unsupportedMessage = capability?.reason || "This action isn't available here.";
      setStatus(unsupportedMessage);
      return false;
    }

    const actionKey = buildMailActionKey(request);
    const snapshot = {
      messages,
      selectedMessage,
      selectedUid,
      selectedUids: new Set(selectedUids)
    };

    setMailActionStatuses((current) => ({
      ...current,
      [actionKey]: {
        key: actionKey,
        phase: "running",
        request
      }
    }));

    const animatedExitTargets = await animateNewMailExitIfNeeded(request);

    registerPendingMailMutation(request, options?.pendingMutationTtlMs);
    applyOptimisticMailAction(request);

    try {
      const result = await executeMailActionRequest(request, {
        postJson,
        patchJson
      });

      if (result.refreshFolderCounts) {
        await refreshFolderCounts(request.accountId);
      }

      if (options?.clearSelectionOnSuccess) {
        clearSelection();
      }

      setStatus(result.statusMessage);
      if (options?.toastMessage ?? result.toastMessage) {
        showToast(options?.toastMessage ?? result.toastMessage ?? "");
      }

      setMailActionStatuses((current) => ({
        ...current,
        [actionKey]: {
          key: actionKey,
          phase: "succeeded",
          request
        }
      }));
      clearNewMailExitAnimationTargets(animatedExitTargets);
      return true;
    } catch (error) {
      clearPendingMailMutation(actionKey);
      clearNewMailExitAnimationTargets(animatedExitTargets);
      setMessages(snapshot.messages);
      setSelectedMessage(snapshot.selectedMessage);
      setSelectedUid(snapshot.selectedUid);
      setSelectedUids(snapshot.selectedUids);

      await cacheMessages(snapshot.messages, currentFolderPath, request.accountId);

      setStatus(
        error instanceof Error
          ? error.message
          : options?.failureMessage ?? "Unable to update message."
      );
      setMailActionStatuses((current) => ({
        ...current,
        [actionKey]: {
          key: actionKey,
          phase: "failed",
          request,
          error:
            error instanceof Error
              ? error.message
              : options?.failureMessage ?? "Action failed."
        }
      }));
      return false;
    }
  }

  async function handleSend() {
    const resolvedSendIdentity = resolveSendIdentityForSession(
      composeSessionContext,
      composeIdentity,
      composeReplyTo
    );
    const sendingAccountId = resolvedSendIdentity?.accountId ?? null;

    if (!resolvedSendIdentity) {
      setStatus("Connect an account first.");
      return;
    }

    setIsBusy(true);
    setStatus("Sending message...");

    try {
      const sentRecipientHistory = mergeRecipientSuggestionLists(recentRecipients, [
        ...composeToList,
        ...composeCcList,
        ...composeBccList
      ]);
      const htmlBody = composePlainText
        ? composeBody.replace(/\n/g, "<br/>").replace(/  /g, "&nbsp;")
        : composeEditorRef.current?.innerHTML || composeBody.replace(/\n/g, "<br/>");
      const formData = new FormData();
      formData.append("folder", composeAccount?.defaultFolder || "INBOX");
      formData.append("fromAddress", resolvedSendIdentity.fromAddress);
      formData.append("fromName", resolvedSendIdentity.fromName);
      formData.append("to", composeTo);
      formData.append("subject", composeSubject);
      formData.append("body", composeBody);
      formData.append("htmlBody", htmlBody);
      formData.append("cc", composeCc);
      formData.append("bcc", composeBcc);
      formData.append("replyTo", resolvedSendIdentity.replyTo);
      fileAttachments.forEach((file) => formData.append("attachments", file));
      imageAttachments.forEach((file, index) => {
        formData.append(`inline_${index}`, file);
        formData.append(`inline_name_${index}`, file.name);
      });
      formData.append("inline_count", String(imageAttachments.length));

      const response = await fetch(`/api/accounts/${resolvedSendIdentity.accountId}/send`, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Unable to send message.");
      }

      if (sendingAccountId) {
        await refreshFolderCounts(sendingAccountId);
        if (activeAccountId === sendingAccountId && isSentFolder) {
          await loadMessages(currentFolderPath, {
            force: true,
            manageBusy: false,
            accountIdOverride: sendingAccountId,
            preserveSelection: true
          });
        }
      }

      setRecentRecipients(sentRecipientHistory);

      lastEditableRef.current = null;
      setComposeOpen(false);
      setComposeSessionContext(null);
      setComposeIdentity(null);
      setComposeContentState(null);
      setComposeIntent({ kind: "new" });
      setComposeSourceMessageMeta(null);
      setComposeToList([]);
      setComposeCcList([]);
      setComposeBccList([]);
      setComposeReplyTo("");
      setComposeSubject("");
      setComposeBody("");
      setComposeAttachments([]);
      setComposeWordCount({ words: 0, chars: 0 });
      setComposeMinimized(false);
      setComposePlainText(false);
      setComposeQuickInsertOpen(false);
      setComposeToolbarOverflowOpen(false);
      setComposeToolbarMenuOpen(false);
      setComposeToolbarMenuPosition(null);
      setComposeSelectionToolbarPos(null);
      setShowCc(false);
      setShowBcc(false);
      setShowReplyTo(false);
      setDiscardConfirmOpen(false);
      savedRangeRef.current = null;
      void clearPersistedComposeDraft();
      if (composeEditorRef.current) {
        composeEditorRef.current.innerHTML = "";
      }
      setStatus("Message sent successfully.");
      showToast("Message sent");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to send message.");
    } finally {
      setIsBusy(false);
    }
  }

  function openDeleteSenderModal(message: MailSummary) {
    setDeleteTarget(message);
    setContextMenu(null);
  }

  function applySenderPivot(
    message: Pick<MailSummary, "from" | "to">,
    sentMode = false
  ) {
    setSenderFilter(getFocusFilterValue(message, sentMode));
    setSenderFilterScope("general");
    setSubjectFilter(null);
    setSubjectPattern(null);
  }

  function applyPrioritizedSenderFocus(senderName: string) {
    setSenderFilter(senderName);
    setSenderFilterScope("prioritized");
    setSubjectFilter(null);
    setSubjectPattern(null);
  }

  function clearSenderFocus() {
    setSenderFilter(null);
    setSenderFilterScope(null);
  }

  function clearPrioritizedSenderFocus() {
    if (senderFilterScope !== "prioritized") {
      return;
    }

    clearSenderFocus();
  }

  function applySubjectPivot(message: MailSummary | MailDetail) {
    const pattern = detectSubjectPattern(message.subject, messages);

    clearSenderFocus();
    setSubjectFilter(message.subject);
    setSubjectPattern(pattern);
  }

  function closeComposeDraft(force = false) {
    const editor = composeEditorRef.current;
    const editorText = editor?.innerText?.trim() ?? "";
    const contentWithoutSignature = editorText.replace(signature, "").trim();
    const hasContent =
      composeToList.length > 0 ||
      composeCcList.length > 0 ||
      composeBccList.length > 0 ||
      composeReplyTo.trim().length > 0 ||
      composeAttachments.length > 0 ||
      composeSubject.trim().length > 0 ||
      stripHtml(composeBody).trim().length > 0 ||
      contentWithoutSignature.length > 0;

    if (!force && hasContent) {
      setDiscardConfirmOpen(true);
      return;
    }

    setDiscardConfirmOpen(false);
    lastEditableRef.current = null;
      setComposeOpen(false);
      setComposeSessionContext(null);
      setComposeIdentity(null);
    setComposeContentState(null);
    setComposeIntent({ kind: "new" });
    setComposeSourceMessageMeta(null);
    setComposeToList([]);
    setComposeCcList([]);
    setComposeBccList([]);
    setComposeReplyTo("");
    setComposeSubject("");
    setComposeBody("");
    setComposeAttachments([]);
    setComposeWordCount({ words: 0, chars: 0 });
    setComposeMinimized(false);
    setComposePlainText(false);
    setComposeToolbarMenuOpen(false);
    setComposeToolbarMenuPosition(null);
    setComposeToolbarOverflowOpen(false);
    setComposeQuickInsertOpen(false);
    setComposeSelectionToolbarPos(null);
    setShowCc(false);
    setShowBcc(false);
    setShowReplyTo(false);
    savedRangeRef.current = null;
    void clearPersistedComposeDraft();

    if (composeEditorRef.current) {
      composeEditorRef.current.innerHTML = "";
    }
  }

  function insertInlineImageAtSelection(
    file: File,
    dataUrl: string,
    range?: Range | null,
    alt = file.name || "image"
  ) {
    const editor = composeEditorRef.current;

    if (!editor) {
      return;
    }

    const imageElement = document.createElement("img");
    const attachmentId = getComposeAttachmentId(file);
    imageElement.src = dataUrl;
    imageElement.className = "compose-inline-img";
    imageElement.alt = alt;
    imageElement.dataset.filename = file.name;
    imageElement.dataset.attachmentId = attachmentId;
    imageElement.dataset.filetype = file.type;
    const trailingLine = document.createElement("div");
    trailingLine.appendChild(document.createElement("br"));

    editor.focus();
    const selection = window.getSelection();
    const activeRange = range ?? (selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null);

    if (activeRange) {
      activeRange.deleteContents();
      activeRange.insertNode(imageElement);
      activeRange.setStartAfter(imageElement);
      activeRange.collapse(true);
      activeRange.insertNode(trailingLine);
      activeRange.selectNodeContents(trailingLine);
      activeRange.collapse(true);

      if (selection) {
        selection.removeAllRanges();
        selection.addRange(activeRange);
      }
    } else {
      editor.appendChild(imageElement);
      editor.appendChild(trailingLine);

      if (selection) {
        const nextRange = document.createRange();
        nextRange.selectNodeContents(trailingLine);
        nextRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(nextRange);
      }
    }

    setComposeAttachments((current) => [...current, file]);
    setComposeBody(editor.innerText);
    updateComposeCounts(editor.innerText);
  }

  function updateComposeCounts(text: string) {
    const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
    setComposeWordCount({ words, chars: text.length });
  }

  async function persistComposeDraftNow(showFeedback = false) {
    const snapshot = await buildComposeDraftSnapshot();
    if (!snapshot) {
      return;
    }

    try {
      if (autosaveServiceRef.current) {
        await autosaveServiceRef.current.flush({
          storageKey: DRAFT_STORAGE_KEY,
          draft: snapshot
        });
      } else {
        const result = await draftServiceRef.current.saveDraft({
          storageKey: DRAFT_STORAGE_KEY,
          draft: snapshot,
          requestId: Date.now()
        });

        if (result.savedRevision < composeLocalRevisionRef.current) {
          return;
        }

        composeLastSavedRevisionRef.current = result.savedRevision;
        setComposeDraft(result.draft);
        setComposeDraftStatus("saved");
        setComposeDraftSavedAt(result.savedAt);
        setComposeDraftError(null);
      }

      if (showFeedback) {
        showToast("Draft saved");
      }
    } catch (error) {
      setComposeDraftStatus("failed");
      setComposeDraftError(
        error instanceof Error ? error.message : "Draft save failed"
      );
    }
  }

  function openComposeLinkDialog() {
    const selection = window.getSelection();

    if (selection && selection.rangeCount > 0) {
      savedRangeRef.current = selection.getRangeAt(0).cloneRange();
      setLinkText(selection.toString());
    } else {
      savedRangeRef.current = null;
      setLinkText("");
    }

    setLinkUrl("");
    setLinkDialogOpen(true);
  }

  function readComposeFileAsDataUrl(file: File) {
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
  }

  async function handleComposeSelectedFiles(
    files: File[],
    mode: "all" | "images-only" = "all"
  ) {
    if (mode === "images-only") {
      await composePhotoService.attachPhotos({
        files: files.filter((file) => file.type.startsWith("image/")),
        source: "picker"
      });
      return;
    }

    await composeAttachmentService.attachFiles({
      files,
      source: "picker"
    });
  }

  function updateComposeInsertedBlocks(
    kind: "signature" | "preset",
    sourceId: string,
    label: string,
    options?: {
      defaultSignatureInserted?: boolean;
    }
  ) {
    setComposeContentState((current) => {
      if (!current) {
        return current;
      }

      const nextBlockId = `${kind}:${sourceId}`;
      const nextBlocks = current.insertedBlocks.some((block) => block.id === nextBlockId)
        ? current.insertedBlocks
        : [
            ...current.insertedBlocks,
            {
              id: nextBlockId,
              kind,
              sourceId,
              label
            }
          ];

      return {
        ...current,
        insertedBlocks: nextBlocks,
        defaultSignatureInserted:
          options?.defaultSignatureInserted ?? current.defaultSignatureInserted
      };
    });
  }

  function updateActiveComposeSignatureText(nextText: string) {
    const nextDefinition = buildScopedSignatureDefinition({
      identity: composeIdentity,
      fallbackSignature: nextText,
      existingId:
        composeContentState?.activeSignatureId ??
        composeContentState?.identitySignatureId ??
        null
    });
    const updatedDefinition = {
      ...nextDefinition,
      label: composeContentState?.activeSignatureLabel || nextDefinition.label,
      text: nextText
    };

    setSignature(nextText);
    setSignatureDefinitions((current) =>
      upsertSignatureDefinition(current, updatedDefinition)
    );
    setComposeContentState((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        identitySignatureId: updatedDefinition.id,
        activeSignatureId: updatedDefinition.id,
        activeSignatureLabel: updatedDefinition.label,
        activeSignatureText: nextText,
        availableSignatures: upsertSignatureDefinition(
          current.availableSignatures,
          updatedDefinition
        )
      };
    });

    if (!composeIdentity?.accountId) {
      setDefaultSignature(nextText);
    }
  }

  function selectComposeSignatureDefinition(signatureId: string) {
    const nextDefinition = composeContentState?.availableSignatures.find(
      (definition) => definition.id === signatureId
    );

    if (!nextDefinition) {
      return;
    }

    setComposeContentState((current) =>
      current
        ? {
            ...current,
            activeSignatureId: nextDefinition.id,
            activeSignatureLabel: nextDefinition.label,
            activeSignatureText: nextDefinition.text
          }
        : current
    );
    setSignature(nextDefinition.text);
  }

  function insertSignatureIntoCompose() {
    const signatureText = signature.trim();
    if (!signatureText) {
      return;
    }

    const insertionPrefix =
      composePlainText
        ? composePlainTextRef.current?.selectionStart &&
          composePlainTextRef.current.selectionStart > 0
          ? "\n"
          : ""
        : composeEditorRef.current?.innerText.trim().length
        ? "\n"
        : "";

    insertTextIntoCompose(`${insertionPrefix}${signatureText}`);

    if (composeContentState?.activeSignatureId) {
      updateComposeInsertedBlocks(
        "signature",
        composeContentState.activeSignatureId,
        composeContentState.activeSignatureLabel
      );
    }
  }

  function insertComposePresetById(presetId: string) {
    const preset = composeContentState?.presets.find((entry) => entry.id === presetId);

    if (!preset) {
      return;
    }

    if (!composePlainText && preset.html) {
      insertHtmlIntoCompose(preset.html);
    } else {
      insertTextIntoCompose(preset.text);
    }

    updateComposeInsertedBlocks("preset", preset.id, preset.label);
  }

  function dataUrlToBlob(dataUrl: string) {
    const [header, content = ""] = dataUrl.split(",");
    const mime = header.match(/^data:([^;]+);/)?.[1] ?? "application/octet-stream";
    const binary = window.atob(content);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: mime });
  }

  function getComposeImageMimeType(src: string, fallbackType?: string) {
    const dataMime = src.match(/^data:(image\/[^;]+);/i)?.[1]?.toLowerCase();

    if (dataMime === "image/png" || fallbackType === "image/png") {
      return "image/png";
    }

    if (dataMime === "image/webp" || fallbackType === "image/webp") {
      return "image/webp";
    }

    return "image/jpeg";
  }

  async function replaceComposeInlineImageData(
    targetImg: HTMLImageElement,
    nextDataUrl: string
  ) {
    const nextMime = getComposeImageMimeType(
      nextDataUrl,
      targetImg.dataset.filetype || undefined
    );
    const filename = targetImg.dataset.filename;
    const attachmentId = targetImg.dataset.attachmentId;

    targetImg.dataset.filetype = nextMime;

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        window.requestAnimationFrame(() => {
          if (targetImg.isConnected) {
            setImgRect(targetImg.getBoundingClientRect());
          }

          const editorText = composeEditorRef.current?.innerText ?? composeBody;
          setComposeBody(editorText);
          updateComposeCounts(editorText);
          resolve();
        });
      };

      const handleLoad = () => {
        targetImg.removeEventListener("load", handleLoad);
        finish();
      };

      targetImg.addEventListener("load", handleLoad, { once: true });
      targetImg.src = nextDataUrl;

      window.setTimeout(finish, 300);
    });

    if (!filename) {
      return;
    }

    const nextFile = new File([dataUrlToBlob(nextDataUrl)], filename, {
      type: nextMime
    });
    if (attachmentId) {
      composeAttachmentIdsRef.current.set(nextFile, attachmentId);
    }

    setComposeAttachments((current) => {
      let replaced = false;
      const nextAttachments = current.map((file) => {
        const fileAttachmentId = composeAttachmentIdsRef.current.get(file);
        const matchesById =
          Boolean(attachmentId) && Boolean(fileAttachmentId) && fileAttachmentId === attachmentId;
        const matchesLegacyFilename =
          !attachmentId && Boolean(filename) && file.name === filename;

        if (!matchesById && !matchesLegacyFilename) {
          return file;
        }

        replaced = true;
        return nextFile;
      });

      return replaced ? nextAttachments : current;
    });
  }

  async function rotateSelectedImage(degrees: number) {
    if (!selectedImg) {
      return;
    }

    try {
      const source = selectedImg.src;
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Unable to load image."));
        image.src = source;
      });

      const normalized = ((degrees % 360) + 360) % 360;
      const radians = (normalized * Math.PI) / 180;
      const swapSides = normalized === 90 || normalized === 270;
      const canvas = document.createElement("canvas");
      canvas.width = swapSides ? image.naturalHeight : image.naturalWidth;
      canvas.height = swapSides ? image.naturalWidth : image.naturalHeight;

      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas unavailable.");
      }

      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(radians);
      context.drawImage(
        image,
        -image.naturalWidth / 2,
        -image.naturalHeight / 2,
        image.naturalWidth,
        image.naturalHeight
      );

      const mime = getComposeImageMimeType(source, selectedImg.dataset.filetype || undefined);
      const nextDataUrl =
        mime === "image/png"
          ? canvas.toDataURL("image/png")
          : canvas.toDataURL("image/jpeg", 0.92);

      await replaceComposeInlineImageData(selectedImg, nextDataUrl);
    } catch {
      showToast("Couldn't rotate image", "error");
    }
  }

  function closeCropModal() {
    setCropModalOpen(false);
    setCropSourceImg(null);
    setCropRect(null);
    setCropCanvasSize({ width: 0, height: 0 });
    setCropNaturalSize({ width: 0, height: 0 });
    cropImageRef.current = null;
    cropInteractionRef.current = null;
  }

  function clampCropRectToCanvas(nextRect: CropRect, canvasWidth: number, canvasHeight: number) {
    return {
      x: Math.max(0, Math.min(nextRect.x, canvasWidth - nextRect.w)),
      y: Math.max(0, Math.min(nextRect.y, canvasHeight - nextRect.h)),
      w: Math.min(nextRect.w, canvasWidth),
      h: Math.min(nextRect.h, canvasHeight)
    };
  }

  function openCropModal() {
    if (!selectedImg) {
      return;
    }

    setCropSourceImg(selectedImg);
    setCropModalOpen(true);
  }

  function beginCropInteraction(
    mode: CropHandle,
    event: React.PointerEvent<HTMLElement>
  ) {
    if (!cropRect || !cropCanvasSize.width || !cropCanvasSize.height) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const startRect = cropRect;
    cropInteractionRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRect
    };
    const minSize = 20;
    const canvasWidth = cropCanvasSize.width;
    const canvasHeight = cropCanvasSize.height;

    const resizeFromWest = (dx: number) => {
      const nextX = Math.max(
        0,
        Math.min(startRect.x + dx, startRect.x + startRect.w - minSize)
      );
      return {
        x: nextX,
        w: Math.max(minSize, startRect.w - (nextX - startRect.x))
      };
    };

    const resizeFromNorth = (dy: number) => {
      const nextY = Math.max(
        0,
        Math.min(startRect.y + dy, startRect.y + startRect.h - minSize)
      );
      return {
        y: nextY,
        h: Math.max(minSize, startRect.h - (nextY - startRect.y))
      };
    };

    const onMove = (moveEvent: PointerEvent) => {
      const interaction = cropInteractionRef.current;
      if (!interaction) {
        return;
      }

      const dx = moveEvent.clientX - interaction.startX;
      const dy = moveEvent.clientY - interaction.startY;
      let nextRect: CropRect = { ...interaction.startRect };

      if (interaction.mode === "move") {
        nextRect = {
          ...interaction.startRect,
          x: Math.max(
            0,
            Math.min(
              interaction.startRect.x + dx,
              canvasWidth - interaction.startRect.w
            )
          ),
          y: Math.max(
            0,
            Math.min(
              interaction.startRect.y + dy,
              canvasHeight - interaction.startRect.h
            )
          )
        };
      } else {
        if (interaction.mode.includes("w")) {
          const west = resizeFromWest(dx);
          nextRect.x = west.x;
          nextRect.w = west.w;
        }

        if (interaction.mode.includes("e")) {
          nextRect.w = Math.max(
            minSize,
            Math.min(canvasWidth - interaction.startRect.x, interaction.startRect.w + dx)
          );
        }

        if (interaction.mode.includes("n")) {
          const north = resizeFromNorth(dy);
          nextRect.y = north.y;
          nextRect.h = north.h;
        }

        if (interaction.mode.includes("s")) {
          nextRect.h = Math.max(
            minSize,
            Math.min(canvasHeight - interaction.startRect.y, interaction.startRect.h + dy)
          );
        }
      }

      setCropRect(clampCropRectToCanvas(nextRect, canvasWidth, canvasHeight));
    };

    const onUp = () => {
      cropInteractionRef.current = null;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }

  async function applyCropToSelectedImage() {
    if (!cropSourceImg || !cropRect || !cropCanvasSize.width || !cropCanvasSize.height) {
      return;
    }

    try {
      const sourceImage = cropImageRef.current ?? new Image();

      if (!cropImageRef.current) {
        await new Promise<void>((resolve, reject) => {
          sourceImage.onload = () => resolve();
          sourceImage.onerror = () => reject(new Error("Unable to load image."));
          sourceImage.src = cropSourceImg.src;
        });
      }

      const scaleX = sourceImage.naturalWidth / cropCanvasSize.width;
      const scaleY = sourceImage.naturalHeight / cropCanvasSize.height;
      const sourceX = Math.max(0, Math.round(cropRect.x * scaleX));
      const sourceY = Math.max(0, Math.round(cropRect.y * scaleY));
      const sourceW = Math.max(1, Math.round(cropRect.w * scaleX));
      const sourceH = Math.max(1, Math.round(cropRect.h * scaleY));
      const canvas = document.createElement("canvas");
      canvas.width = sourceW;
      canvas.height = sourceH;

      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas unavailable.");
      }

      context.drawImage(
        sourceImage,
        sourceX,
        sourceY,
        sourceW,
        sourceH,
        0,
        0,
        sourceW,
        sourceH
      );

      const mime = getComposeImageMimeType(
        cropSourceImg.src,
        cropSourceImg.dataset.filetype || undefined
      );
      const nextDataUrl =
        mime === "image/png"
          ? canvas.toDataURL("image/png")
          : canvas.toDataURL("image/jpeg", 0.92);

      await replaceComposeInlineImageData(cropSourceImg, nextDataUrl);
      closeCropModal();
    } catch {
      showToast("Couldn't crop image", "error");
    }
  }

  const bridgeMessageFrameScroll = useCallback(
    (iframe: HTMLIFrameElement, scrollContainer: HTMLElement | null) => {
      const frame = iframe as ScrollBridgedFrame;
      const doc = frame.contentDocument;
      const body = doc?.body;
      const root = doc?.documentElement;
      const nextHeight = Math.max(
        body?.scrollHeight ?? 0,
        body?.offsetHeight ?? 0,
        root?.scrollHeight ?? 0,
        root?.offsetHeight ?? 0
      );

      frame.style.height = `${nextHeight}px`;
      frame.__mmwbmailScrollCleanup?.();
      frame.__mmwbmailScrollCleanup = undefined;

      if (!doc || !body || !root || !scrollContainer) {
        return;
      }

      body.style.overflow = "hidden";
      root.style.overflow = "hidden";

      const onWheel = (event: WheelEvent) => {
        if (scrollContainer.scrollHeight <= scrollContainer.clientHeight + 1) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        scrollContainer.scrollBy({
          top: event.deltaY,
          left: event.deltaX,
          behavior: "auto"
        });
      };

      body.addEventListener("wheel", onWheel, { passive: false, capture: true });
      root.addEventListener("wheel", onWheel, { passive: false, capture: true });
      doc.defaultView?.addEventListener("wheel", onWheel, {
        passive: false,
        capture: true
      });

      frame.__mmwbmailScrollCleanup = () => {
        body.removeEventListener("wheel", onWheel, true);
        root.removeEventListener("wheel", onWheel, true);
        doc.defaultView?.removeEventListener("wheel", onWheel, true);
      };
    },
    []
  );

  function insertLinkAtSelection(urlInput: string, textInput: string) {
    const editor = composeEditorRef.current;

    if (!editor) {
      return;
    }

    const url = urlInput.startsWith("http") ? urlInput : `https://${urlInput}`;
    const selection = window.getSelection();
    const baseRange =
      savedRangeRef.current?.cloneRange() ??
      (selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null);

    editor.focus();

    const range = baseRange ?? document.createRange();

    if (!baseRange) {
      range.selectNodeContents(editor);
      range.collapse(false);
    }

    const selectedText = baseRange?.toString() ?? "";
    const linkLabel = textInput.trim() || selectedText || url;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.textContent = linkLabel;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";

    range.deleteContents();
    range.insertNode(anchor);
    range.setStartAfter(anchor);
    range.collapse(true);

    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }

    setComposeBody(editor.innerText);
    updateComposeCounts(editor.innerText);
    savedRangeRef.current = null;
  }

  function updateComposeRichTextSnapshot() {
    const editor = composeEditorRef.current;
    if (!editor) {
      return;
    }

    const text = editor.innerText ?? "";
    setComposeBody(text);
    updateComposeCounts(text);
  }

  function restoreComposeEditorSelection() {
    if (composePlainText) {
      composePlainTextRef.current?.focus();
      return;
    }

    const editor = composeEditorRef.current;
    if (!editor) {
      return;
    }

    editor.focus();

    if (!savedRangeRef.current || typeof window === "undefined") {
      return;
    }

    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    selection.removeAllRanges();
    selection.addRange(savedRangeRef.current.cloneRange());
  }

  function transformComposeSelectionCase(mode: "upper" | "lower" | "title") {
    if (composePlainText) {
      const textarea = composePlainTextRef.current;
      if (!textarea) {
        return;
      }

      const start = textarea.selectionStart ?? 0;
      const end = textarea.selectionEnd ?? start;

      if (start === end) {
        return;
      }

      const selectedText = textarea.value.slice(start, end);
      const nextText = transformComposeCaseValue(selectedText, mode);
      textarea.focus();
      textarea.setRangeText(nextText, start, end, "select");
      const nextValue = textarea.value;
      setComposeBody(nextValue);
      updateComposeCounts(nextValue);
      setComposeSelectionState({
        hasSelection: nextText.length > 0,
        text: nextText,
        isCollapsed: false
      });
      return;
    }

    restoreComposeEditorSelection();

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }

    const range = selection.getRangeAt(0);
    const fragment = range.extractContents();
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
    let hasText = false;

    for (let textNode = walker.nextNode(); textNode; textNode = walker.nextNode()) {
      const node = textNode as Text;
      if (!node.nodeValue) {
        continue;
      }

      node.nodeValue = transformComposeCaseValue(node.nodeValue, mode);
      hasText = true;
    }

    if (!hasText) {
      range.insertNode(fragment);
      return;
    }

    const wrapper = document.createElement("span");
    wrapper.appendChild(fragment);
    const nodes = Array.from(wrapper.childNodes);
    const insertion = document.createDocumentFragment();
    nodes.forEach((node) => insertion.appendChild(node));
    range.insertNode(insertion);

    if (nodes.length > 0) {
      const nextRange = document.createRange();
      nextRange.setStartBefore(nodes[0]);
      nextRange.setEndAfter(nodes[nodes.length - 1]);
      selection.removeAllRanges();
      selection.addRange(nextRange);
      savedRangeRef.current = nextRange.cloneRange();
    }

    updateComposeRichTextSnapshot();
  }

  function insertTextIntoCompose(text: string) {
    if (composePlainText) {
      const textarea = composePlainTextRef.current;
      if (!textarea) {
        return;
      }

      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? start;
      textarea.focus();
      textarea.setRangeText(text, start, end, "end");
      const nextValue = textarea.value;
      setComposeBody(nextValue);
      updateComposeCounts(nextValue);
      setComposeSelectionState({
        hasSelection: false,
        text: "",
        isCollapsed: true
      });
      return;
    }

    restoreComposeEditorSelection();

    if (!execOnEditable("insertText", text, composeEditorRef.current)) {
      const editor = composeEditorRef.current;
      if (!editor) {
        return;
      }

      editor.append(text);
    }

    updateComposeRichTextSnapshot();
  }

  function insertHtmlIntoCompose(html: string) {
    if (composePlainText) {
      insertTextIntoCompose(stripHtml(html));
      return;
    }

    restoreComposeEditorSelection();

    if (!execOnEditable("insertHTML", html, composeEditorRef.current)) {
      const editor = composeEditorRef.current;
      if (!editor) {
        return;
      }

      const selection = window.getSelection();
      const range =
        savedRangeRef.current?.cloneRange() ??
        (selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null);

      if (!range) {
        editor.insertAdjacentHTML("beforeend", html);
        updateComposeRichTextSnapshot();
        return;
      }

      const fragment = range.createContextualFragment(html);
      range.deleteContents();
      range.insertNode(fragment);
    }

    updateComposeRichTextSnapshot();
  }

  async function waitForPrintDocumentAssets(printDocument: Document) {
    if (typeof window === "undefined") {
      return;
    }

    const pendingImages = Array.from(printDocument.images).filter(
      (image) => !image.complete
    );

    if (pendingImages.length === 0) {
      return;
    }

    await Promise.allSettled(
      pendingImages.map(
        (image) =>
          new Promise<void>((resolve) => {
            const timer = window.setTimeout(resolve, 1500);
            const finish = () => {
              window.clearTimeout(timer);
              resolve();
            };

            image.addEventListener("load", finish, { once: true });
            image.addEventListener("error", finish, { once: true });
          })
      )
    );
  }

  function applyComposeSession(
    session: ComposeSessionInit,
    options?: {
      restoredDraft?: StoredComposerDraft | null;
      restoredFiles?: File[];
      savedAt?: string | null;
      localRevision?: number;
      lastSavedRevision?: number;
    }
  ) {
    const restoredDraft = options?.restoredDraft ?? null;
    const restoredFiles = options?.restoredFiles ?? [];
    const recipients = normalizeRecipientGroups({
      to: session.to,
      cc: session.cc,
      bcc: session.bcc
    });

    setComposePos(null);
    setComposeDraftId(session.draftId);
    setComposeIntent(session.intent);
    setComposeSourceMessageMeta(session.sourceMessageMeta);
    setComposeDraft(restoredDraft);
    setComposeSessionContext(session.context);
    setComposeIdentity(session.identity);
    setComposeContentState(session.content);

    if (restoredDraft) {
      setComposeDraftStatus("saved");
      setComposeDraftSavedAt(options?.savedAt ?? restoredDraft.savedAt ?? restoredDraft.updatedAt);
      setComposeDraftError(null);
      composeLocalRevisionRef.current = options?.localRevision ?? restoredDraft.localRevision;
      composeLastSavedRevisionRef.current =
        options?.lastSavedRevision ?? restoredDraft.lastSavedRevision;
    } else {
      setComposeDraftStatus("unsaved");
      setComposeDraftSavedAt(null);
      setComposeDraftError(null);
      composeLocalRevisionRef.current = 0;
      composeLastSavedRevisionRef.current = 0;
    }

    setComposeToList(recipients.to);
    setComposeCcList(recipients.cc);
    setComposeBccList(recipients.bcc);
    setComposeReplyTo(session.identity?.replyTo ?? session.replyTo);
    setComposeAttachments(restoredFiles);
    setComposeSubject(session.subject);
    setComposeBody(session.textBody);
    setSignature(session.signature);
    updateComposeCounts(session.textBody);
    setComposeHeight(getInitialComposeHeight());
    setComposeMinimized(false);
    setComposePlainText(session.ui.plainText);
    setComposeToolbarMenuOpen(false);
    setComposeToolbarMenuPosition(null);
    setComposeToolbarOverflowOpen(false);
    setComposeQuickInsertOpen(false);
    setShowCc(session.ui.showCc);
    setShowBcc(session.ui.showBcc);
    setShowReplyTo(session.ui.showReplyTo);
    setDiscardConfirmOpen(false);
    setComposeOpen(true);

    window.setTimeout(() => {
      const editor = composeEditorRef.current;
      if (!editor) {
        return;
      }

      if (session.htmlBody) {
        editor.innerHTML = session.htmlBody;
      } else if (!session.ui.plainText) {
        editor.innerHTML = session.textBody.replace(/\n/g, "<br/>");
      }
    }, 50);
  }

  function openCompose() {
    const draftId = createComposeDraftId();
    const ownerAccountId = resolveNewComposeOwner(accounts, mailboxContext);
    const context = createComposeSessionContext({
      sessionId: draftId,
      accounts,
      ownerAccountId,
      ownerLocked: Boolean(ownerAccountId),
      initializationSource: "new"
    });
    const identity = resolveComposeIdentityState({
      accounts,
      preferredAccountId: ownerAccountId,
      ownerAccountId: context.ownerAccountId,
      ownerLocked: context.ownerLocked
    });
    const content = resolveComposeContentForSession(identity, { kind: "new" });

    applyComposeSession(
      createNewComposeSession({
        draftId,
        accountId: context.ownerAccountId,
        context,
        identity,
        content,
        signature: content.activeSignatureText
      })
    );
  }

  function startMessageCompose(intentKind: MessageComposeIntentKind, message: MailDetail) {
    const draftId = createComposeDraftId();
    const ownerAccountId = resolveReplyOwner(
      accounts,
      message.accountId,
      mailboxContext,
      composeSessionContext?.ownerAccountId
    );
    const context = createComposeSessionContext({
      sessionId: draftId,
      accounts,
      ownerAccountId,
      ownerLocked: Boolean(ownerAccountId),
      initializationSource: intentKind,
      sourceAccountId: message.accountId ?? null,
      sourceMessageId: message.messageId ?? null,
      sourceMessageUid: message.uid
    });
    const identity = resolveComposeIdentityState({
      accounts,
      preferredAccountId: ownerAccountId,
      ownerAccountId: context.ownerAccountId,
      ownerLocked: context.ownerLocked
    });
    const intent: ComposeIntent =
      intentKind === "reply"
        ? { kind: "reply", sourceUid: message.uid, sourceMessageId: message.messageId }
        : intentKind === "reply_all"
        ? { kind: "reply_all", sourceUid: message.uid, sourceMessageId: message.messageId }
        : intentKind === "forward"
        ? { kind: "forward", sourceUid: message.uid, sourceMessageId: message.messageId }
        : { kind: "edit_as_new", sourceUid: message.uid, sourceMessageId: message.messageId };
    const content = resolveComposeContentForSession(identity, intent);

    applyComposeSession(
      createMessageComposeSession(intentKind, message, {
        draftId,
        accountId: context.ownerAccountId,
        context,
        identity,
        content,
        signature: content.activeSignatureText,
        currentAccountEmail: identity?.sender?.address ?? currentAccountEmail
      })
    );
  }

  function handleReply(message: MailDetail) {
    startMessageCompose("reply", message);
  }

  function handleReplyAll(message: MailDetail) {
    startMessageCompose("reply_all", message);
  }

  function handleForward(message: MailDetail) {
    startMessageCompose("forward", message);
  }

  function handleEditAsNew(message: MailDetail) {
    startMessageCompose("edit_as_new", message);
  }

  function handleUnsubscribeByEmail(message: MailDetail) {
    const draftId = createComposeDraftId();
    const initialBody = "";
    const unsubscribeEmail = message.listUnsubscribeEmail?.trim();
    const ownerAccountId =
      composeSessionContext?.ownerAccountId ??
      resolveReplyOwner(
        accounts,
        message.accountId,
        mailboxContext,
        composeSessionContext?.ownerAccountId
      );
    const context =
      composeSessionContext ??
      createComposeSessionContext({
        sessionId: draftId,
        accounts,
        ownerAccountId,
        ownerLocked: Boolean(ownerAccountId),
        initializationSource: "new",
        sourceAccountId: message.accountId ?? null,
        sourceMessageId: message.messageId ?? null,
        sourceMessageUid: message.uid
      });
    const identity =
      composeIdentity ??
      resolveComposeIdentityState({
        accounts,
        preferredAccountId: ownerAccountId,
        ownerAccountId: context.ownerAccountId,
        ownerLocked: context.ownerLocked,
        persistedReplyTo: ""
      });

    if (!unsubscribeEmail) {
      return;
    }

    applyComposeSession({
      draftId,
      accountId: context.ownerAccountId,
      context,
      identity,
      content: resolveComposeContentForSession(
        identity,
        { kind: "new" }
      ),
      intent: { kind: "new" },
      sourceMessageMeta: null,
      to: [unsubscribeEmail],
      cc: [],
      bcc: [],
      replyTo: "",
      subject: "Unsubscribe",
      textBody: initialBody,
      signature: "",
      ui: {
        showCc: false,
        showBcc: false,
        showReplyTo: false,
        plainText: false
      }
    });
    setUnsubscribeConfirm(false);
  }

  async function handleArchive(message: MailDetail) {
    if (!activeAccountId) {
      setStatus("Connect an account first.");
      return;
    }

    await dispatchMailAction(
      {
        kind: "archive",
        accountId: activeAccountId,
        folderPath: currentFolderPath,
        target: createMessageActionTarget(message.uid),
        destinationFolder: mailActionCapabilities.archive.destinationFolder
      },
      {
        toastMessage: "Message archived"
      }
    );
  }

  async function handleDeleteOne(message: MailDetail) {
    if (!activeAccountId) {
      setStatus("Connect an account first.");
      return;
    }

    await dispatchMailAction(
      {
        kind: "delete",
        accountId: activeAccountId,
        folderPath: currentFolderPath,
        target: createMessageActionTarget(message.uid)
      },
      {
        toastMessage: "Message moved to Trash"
      }
    );
  }

  async function handleSpam(message: MailDetail) {
    if (!activeAccountId) {
      setStatus("Connect an account first.");
      return;
    }

    await dispatchMailAction(
      {
        kind: "spam",
        accountId: activeAccountId,
        folderPath: currentFolderPath,
        target: createMessageActionTarget(message.uid),
        destinationFolder: mailActionCapabilities.spam.destinationFolder
      },
      {
        toastMessage: "Marked as spam"
      }
    );
  }

  async function handleToggleRead(message: MailSummary | MailDetail) {
    if (!activeAccountId) {
      setStatus("Connect an account first.");
      return;
    }

    await dispatchMailAction({
      kind: message.seen ? "mark_unread" : "mark_read",
      accountId: activeAccountId,
      folderPath: currentFolderPath,
      target: createMessageActionTarget(message.uid)
    });
  }

  async function handleBulkToggleRead() {
    if (!activeAccountId || selectedMessages.length === 0) {
      return;
    }

    const anyUnread = selectedMessages.some((message) => !message.seen);

    await dispatchMailAction(
      {
        kind: anyUnread ? "mark_read" : "mark_unread",
        accountId: activeAccountId,
        folderPath: currentFolderPath,
        target: {
          scope: "message",
          messageUids: selectedMessages.map((message) => message.uid)
        }
      },
      {
        clearSelectionOnSuccess: true
      }
    );
  }

  function handleBulkMove() {
    const scopedMessages = getScopedBulkActionMessages();
    if (!scopedMessages) {
      return;
    }

    const firstSelected = scopedMessages[0] ?? null;
    setMoveConversationTargetId(null);
    setMoveTarget(firstSelected);
    setBulkMoveActive(true);
    setMoveFolderOpen(true);
  }

  function hasSortFolderPreset(preset: SortFolderPreset) {
    return orderedFolders.some(
      (folder) => getSortFolderPresetByMailbox(folder.name, folder.path)?.key === preset.key
    );
  }

  async function executeSortToFolder(
    messageUids: number[],
    preset: SortFolderPreset,
    options?: {
      clearSelectionOnSuccess?: boolean;
      toastMessage?: string;
    }
  ) {
    if (!activeAccountId) {
      setStatus("Connect an account first.");
      return false;
    }

    const resolvedUids = Array.from(new Set(messageUids));
    if (resolvedUids.length === 0) {
      setStatus("No messages selected for sorting.");
      return false;
    }

    const scopedMessages = sortedMessages.filter((message) => resolvedUids.includes(message.uid));
    if (scopedMessages.length !== resolvedUids.length) {
      setStatus("Sort only works on messages in the current mailbox view.");
      return false;
    }

    if (scopedMessages.some((message) => message.accountId !== activeAccountId)) {
      setStatus("Sort only works within the active account.");
      return false;
    }

    const folderAlreadyExists = hasSortFolderPreset(preset);
    const moved = await dispatchMailAction(
      {
        kind: "move",
        accountId: activeAccountId,
        folderPath: currentFolderPath,
        target: {
          scope: "message",
          messageUids: scopedMessages.map((message) => message.uid)
        },
        destinationFolder: preset.folderName
      },
      {
        clearSelectionOnSuccess: options?.clearSelectionOnSuccess,
        pendingMutationTtlMs: isScopedNewMailReadDelayActive
          ? NEW_MAIL_SORT_PENDING_MUTATION_TTL_MS
          : undefined,
        toastMessage: options?.toastMessage ?? `Sorted to ${preset.label}`
      }
    );

    if (moved && !folderAlreadyExists) {
      await refreshFolderCounts(activeAccountId);
    }

    return moved;
  }

  async function handleBulkSortToFolder(preset: SortFolderPreset) {
    if (selectedMessages.length === 0) {
      return;
    }

    setBulkSelectionMenu(null);
    await executeSortToFolder(
      selectedMessages.map((message) => message.uid),
      preset,
      {
        clearSelectionOnSuccess: true
      }
    );
  }

  function handleBulkBlock() {
    const addressesToBlock = Array.from(
      new Set(
        sortedMessages
          .filter((message) => selectedUids.has(message.uid))
          .map((message) => message.fromAddress)
          .filter(Boolean)
      )
    );

    if (addressesToBlock.length === 0) {
      return;
    }

    setBlockedSenders((previous) => new Set([...previous, ...addressesToBlock]));
    showToast(
      `${addressesToBlock.length} sender${addressesToBlock.length !== 1 ? "s" : ""} blocked`
    );
    clearSelection();
  }

  async function handleBulkDelete() {
    if (!activeAccountId || selectedUids.size === 0) {
      return;
    }

    await dispatchMailAction(
      {
        kind: "delete",
        accountId: activeAccountId,
        folderPath: currentFolderPath,
        target: {
          scope: "message",
          messageUids: Array.from(selectedUids)
        }
      },
      {
        clearSelectionOnSuccess: true
      }
    );
  }

  function startWorkspacePaneResize(
    divider: "sidebar" | "list",
    event: React.MouseEvent<HTMLDivElement>
  ) {
    if (!isWideWorkspace || !workspaceRef.current) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const containerWidth = workspaceRef.current.clientWidth;
    const startWidths = workspacePaneWidths;
    if (workspacePaneSettlingTimerRef.current !== null) {
      window.clearTimeout(workspacePaneSettlingTimerRef.current);
      workspacePaneSettlingTimerRef.current = null;
    }
    setWorkspacePaneSettling(false);
    setWorkspaceActiveDivider(divider);
    setWorkspaceHoveredDivider(divider);

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const requested =
        divider === "sidebar"
          ? { sidebar: startWidths.sidebar + delta, list: startWidths.list }
          : { sidebar: startWidths.sidebar, list: startWidths.list + delta };

      setWorkspacePaneWidths(clampWorkspacePaneWidths(requested, containerWidth));
    };

    const stop = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", stop);
      setWorkspaceActiveDivider(null);
      setWorkspacePaneSettling(true);
      workspacePaneSettlingTimerRef.current = window.setTimeout(() => {
        setWorkspacePaneSettling(false);
        workspacePaneSettlingTimerRef.current = null;
      }, 160);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", stop);
  }

  async function dispatchConversationAction(
    kind: MailActionRequest["kind"],
    conversationId: string,
    options?: {
      destinationFolder?: string;
      toastMessage?: string;
    }
  ) {
    if (!activeAccountId) {
      setStatus("Connect an account first.");
      return;
    }

    const target = createConversationActionTarget(conversationId);
    if (!target) {
      setStatus("Conversation unavailable.");
      return;
    }

    await dispatchMailAction(
      {
        kind,
        accountId: activeAccountId,
        folderPath: currentFolderPath,
        target,
        destinationFolder: options?.destinationFolder
      },
      {
        toastMessage: options?.toastMessage
      }
    );
  }

  function openConversationMove(conversationId: string) {
    setMoveTarget(null);
    setBulkMoveActive(false);
    setMoveConversationTargetId(conversationId);
    setMoveFolderOpen(true);
  }

  async function forceRefresh() {
    if (!activeAccountId) {
      return;
    }

    const folder = currentFolderPath;
    await clearFolderCache(folder, activeAccountId);
    const refreshedMessages = await loadMessages(folder, { force: true });
    clearMessageViewState(
      setSelectedUid,
      setSelectedMessage,
      setQuery,
      setSenderFilter,
      setSubjectFilter,
      setSubjectPattern
    );
    setSelectedUid(refreshedMessages[0]?.uid ?? null);
    showToast("Inbox refreshed");
  }

  function handleMove(message: MailDetail) {
    setBulkMoveActive(false);
    setMoveConversationTargetId(null);
    setMoveTarget(message);
    setMoveFolderOpen(true);
  }

  async function handleSortToFolder(
    message: MailSummary | MailDetail,
    preset: SortFolderPreset
  ) {
    setSortMenuUid(null);
    await executeSortToFolder([message.uid], preset);
  }

  async function handleCleanupSortToFolder(
    senderName: string,
    senderMessages: MailSummary[],
    preset: SortFolderPreset
  ) {
    setCleanupSortMenuSender(null);
    await executeSortToFolder(
      senderMessages.map((message) => message.uid),
      preset,
      {
        toastMessage: `Sorted ${senderMessages.length} message${
          senderMessages.length === 1 ? "" : "s"
        } to ${preset.label}`
      }
    );

    if (cleanupExpandedSender === senderName) {
      setCleanupExpandedMsg(null);
    }
  }

  function getScopedSenderMessages(filterValue: string) {
    return messages.filter(
      (message) => getSenderFilterValue(message) === filterValue
    );
  }

  const sortActionTitle =
    "Quick sort into Receipts, Travel, Follow-Up, or Reference";
  const moveActionTitle = "Move to any folder";
  const currentActionAccountLabel = currentAccountEmail || "this account";

  function getScopedBulkActionMessages() {
    const scopedMessages = sortedMessages.filter((message) => selectedUids.has(message.uid));

    if (scopedMessages.length === 0) {
      setStatus("No messages selected.");
      return null;
    }

    if (scopedMessages.length !== selectedUids.size) {
      setStatus("Bulk actions only work on messages in the current mailbox view.");
      return null;
    }

    if (!activeAccountId || scopedMessages.some((message) => message.accountId !== activeAccountId)) {
      setStatus("Bulk actions only work within the active account.");
      return null;
    }

    return scopedMessages;
  }

  function renderSortButton(
    message: MailSummary | MailDetail,
    options?: {
      stopPropagation?: boolean;
      variant?: "default" | "mobile";
      menuAlign?: "start" | "end";
      onToggle?: () => void;
    }
  ) {
    const isOpen = sortMenuUid === message.uid;
    const variant = options?.variant ?? "default";
    const menuAlign = options?.menuAlign ?? "start";

    return (
      <div
        className={`tb-sort-wrap ${variant === "mobile" ? "tb-sort-wrap-mobile" : ""} ${
          menuAlign === "end" ? "tb-sort-wrap-end" : ""
        }`}
        ref={isOpen ? sortMenuRef : null}
      >
        <button
          className={`tb-btn tb-btn-sort-primary ${
            variant === "mobile" ? "mobile-viewer-action-btn" : ""
          } ${isOpen ? "tb-btn-active" : ""}`}
          title={sortActionTitle}
          onClick={(event) => {
            if (options?.stopPropagation) {
              event.stopPropagation();
            }

            options?.onToggle?.();
            setSortMenuUid((current) => (current === message.uid ? null : message.uid));
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 7h12" />
            <path d="M3 12h18" />
            <path d="M3 17h10" />
            <path d="m17 5 4 4-4 4" />
          </svg>
          <span>Sort</span>
        </button>
        {isOpen ? (
          <div
            className={`tb-sort-menu ${variant === "mobile" ? "tb-sort-menu-mobile" : ""} ${
              menuAlign === "end" ? "tb-sort-menu-end" : ""
            }`}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="action-menu-header">
              <div className="action-menu-title">Quick Sort</div>
              <div className="action-menu-sub">
                Fast-file into your built-in organization folders for {currentActionAccountLabel}.
              </div>
            </div>
            {SORT_FOLDER_PRESETS.map((preset) => {
              const isCurrentFolder =
                getSortFolderPresetByMailbox(null, currentFolderPath)?.key === preset.key;

              return (
                <button
                  key={preset.key}
                  className="tb-sort-item"
                  title={preset.tooltip}
                  disabled={isCurrentFolder}
                  onClick={() => {
                    void handleSortToFolder(message, preset);
                  }}
                >
                  <span className="tb-sort-item-label">
                    <span className={`sort-folder-glyph sort-folder-glyph-${preset.tone}`}>
                      {renderSortFolderGlyph(preset)}
                    </span>
                    <span>{preset.label}</span>
                  </span>
                  <span className="tb-sort-item-sub">
                    {isCurrentFolder ? "Already in this quick-sort folder." : preset.description}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  function renderMobileViewerActions(message: MailDetail) {
    const readToggleCopy = getReadToggleActionCopy(message.seen, { concise: true });

    return (
      <div className="mobile-viewer-actions">
        {renderSortButton(message, {
          variant: "mobile",
          menuAlign: "end",
          onToggle: () => setMobileViewerMenuOpen(false)
        })}
        <button
          type="button"
          className="tb-btn mobile-viewer-action-btn"
          title={moveActionTitle}
          onClick={() => {
            setMobileViewerMenuOpen(false);
            handleMove(message);
          }}
        >
          <span>Move</span>
        </button>
        <div
          className="mobile-viewer-menu-wrap"
          ref={mobileViewerMenuOpen ? mobileViewerMenuRef : null}
        >
          <button
            type="button"
            className={`tb-btn mobile-viewer-action-btn ${
              mobileViewerMenuOpen ? "tb-btn-active" : ""
            }`}
            onClick={() => setMobileViewerMenuOpen((current) => !current)}
            aria-label="More message actions"
          >
            <span>More</span>
          </button>
          {mobileViewerMenuOpen ? (
            <div
              className="tb-sort-menu tb-sort-menu-end mobile-viewer-menu"
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="action-menu-header">
                <div className="action-menu-title">Message Actions</div>
                <div className="action-menu-sub">
                  Reply and message-state actions for the current message.
                </div>
              </div>
              <button
                type="button"
                className="mobile-viewer-menu-item"
                onClick={() => {
                  setMobileViewerMenuOpen(false);
                  handleReply(message);
                }}
              >
                <span>Reply</span>
              </button>
              <button
                type="button"
                className="mobile-viewer-menu-item"
                onClick={() => {
                  setMobileViewerMenuOpen(false);
                  handleReplyAll(message);
                }}
              >
                <span>Reply All</span>
              </button>
              <button
                type="button"
                className="mobile-viewer-menu-item"
                onClick={() => {
                  setMobileViewerMenuOpen(false);
                  handleForward(message);
                }}
              >
                <span>Forward</span>
              </button>
              <button
                type="button"
                className="mobile-viewer-menu-item"
                onClick={() => {
                  setMobileViewerMenuOpen(false);
                  void handleToggleRead(message);
                }}
              >
                <span>{readToggleCopy.label}</span>
              </button>
              <button
                type="button"
                className="mobile-viewer-menu-item mobile-viewer-menu-item-danger"
                onClick={() => {
                  setMobileViewerMenuOpen(false);
                  void handleDeleteOne(message);
                }}
              >
                <span>Delete</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function openEditAccount(account: MailAccountSummary) {
    persistConnection({
      email: account.email,
      password: "",
      imapHost: account.imapHost,
      imapPort: account.imapPort,
      imapSecure: account.imapSecure,
      smtpHost: account.smtpHost,
      smtpPort: account.smtpPort,
      smtpSecure: account.smtpSecure,
      folder: account.defaultFolder ?? "INBOX"
    });
    setAccountFormError(null);
    setAccountFormSuccess(null);
    setAccountFormTarget(account.id);
    setAccountFormMode("edit");
  }

  function openAddAccount() {
    persistConnection({
      email: "",
      password: "",
      imapHost: "",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "",
      smtpPort: 465,
      smtpSecure: true,
      folder: "INBOX"
    });
    setAccountFormError(null);
    setAccountFormSuccess(null);
    setAccountFormTarget(null);
    setAccountFormMode("add");
  }

  function closeAccountForm() {
    setAccountFormError(null);
    setAccountFormMode(null);
    setAccountFormTarget(null);
  }

  async function deleteConfiguredAccount(account: MailAccountSummary) {
    if (!window.confirm(`Delete ${account.email}? This removes the saved account from Maximail.`)) {
      return;
    }

    setAccountFormError(null);
    setAccountFormSuccess(null);
    setIsBusy(true);

    try {
      const result = await deleteJson<{
        success: true;
        deletedAccountId: string;
        nextAccountId: string | null;
      }>(`/api/accounts/${account.id}`);
      const remainingAccounts = accounts.filter((entry) => entry.id !== account.id);
      const optimisticNextAccount =
        remainingAccounts.find((entry) => entry.id === result.nextAccountId) ??
        remainingAccounts.find((entry) => entry.id === explicitActiveAccountIdRef.current) ??
        remainingAccounts.find((entry) => entry.id === activeAccountIdRef.current) ??
        remainingAccounts.find((entry) => entry.isDefault) ??
        remainingAccounts[0] ??
        null;

      if (accountFormTarget === account.id) {
        closeAccountForm();
      }

      setAccounts(remainingAccounts);
      setFoldersByAccount((current) => {
        const next = { ...current };
        delete next[account.id];
        return next;
      });

      let nextAccount = optimisticNextAccount;

      try {
        nextAccount =
          (await loadPersistedAccounts(result.nextAccountId ?? undefined)) ?? optimisticNextAccount;
      } catch (error) {
        setAccountFormSuccess(
          `${account.email} was removed, but Maximail couldn't fully refresh the account list yet.`
        );
        setStatus(
          error instanceof Error
            ? `Deleted ${account.email}, but couldn't refresh the account list.`
            : `Deleted ${account.email}, but couldn't refresh the account list.`
        );
      }

      if (account.id === activeAccountId) {
        if (nextAccount) {
          try {
            await activateAccount(nextAccount, {
              sync: true,
              folderOverride: nextAccount.defaultFolder || "INBOX"
            });
          } catch (error) {
            explicitActiveAccountIdRef.current = nextAccount.id;
            setActiveAccountId(nextAccount.id);
            applyAccountToConnection(nextAccount, nextAccount.defaultFolder || "INBOX");
            setAccountFormSuccess(
              `${account.email} was removed. ${nextAccount.email} is now selected, but Maximail couldn't fully load it yet.`
            );
            setStatus(
              error instanceof Error
                ? `Deleted ${account.email}, but couldn't fully load ${nextAccount.email}.`
                : `Deleted ${account.email}, but couldn't fully load ${nextAccount.email}.`
            );
          }
          setAccountFormSuccess(`${account.email} was removed.`);
          showToast(`Deleted ${account.email}`);
        } else {
          explicitActiveAccountIdRef.current = null;
          setActiveAccountId(null);
          setFolders([]);
          setFoldersByAccount({});
          setMessages([]);
          setConnection(defaultConnection);
          clearMessageViewState(
            setSelectedUid,
            setSelectedMessage,
            setQuery,
            setSenderFilter,
            setSubjectFilter,
            setSubjectPattern
          );
          setStatus("Connect a live mailbox to begin.");
          setAccountFormSuccess(`${account.email} was removed.`);
          showToast(`Deleted ${account.email}`);
        }
      } else {
        setFoldersByAccount((current) => {
          const next = { ...current };
          delete next[account.id];
          return next;
        });
        setAccountFormSuccess(`${account.email} was removed.`);
        showToast(`Deleted ${account.email}`);
      }
    } catch (error) {
      const message = describeAccountDeleteError(error);
      setAccountFormError(message);
      setStatus(message);
    } finally {
      setIsBusy(false);
    }
  }

  function openPrintModal(targetUid = selectedMessage?.uid ?? null) {
    setPrintTargetUid(targetUid);
    setPrintScope("message");
    setPrintFormat("print");
    setPrintIncludeHeaders(true);
    setPrintIncludeQuoted(true);
    setPrintModalOpen(true);
  }

  const handleConnect = connectMailbox;
  const composeCapabilityFlags = useMemo<ComposeCapabilityFlags>(
    () => ({
      canAttachFiles: true,
      canInsertImages: true,
      canPrintDraft: false,
      canScheduleSend: false,
      canUseRichText: true
    }),
    []
  );
  const composeAttachmentAdapter = useMemo<ComposeAttachmentPipelineAdapter>(
    () => ({
      openFilePicker: () => attachInputRef.current?.click(),
      openPhotoPicker: () => {
        if (imageInputRef.current) {
          imageInputRef.current.click();
          return;
        }

        attachInputRef.current?.click();
      },
      readFileAsDataUrl: readComposeFileAsDataUrl,
      appendAttachments: (files) => {
        if (files.length === 0) {
          return;
        }

        setComposeAttachments((current) => [...current, ...files]);
      },
      insertInlinePhoto: ({ file, dataUrl, range, alt }) => {
        insertInlineImageAtSelection(file, dataUrl, range, alt ?? file.name);
      },
      removeAttachment: ({ file, index, attachmentId, filename, removeInlineElement }) => {
        setComposeAttachments((current) =>
          current.filter((entry, entryIndex) => {
            if (typeof index === "number" && entryIndex === index) {
              composeAttachmentDataUrlCacheRef.current.delete(entry);
              return false;
            }

            if (file && entry === file) {
              composeAttachmentDataUrlCacheRef.current.delete(entry);
              return false;
            }

            const fileAttachmentId = composeAttachmentIdsRef.current.get(entry);
            if (attachmentId && fileAttachmentId) {
              if (fileAttachmentId === attachmentId) {
                composeAttachmentDataUrlCacheRef.current.delete(entry);
                return false;
              }
              return true;
            }

            if (filename && entry.name === filename) {
              composeAttachmentDataUrlCacheRef.current.delete(entry);
              return false;
            }

            return true;
          })
        );

        if (removeInlineElement && selectedImg) {
          selectedImg.remove();
          const editorText = composeEditorRef.current?.innerText ?? "";
          setComposeBody(editorText);
          updateComposeCounts(editorText);
          setSelectedImg(null);
          setImgRect(null);
        }
      },
      getAttachmentState: (draftId) => getComposeAttachmentState(draftId)
    }),
    [getComposeAttachmentState, selectedImg]
  );
  const composePhotoService: ComposePhotoService = useMemo(
    () => createComposePhotoService(composeAttachmentAdapter),
    [composeAttachmentAdapter]
  );
  const composeAttachmentService: ComposeAttachmentService = useMemo(
    () => createComposeAttachmentService(composeAttachmentAdapter, composePhotoService),
    [composeAttachmentAdapter, composePhotoService]
  );
  const composeState = useMemo<ComposeState>(
    () => ({
      plainText: composePlainText,
      subject: composeSubject,
      body: composeBody,
      attachmentCount: composeAttachments.length,
      toCount: composeRecipientState.to.length,
      ccCount: composeRecipientState.cc.length,
      bccCount: composeRecipientState.bcc.length
    }),
    [
      composeAttachments.length,
      composeBody,
      composePlainText,
      composeRecipientState,
      composeSubject,
    ]
  );
  const composeEditorAdapter = createExistingEditorAdapter({
    focus: () => {
      if (composePlainText) {
        composePlainTextRef.current?.focus();
        return;
      }

      composeEditorRef.current?.focus();
    },
    hasEditableTarget: () =>
      Boolean(composePlainText ? composePlainTextRef.current : composeEditorRef.current),
    isPlainText: () => composePlainText,
    exec: (command, value) => {
      if (composePlainText) {
        return false;
      }

      return execOnEditable(command, value, composeEditorRef.current);
    },
    transformCase: (mode) => {
      transformComposeSelectionCase(mode);
    },
    togglePlainText: () => setComposePlainText((current) => !current),
    openLinkDialog: openComposeLinkDialog,
    openAttachPicker: () => attachInputRef.current?.click(),
    openImagePicker: () => {
      if (imageInputRef.current) {
        imageInputRef.current.click();
        return;
      }

      attachInputRef.current?.click();
    },
    insertSignature: insertSignatureIntoCompose,
    insertText: insertTextIntoCompose,
    insertHtml: insertHtmlIntoCompose,
    getHtml: () =>
      composePlainText
        ? composeBody.replace(/\n/g, "<br/>").replace(/  /g, "&nbsp;")
        : composeEditorRef.current?.innerHTML ?? "",
    getText: () =>
      composePlainText ? composeBody : composeEditorRef.current?.innerText ?? composeBody,
    getSelection: () => composeSelectionState,
    saveDraft: () => persistComposeDraftNow(true),
    openPrintDialog: () => openPrintModal(),
    clearFormatting: () => {
      const removed = execOnEditable("removeFormat", undefined, composeEditorRef.current);
      execOnEditable("unlink", undefined, composeEditorRef.current);
      return removed;
    }
  });
  const composeCommandContext = useMemo(
    () =>
      buildComposerCommandContext({
        editor: composeEditorAdapter,
        accountId: composeSessionAccountId ?? undefined,
        selectionState: composeSelectionState,
        composeState,
        capabilityFlags: composeCapabilityFlags,
        attachments: {
          attachmentService: composeAttachmentService,
          photoService: composePhotoService
        },
        content: {
          activeSignatureLabel: composeActiveSignatureLabel,
          activeSignatureText: signature,
          presets: quickInsertPresets,
          insertSignature: insertSignatureIntoCompose,
          insertPresetById: insertComposePresetById
        }
      }),
    [
      composeActiveSignatureLabel,
      composeAttachmentService,
      composeCapabilityFlags,
      composeEditorAdapter,
      composePhotoService,
      composeSessionAccountId,
      composeSelectionState,
      composeState,
      insertSignatureIntoCompose,
      insertComposePresetById,
      quickInsertPresets,
      signature
    ]
  );
  const composerCommandMap = useMemo(
    () => new Map(COMPOSER_COMMANDS.map((command) => [command.id, command])),
    []
  );
  const hiddenToolbarCommandIds = useMemo(
    () => new Set(composeToolbarPreferences.hidden),
    [composeToolbarPreferences.hidden]
  );
  const composerToolbarCommands = useMemo(
    () =>
      composeToolbarPreferences.order
        .map((id) => composerCommandMap.get(id))
        .filter((command): command is ComposerCommand => Boolean(command))
        .filter((command) => !hiddenToolbarCommandIds.has(command.id))
        .filter((command) => (command.isVisible ? command.isVisible(composeCommandContext) : true)),
    [
      composeCommandContext,
      composeToolbarPreferences.order,
      composerCommandMap,
      hiddenToolbarCommandIds
    ]
  );
  const composerToolbarCustomizationCommands = useMemo(
    () =>
      composeToolbarPreferences.order
        .map((id) => composerCommandMap.get(id))
        .filter((command): command is ComposerCommand => Boolean(command)),
    [composeToolbarPreferences.order, composerCommandMap]
  );
  const compactToolbarCommandIds = useMemo(
    () => new Set(COMPACT_TOOLBAR_COMMAND_IDS),
    []
  );
  const primaryToolbarCommands = useMemo(() => {
    return composerToolbarCommands.filter((command) =>
      compactToolbarCommandIds.has(command.id)
    );
  }, [
    compactToolbarCommandIds,
    composerToolbarCommands
  ]);
  const secondaryToolbarCommands = useMemo(
    () =>
      composerToolbarCommands.filter(
        (command) =>
          !compactToolbarCommandIds.has(command.id) && command.id !== "insert_signature"
      ),
    [compactToolbarCommandIds, composerToolbarCommands]
  );
  const overflowToolbarCommands = useMemo(() => {
    if (composeToolbarPreferences.mode !== "compact") {
      return [];
    }

    return composerToolbarCommands.filter(
      (command) => !compactToolbarCommandIds.has(command.id)
    );
  }, [
    compactToolbarCommandIds,
    composeToolbarPreferences.mode,
    composerToolbarCommands
  ]);
  const selectionToolbarCommands = useMemo(
    () =>
      SELECTION_TOOLBAR_COMMAND_IDS.map((id) => composerCommandMap.get(id)).filter(
        (command): command is ComposerCommand => {
          if (!command) {
            return false;
          }

          return command.isVisible ? command.isVisible(composeCommandContext) : true;
        }
      ),
    [composeCommandContext, composerCommandMap]
  );
  const runComposerCommand = useCallback(
    async (command: ComposerCommand) => {
      const visible = command.isVisible ? command.isVisible(composeCommandContext) : true;
      const enabled = command.isEnabled ? command.isEnabled(composeCommandContext) : true;

      if (!visible || !enabled) {
        return;
      }

      restoreComposeEditorSelection();
      await command.run(composeCommandContext);
    },
    [composeCommandContext]
  );
  function renderComposeToolbarCommand(
    command: ComposerCommand,
    index: number,
    commands: ComposerCommand[]
  ) {
    const previousCommand = index > 0 ? commands[index - 1] : null;
    const shouldShowSeparator =
      previousCommand && previousCommand.group !== command.group;
    const isEnabled = command.isEnabled
      ? command.isEnabled(composeCommandContext)
      : true;
    const isActive = command.isActive
      ? command.isActive(composeCommandContext)
      : false;

    return (
      <Fragment key={command.id}>
        {shouldShowSeparator ? <div className="fmt-sep" /> : null}
        {command.control === "select" ? (
          <select
            className={`fmt-select ${
              command.id === "font_family" ? "fmt-font" : "fmt-size"
            }`}
            value={
              command.id === "font_family"
                ? composeFormatSelection.fontFamily
                : composeFormatSelection.fontSize
            }
            disabled={!isEnabled}
            title={command.label}
            onChange={(event) => {
              if (!command.runWithValue || !event.target.value) {
                return;
              }

              void command.runWithValue(composeCommandContext, event.target.value);
              setComposeFormatSelection((current) => ({
                ...current,
                [command.id === "font_family" ? "fontFamily" : "fontSize"]:
                  event.target.value
              }));
            }}
          >
            <option value="">
              {command.placeholder ?? command.label}
            </option>
            {command.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            className={`fmt-btn ${isActive ? "fmt-btn-active" : ""} ${
              command.id === "attach_file" || command.id === "insert_image"
                ? "fmt-attach"
                : ""
            } ${command.icon === "italic" ? "fmt-italic" : ""} ${
              command.icon === "underline" ? "fmt-underline" : ""
            } ${command.icon === "strikethrough" ? "fmt-strike" : ""}`}
            title={command.shortcut
              ? `${command.label} (${command.shortcut.replace("Meta", "⌘")})`
              : command.label}
            disabled={!isEnabled}
            onMouseDown={(event) => {
              event.preventDefault();
              void runComposerCommand(command);
            }}
          >
            {renderComposerCommandIcon(command)}
          </button>
        )}
      </Fragment>
    );
  }
  const handleComposerToolbarMove = useCallback(
    (commandId: ComposerCommandId, direction: "up" | "down") => {
      setComposeToolbarPreferences((current) =>
        moveToolbarCommand(current, commandId, direction)
      );
    },
    []
  );
  const handleComposerToolbarVisibilityToggle = useCallback((commandId: ComposerCommandId) => {
    setComposeToolbarPreferences((current) =>
      toggleToolbarCommandHidden(current, commandId)
    );
  }, []);
  const resetComposerToolbar = useCallback(() => {
    setComposeToolbarPreferences(resetComposerToolbarPreferences());
  }, []);
  const handleComposeToolbarModeChange = useCallback(
    (mode: "expanded" | "compact") => {
      setComposeToolbarPreferences((current) => ({ ...current, mode }));
    },
    []
  );
  function getComposeToolbarOverlayPosition(
    trigger?: HTMLElement | null,
    menuWidth = 240,
    menuEstimatedHeight = 320
  ) {
    if (typeof window === "undefined") {
      return null;
    }

    const anchor = trigger ?? composeToolbarTriggerRef.current;
    if (!anchor) {
      return null;
    }

    const rect = anchor.getBoundingClientRect();
    const viewportPadding = 12;
    const spaceAbove = rect.top - viewportPadding;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const openUpward =
      spaceAbove >= Math.min(menuEstimatedHeight, 200) || spaceAbove > spaceBelow;

    const top = openUpward
      ? Math.max(viewportPadding, rect.top - menuEstimatedHeight - 8)
      : Math.min(rect.bottom + 8, window.innerHeight - viewportPadding);
    const left = Math.min(
      Math.max(rect.right - menuWidth, viewportPadding),
      window.innerWidth - menuWidth - viewportPadding
    );

    return { top, left };
  }
  function updateComposeToolbarMenuPosition(trigger?: HTMLElement | null) {
    const nextPosition = getComposeToolbarOverlayPosition(trigger, 240, 420);
    if (!nextPosition) {
      return;
    }

    setComposeToolbarMenuPosition(nextPosition);
  }
  const composeDraftStatusLabel = useMemo(() => {
    if (!composeOpen || !composeDraftId) {
      return null;
    }

    if (composeDraftStatus === "saving") {
      return "Saving draft…";
    }

    if (composeDraftStatus === "failed") {
      return composeDraftError ? `Save failed: ${composeDraftError}` : "Save failed";
    }

    if (composeDraftStatus === "saved" && composeDraftSavedAt) {
      return `Saved ${formatTimestamp(composeDraftSavedAt)}`;
    }

    if (composeDraftStatus === "unsaved") {
      return "Unsaved changes";
    }

    return "Draft ready";
  }, [
    composeDraftError,
    composeDraftId,
    composeDraftSavedAt,
    composeDraftStatus,
    composeOpen
  ]);
  const composeHelperHints = useMemo(() => {
    const hints: Array<
      | { id: "subject"; label: string; actionLabel: string; onAction: () => void }
      | { id: "attachment"; label: string; actionLabel: string; onAction: () => void }
    > = [];
    const combinedText = `${composeSubject}\n${composeBody}`;

    if (composeSubject.trim().length === 0) {
      hints.push({
        id: "subject",
        label: "Subject line is still blank",
        actionLabel: "Add subject",
        onAction: () => {
          composeSubjectInputRef.current?.focus();
        }
      });
    }

    if (messageMentionsAttachment(combinedText) && composeAttachments.length === 0) {
      hints.push({
        id: "attachment",
        label: "You mentioned an attachment",
        actionLabel: "Attach file",
        onAction: () => {
          const command = composerCommandMap.get("attach_file");
          if (command) {
            void runComposerCommand(command);
          }
        }
      });
    }

    return hints;
  }, [
    composeAttachments.length,
    composeBody,
    composeSubject,
    composerCommandMap,
    runComposerCommand
  ]);
  const composeToolbarCustomizationEnabled = false;
  const handleComposeShortcutKeyDown = useCallback(
    async (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === "Escape") {
        if (composeQuickInsertOpen || composeToolbarOverflowOpen || composeToolbarMenuOpen) {
          setComposeQuickInsertOpen(false);
          setComposeQuickInsertPosition(null);
          setComposeToolbarOverflowOpen(false);
          setComposeToolbarOverflowPosition(null);
          setComposeToolbarMenuOpen(false);
          setComposeToolbarMenuPosition(null);
          return;
        }
      }

      if (event.key === "Escape" && selectedImg) {
        setSelectedImg(null);
        setImgRect(null);
        return;
      }

      for (const command of COMPOSER_COMMANDS) {
        if (!command.shortcut || !matchesComposerShortcut(command.shortcut, event)) {
          continue;
        }

        const visible = command.isVisible ? command.isVisible(composeCommandContext) : true;
        const enabled = command.isEnabled ? command.isEnabled(composeCommandContext) : true;

        if (!visible || !enabled) {
          return;
        }

        event.preventDefault();
        await command.run(composeCommandContext);
        return;
      }
    },
    [
      composeCommandContext,
      composeQuickInsertOpen,
      composeToolbarMenuOpen,
      composeToolbarOverflowOpen,
      selectedImg
    ]
  );
  const isSentFolder = useMemo(() => {
    if (!currentFolderPath) {
      return false;
    }

    const currentFolder = folders.find((folder) => folder.path === currentFolderPath);
    if (
      currentFolder?.specialUse === "\\Sent" ||
      currentFolder?.specialUse === "\\\\Sent"
    ) {
      return true;
    }

    const pathLower = currentFolderPath.toLowerCase();
    const nameLower = (currentFolder?.name ?? "").toLowerCase().trim();
    const sentVariants = ["sent", "sent items", "sent mail", "sent messages"];

    return (
      sentVariants.includes(nameLower) ||
      sentVariants.includes(pathLower) ||
      pathLower.endsWith("/sent") ||
      pathLower.includes("sent messages") ||
      pathLower.includes("sent items") ||
      pathLower.includes("sent mail")
    );
  }, [currentFolderPath, folders]);
  const mailboxQuery = useMemo(
    () =>
      createMailboxQueryState({
        mailbox: activeMailboxNode,
        activeAccountId,
        searchText: deferredQuery,
        senderFilter,
        subjectFilter,
        subjectPattern,
        sortBy,
        supportsServerSideSearch:
          activeAccount?.provider.capabilities.supportsServerSideSearch
      }),
    [
      activeAccountId,
      activeAccount?.provider.capabilities.supportsServerSideSearch,
      activeMailboxNode,
      currentFolderPath,
      deferredQuery,
      senderFilter,
      sortBy,
      subjectFilter,
      subjectPattern
    ]
  );
  const queriedMessages = useMemo(
    () =>
      filterMessagesForMailboxQuery(messages, mailboxQuery, {
        blockedSenders,
        focusFilterValue: (message) => getFocusFilterValue(message, isSentFolder)
      }),
    [blockedSenders, isSentFolder, mailboxQuery, messages]
  );
  const queriedSortedMessages = [...queriedMessages].sort((left, right) =>
    compareMessages(left, right, sortBy)
  );
  const conversations = useMemo(
    () => buildConversationCollection(queriedSortedMessages, sortBy),
    [queriedSortedMessages, sortBy]
  );
  const visibleMessages = useMemo(
    () => filterMessagesForInboxAttentionView(queriedSortedMessages, activeInboxAttentionView),
    [activeInboxAttentionView, queriedSortedMessages]
  );
  const visibleConversationSummaries = useMemo(
    () => filterConversationSummariesForInboxAttentionView(conversations, activeInboxAttentionView),
    [activeInboxAttentionView, conversations]
  );
  const prioritizedSenderMatchesActiveFilter = useMemo(
    () =>
      Boolean(
        senderFilter &&
          senderFilterScope === "prioritized" &&
          prioritizedSenders.some((sender) => sender.name === senderFilter)
      ),
    [prioritizedSenders, senderFilter, senderFilterScope]
  );
  const prioritizedSenderUsesCombinedInboxView = Boolean(
    activeInboxAttentionView && prioritizedSenderMatchesActiveFilter
  );
  const sortedMessages = prioritizedSenderUsesCombinedInboxView
    ? queriedSortedMessages
    : visibleMessages;
  const renderedConversationSummaries = prioritizedSenderUsesCombinedInboxView
    ? conversations.summaries
    : visibleConversationSummaries;
  const effectiveEmptyAttentionView = prioritizedSenderUsesCombinedInboxView
    ? null
    : activeInboxAttentionView;
  const isPrioritizedSenderView = prioritizedSenderMatchesActiveFilter;
  const sortedUnreadCount = sortedMessages.filter((message) => !message.seen).length;
  function clearNewMailExitAnimationTargets(input: {
    messageUids?: number[];
    conversationIds?: string[];
  }) {
    if (input.messageUids && input.messageUids.length > 0) {
      setNewMailExitingMessageUids((current) => {
        const next = new Set(current);
        for (const uid of input.messageUids ?? []) {
          next.delete(uid);
        }
        return next.size === current.size ? current : next;
      });
    }

    if (input.conversationIds && input.conversationIds.length > 0) {
      setNewMailExitingConversationIds((current) => {
        const next = new Set(current);
        for (const id of input.conversationIds ?? []) {
          next.delete(id);
        }
        return next.size === current.size ? current : next;
      });
    }
  }

  function resolveNewMailExitAnimationTargets(request: MailActionRequest) {
    if (!isScopedNewMailReadDelayActive) {
      return { messageUids: [] as number[], conversationIds: [] as string[] };
    }

    const isSortMove =
      request.kind === "move" &&
      Boolean(getSortFolderPresetByMailbox(request.destinationFolder, request.destinationFolder));
    const supportsExitAnimation = request.kind === "mark_read" || isSortMove;

    if (!supportsExitAnimation) {
      return { messageUids: [] as number[], conversationIds: [] as string[] };
    }

    const targetedUids = new Set(request.target.messageUids);

    if (!threadingEnabled) {
      return {
        messageUids: sortedMessages
          .filter((message) => targetedUids.has(message.uid))
          .map((message) => message.uid),
        conversationIds: []
      };
    }

    const visibleConversationIds = new Set(renderedConversationSummaries.map((summary) => summary.id));
    const conversationIds = new Set<string>();

    for (const uid of request.target.messageUids) {
      const conversationId = conversations.byMessageUid.get(uid);
      if (!conversationId || !visibleConversationIds.has(conversationId)) {
        continue;
      }

      const entity = conversations.byId.get(conversationId);
      if (!entity) {
        continue;
      }

      const hasUnreadAfterAction = entity.messages.some((message) => {
        if (!targetedUids.has(message.uid)) {
          return !message.raw.seen;
        }

        return false;
      });

      if (!hasUnreadAfterAction) {
        conversationIds.add(conversationId);
      }
    }

    return {
      messageUids: [],
      conversationIds: Array.from(conversationIds)
    };
  }

  async function animateNewMailExitIfNeeded(request: MailActionRequest) {
    if (typeof window !== "undefined") {
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (reduceMotion) {
        return { messageUids: [] as number[], conversationIds: [] as string[] };
      }
    }

    const targets = resolveNewMailExitAnimationTargets(request);
    if (targets.messageUids.length === 0 && targets.conversationIds.length === 0) {
      return targets;
    }

    if (targets.messageUids.length > 0) {
      setNewMailExitingMessageUids((current) => {
        const next = new Set(current);
        for (const uid of targets.messageUids) {
          next.add(uid);
        }
        return next;
      });
    }

    if (targets.conversationIds.length > 0) {
      setNewMailExitingConversationIds((current) => {
        const next = new Set(current);
        for (const id of targets.conversationIds) {
          next.add(id);
        }
        return next;
      });
    }

    await new Promise((resolve) => globalThis.setTimeout(resolve, NEW_MAIL_EXIT_ANIMATION_MS));
    return targets;
  }

  function getReadToggleActionCopy(
    isSeen: boolean,
    options?: {
      scope?: "message" | "conversation";
      concise?: boolean;
    }
  ) {
    if (!isSeen) {
      return {
        label: "Read",
        title:
          options?.scope === "conversation"
            ? "Mark conversation as read"
            : "Mark as Read",
        contextLabel:
          options?.scope === "conversation"
            ? "Mark conversation as Read"
            : "Mark as Read"
      };
    }

    if (isReadMailAttentionView) {
      return {
        label: options?.concise ? "Unread" : "Return to New Mail",
        title:
          options?.scope === "conversation"
            ? "Mark conversation as unread and return it to New Mail"
            : "Mark as unread and return to New Mail",
        contextLabel:
          options?.scope === "conversation"
            ? "Mark conversation as Unread (Return to New Mail)"
            : "Mark as Unread (Return to New Mail)"
      };
    }

    return {
      label: "Unread",
      title:
        options?.scope === "conversation"
          ? "Mark conversation as unread"
          : "Mark as Unread",
      contextLabel:
        options?.scope === "conversation"
          ? "Mark conversation as Unread"
          : "Mark as Unread"
    };
  }
  const inboxAttentionConversations = useMemo(
    () => buildConversationCollection(messages, sortBy),
    [messages, sortBy]
  );
  const activeInboxAttentionCounts = useMemo(
    () => buildInboxAttentionCounts(messages, threadingEnabled, inboxAttentionConversations),
    [inboxAttentionConversations, messages, threadingEnabled]
  );
  const mailboxResultState = useMemo(
    () =>
      getMailboxResultState({
        isBusy,
        visibleCount: threadingEnabled
          ? renderedConversationSummaries.length
          : sortedMessages.length
      }),
    [isBusy, renderedConversationSummaries.length, sortedMessages.length, threadingEnabled]
  );
  useEffect(() => {
    if (
      !activeAccountId ||
      !activeAccount?.provider.capabilities.supportsServerSideSearch
    ) {
      return;
    }

    if (!mailboxQuery.usesServerSideSearch && mailboxQuery.normalizedSearchText) {
      return;
    }

    void loadMessages(currentFolderPath, {
      manageBusy: false,
      preserveSelection: true
    });
  }, [
    activeAccount?.provider.capabilities.supportsServerSideSearch,
    activeAccountId,
    currentFolderPath,
    mailboxQuery.normalizedSearchText,
    mailboxQuery.usesServerSideSearch
  ]);
  const toggleSelectUid = useCallback((uid: number) => {
    setSelectedUids((previous) => {
      const next = new Set(previous);
      if (next.has(uid)) {
        next.delete(uid);
      } else {
        next.add(uid);
      }
      return next;
    });
  }, []);
  const selectableVisibleMessageUids = useMemo(
    () =>
      threadingEnabled
        ? renderedConversationSummaries.map((summary) => summary.latestMessage.uid)
        : sortedMessages.map((message) => message.uid),
    [renderedConversationSummaries, sortedMessages, threadingEnabled]
  );
  const selectAll = useCallback(() => {
    setSelectedUids(new Set(selectableVisibleMessageUids));
  }, [selectableVisibleMessageUids]);
  const clearSelection = useCallback(() => {
    setSelectedUids(new Set());
    setSelectMode(false);
    setBulkSelectionMenu(null);
    setBulkMoveActive(false);
    setMoveConversationTargetId(null);
  }, []);
  const senderStats = senderFilter
    ? (() => {
        const oldestMessage = sortedMessages.reduce<MailSummary | null>(
          (oldest, message) => {
            if (!oldest) {
              return message;
            }

            return new Date(message.date).getTime() < new Date(oldest.date).getTime()
              ? message
              : oldest;
          },
          null
        );

        const referenceMessage = sortedMessages[0] ?? null;

        if (!referenceMessage || !oldestMessage) {
          return null;
        }

        return {
          name: getFocusIdentityLabel(referenceMessage, isSentFolder),
          email: isSentFolder
            ? getPrimaryRecipientValue(referenceMessage)
            : referenceMessage.fromAddress,
          total: sortedMessages.length,
          unread: sortedUnreadCount,
          oldestDate: oldestMessage.date
        };
      })()
    : null;
  const pivotMessage =
    selectedMessage ?? messages.find((message) => message.uid === selectedUid) ?? null;
  const selectedMessages = useMemo(
    () => sortedMessages.filter((message) => selectedUids.has(message.uid)),
    [selectedUids, sortedMessages]
  );
  const allVisibleSelected =
    selectableVisibleMessageUids.length > 0 &&
    selectableVisibleMessageUids.every((uid) => selectedUids.has(uid));
  const dragFirstMessageList = responsiveInteractionMode === "desktop-workspace";
  const swipeFirstMessageList = responsiveInteractionMode === "mobile-stacked";
  const showSidebarPane = !isMobileStackedMode || mobileStackedScreen === "mailboxes";
  const showInboxPane = !isMobileStackedMode || mobileStackedScreen === "messages";
  const showViewerPane = !isMobileStackedMode || mobileStackedScreen === "viewer";
  const orderedFolders = useMemo(() => {
    if (folderOrder.length === 0) {
      return orderFoldersByDefault(folders);
    }

    const ranked = new Map(folderOrder.map((path, index) => [path, index]));

    return [...folders].sort((left, right) => {
      const leftRank = ranked.get(left.path);
      const rightRank = ranked.get(right.path);

      if (leftRank !== undefined && rightRank !== undefined) {
        return leftRank - rightRank;
      }

      if (leftRank !== undefined) {
        return -1;
      }

      if (rightRank !== undefined) {
        return 1;
      }

      return left.name.localeCompare(right.name);
    });
  }, [folders, folderOrder]);
  const clearSidebarMailDrag = useCallback(() => {
    setSidebarMailDragState(null);
    setSidebarMailDragHoverTargetId(null);
  }, []);
  const beginSidebarMailDrag = useCallback(
    (
      event: ReactDragEvent<HTMLDivElement>,
      payload: SidebarMailDragState,
      previewLabel: string
    ) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", previewLabel);
      setSidebarMailDragState(payload);
      setSidebarMailDragHoverTargetId(null);
    },
    []
  );
  const buildMessageRowDragState = useCallback(
    (message: MailSummary) => {
      if (!activeAccountId || message.accountId !== activeAccountId) {
        return null;
      }

      if (selectedUids.has(message.uid) && selectedMessages.length > 1) {
        return {
          accountId: activeAccountId,
          sourceFolderPath: currentFolderPath,
          target: {
            scope: "message" as const,
            messageUids: selectedMessages.map((selectedMessage) => selectedMessage.uid)
          },
          messageCount: selectedMessages.length,
          clearSelectionOnSuccess: true
        };
      }

      return {
        accountId: activeAccountId,
        sourceFolderPath: currentFolderPath,
        target: createMessageActionTarget(message.uid),
        messageCount: 1,
        clearSelectionOnSuccess: false
      };
    },
    [activeAccountId, currentFolderPath, selectedMessages, selectedUids]
  );
  const buildConversationRowDragState = useCallback(
    (conversationId: string, latestMessageUid: number) => {
      if (!activeAccountId) {
        return null;
      }

      if (selectedUids.has(latestMessageUid) && selectedUids.size > 1) {
        const selectedConversationSummaries = renderedConversationSummaries.filter((summary) =>
          selectedUids.has(summary.latestMessage.uid)
        );

        if (selectedConversationSummaries.length === selectedUids.size) {
          const selectedConversationMessageUids = Array.from(
            new Set(
              selectedConversationSummaries.flatMap(
                (summary) =>
                  conversations.byId.get(summary.id)?.messages.map((message) => message.uid) ?? []
              )
            )
          );

          if (selectedConversationMessageUids.length > 0) {
            return {
              accountId: activeAccountId,
              sourceFolderPath: currentFolderPath,
              target: {
                scope: "message" as const,
                messageUids: selectedConversationMessageUids
              },
              messageCount: selectedConversationMessageUids.length,
              clearSelectionOnSuccess: true
            };
          }
        }
      }

      const target = createConversationActionTarget(conversationId);
      if (!target) {
        return null;
      }

      return {
        accountId: activeAccountId,
        sourceFolderPath: currentFolderPath,
        target,
        messageCount: target.messageUids.length,
        clearSelectionOnSuccess: false
      };
    },
    [
      activeAccountId,
      conversations.byId,
      currentFolderPath,
      renderedConversationSummaries,
      selectedUids
    ]
  );
  const isValidSidebarMailDropTarget = useCallback(
    (accountId: string, mailboxTarget: SidebarMailboxTarget) => {
      if (!sidebarMailDragState || mailboxTarget.isVirtual) {
        return false;
      }

      return (
        sidebarMailDragState.accountId === accountId &&
        mailboxTarget.mailboxNode.identity.providerPath !== sidebarMailDragState.sourceFolderPath
      );
    },
    [sidebarMailDragState]
  );
  const handleSidebarMailDrop = useCallback(
    async (accountId: string, mailboxTarget: SidebarMailboxTarget) => {
      const dragState = sidebarMailDragState;
      clearSidebarMailDrag();

      if (
        !dragState ||
        dragState.accountId !== accountId ||
        mailboxTarget.isVirtual ||
        mailboxTarget.mailboxNode.identity.providerPath === dragState.sourceFolderPath
      ) {
        return;
      }

      await dispatchMailAction(
        {
          kind: "move",
          accountId: dragState.accountId,
          folderPath: dragState.sourceFolderPath,
          target: dragState.target,
          destinationFolder: mailboxTarget.mailboxNode.identity.providerPath
        },
        {
          clearSelectionOnSuccess: dragState.clearSelectionOnSuccess,
          toastMessage: `Moved ${
            dragState.target.scope === "conversation"
              ? "conversation"
              : dragState.messageCount === 1
                ? "message"
                : `${dragState.messageCount} messages`
          } to ${mailboxTarget.name}`
        }
      );
    },
    [clearSidebarMailDrag, dispatchMailAction, sidebarMailDragState]
  );

  useEffect(() => {
    if (!dragFirstMessageList) {
      clearSidebarMailDrag();
    }
  }, [clearSidebarMailDrag, dragFirstMessageList]);
  const sidebarMailboxGroups = useMemo(
    () =>
      accounts.map((account) => {
        const isActive = account.id === activeAccountId;
        const accountFolders = isActive
          ? orderedFolders
          : orderFoldersByDefault(foldersByAccount[account.id] ?? []);
        const mailboxNodes = resolveMailboxNodes(accountFolders, {
          accountId: account.id,
          providerKind: account.provider.kind,
          providerCapabilities: account.provider.capabilities
        });
        const inboxCountsByPath =
          isActive && activeMailboxNode && isInboxMailboxNode(activeMailboxNode)
            ? {
                [activeMailboxNode.identity.providerPath]: activeInboxAttentionCounts
              }
            : undefined;

        return {
          account,
          isActive,
          mailboxTargets: buildSidebarMailboxTargets(mailboxNodes, {
            mailboxViewMode,
            inboxCountsByPath
          })
        };
      }),
    [
      accounts,
      activeAccountId,
      activeInboxAttentionCounts,
      activeMailboxNode,
      foldersByAccount,
      mailboxViewMode,
      orderedFolders
    ]
  );
  const sortFolderSettingsGroups = useMemo(
    () =>
      accounts.map((account) => {
        const accountFolders =
          account.id === activeAccountId
            ? orderedFolders
            : orderFoldersByDefault(foldersByAccount[account.id] ?? []);

        return {
          account,
          presets: SORT_FOLDER_PRESETS.map((preset) => ({
            preset,
            exists: accountFolders.some(
              (folder) => getSortFolderPresetByMailbox(folder.name, folder.path)?.key === preset.key
            )
          }))
        };
      }),
    [accounts, activeAccountId, foldersByAccount, orderedFolders]
  );

  useEffect(() => {
    if (folders.length === 0) {
      return;
    }

    if (folderOrder.length === 0) {
      return;
    }

    const folderPaths = folders.map((folder) => folder.path);

    setFolderOrder((current) => {
      const retained = current.filter((path) => folderPaths.includes(path));
      const additions = folderPaths.filter((path) => !retained.includes(path));
      const next = [...retained, ...additions];

      if (
        next.length === current.length &&
        next.every((path, index) => path === current[index])
      ) {
        return current;
      }

      window.sessionStorage.setItem("mmwbmail-folder-order", JSON.stringify(next));
      window.sessionStorage.setItem("mmwbmail-folder-order-custom", "1");
      return next;
    });
  }, [folderOrder.length, folders]);

  useEffect(() => {
    setSelectMode(selectedUids.size > 0);
  }, [selectedUids]);

  useEffect(() => {
    if (selectedUids.size === 0) {
      setBulkSelectionMenu(null);
    }
  }, [selectedUids]);

  useEffect(() => {
    if (!senderFilter && senderFilterScope !== null) {
      setSenderFilterScope(null);
    }
  }, [senderFilter, senderFilterScope]);

  useEffect(() => {
    const previousQuery = previousMailboxQueryRef.current;
    if (shouldResetSelectionForMailboxQueryChange(previousQuery, mailboxQuery)) {
      openMessageSeqRef.current += 1;
      setSelectedMessage(null);
      setSelectedUid(null);
    }

    previousMailboxQueryRef.current = mailboxQuery;
  }, [mailboxQuery]);

  useEffect(() => {
    clearSelection();
  }, [clearSelection, mailboxQuery.scopeKey]);

  useEffect(() => {
    clearSelection();
  }, [activeInboxAttentionView, clearSelection, mailboxViewMode]);

  useEffect(() => {
    const previous = newMailReadDelayRef.current;
    const nextContext =
      isScopedNewMailReadDelayActive &&
      selectedMessage &&
      activeAccountId &&
      !selectedMessage.seen
        ? {
            uid: selectedMessage.uid,
            accountId: activeAccountId,
            folderPath: currentFolderPath
          }
        : null;

    const isSameTrackedMessage =
      previous &&
      nextContext &&
      previous.uid === nextContext.uid &&
      previous.accountId === nextContext.accountId &&
      previous.folderPath === nextContext.folderPath;

    if (
      previous &&
      !isSameTrackedMessage &&
      Date.now() - previous.startedAt >= NEW_MAIL_AUTO_READ_DWELL_MS
    ) {
      void markMessageSeenForContext(previous);
    }

    if (nextContext) {
      newMailReadDelayRef.current = isSameTrackedMessage
        ? previous
        : {
            ...nextContext,
            startedAt: Date.now()
          };
      return;
    }

    newMailReadDelayRef.current = null;
  }, [
    activeAccountId,
    currentFolderPath,
    isScopedNewMailReadDelayActive,
    markMessageSeenForContext,
    selectedMessage
  ]);

  useEffect(() => {
    const nextSelection = reconcileVisibleSelection(sortedMessages, {
      selectedUid,
      selectedMessageUid: selectedMessage?.uid ?? null,
      selectedMessageAccountId: selectedMessage?.accountId ?? null,
      preserveSelection: true,
      scopeAccountId: activeAccountId
    });

    if (nextSelection.selectedUid !== selectedUid) {
      setSelectedUid(nextSelection.selectedUid);
    }

    if (nextSelection.clearSelectedMessage) {
      openMessageSeqRef.current += 1;
      setSelectedMessage(null);
    }
  }, [activeAccountId, selectedMessage?.accountId, selectedMessage?.uid, selectedUid, sortedMessages]);

  useEffect(() => {
    const visibleUids = new Set(sortedMessages.map((message) => message.uid));
    setSelectedUids((current) => {
      const next = new Set(
        Array.from(current).filter((uid) => visibleUids.has(uid))
      );
      return next.size === current.size ? current : next;
    });
  }, [sortedMessages]);

  const menuWidth = 220;
  const menuHeight = 280;
  const clampedX =
    typeof window === "undefined" || !contextMenu
      ? 0
      : Math.min(contextMenu.x, window.innerWidth - menuWidth - 8);
  const clampedY =
    typeof window === "undefined" || !contextMenu
      ? 0
      : Math.min(contextMenu.y, window.innerHeight - menuHeight - 8);
  const currentFolderLabel = orderedFolders.find(
    (folder) => folder.path === currentFolderPath
  )?.name ?? activeMailboxNode?.name ?? displayFolderName(currentFolderPath || "Inbox");
  const currentMailboxLabel =
    activeInboxAttentionView === "new-mail"
      ? "New Mail"
      : activeInboxAttentionView === "read"
        ? "Read Mail"
        : currentFolderLabel;
  const activeSortFolderPresentation = getSortFolderPresentation(
    currentFolderLabel,
    currentFolderPath
  );
  const prioritizedSenderEmptyStateName = prioritizedSenderMatchesActiveFilter
    ? senderFilter
    : null;
  const mobileMailboxContextHint = isMobileStackedMode
    ? activeInboxAttentionView === "new-mail"
      ? "Unread inbox attention stays here until you work through it."
      : activeInboxAttentionView === "read"
        ? "Read inbox mail you have already worked through appears here."
        : activeSortFolderPresentation
          ? `${activeSortFolderPresentation.label} is a Quick Sort folder for ${activeSortFolderPresentation.description.toLowerCase()}`
          : null
    : null;
  const searchPlaceholder = activeSortFolderPresentation
    ? `Search in ${activeSortFolderPresentation.label}`
    : "Search sender, subject, or preview";
  const scopedMailboxEmptyState =
    getSpecializedMailboxEmptyState({
      mode: mailboxQuery.mode,
      attentionView: effectiveEmptyAttentionView,
      sortPreset: activeSortFolderPresentation,
      prioritizedSenderName: prioritizedSenderEmptyStateName
    }) ?? {
      title: mailboxQuery.mode === "search" ? "No messages match" : "Nothing here yet",
      message: getMailboxEmptyMessage(mailboxQuery)
    };
  const activeConversation = useMemo(() => {
    if (!threadingEnabled) {
      return null;
    }

    const activeUid = selectedMessage?.uid ?? selectedUid;
    if (!activeUid) {
      return null;
    }

    const conversationId = conversations.byMessageUid.get(activeUid);
    if (!conversationId) {
      return null;
    }

    return conversations.byId.get(conversationId) ?? null;
  }, [conversations.byId, conversations.byMessageUid, selectedMessage?.uid, selectedUid, threadingEnabled]);
  const activeConversationMessages = useMemo(
    () => activeConversation?.messages.map((message) => message.raw) ?? [],
    [activeConversation]
  );
  const activeConversationMessageUidSignature = useMemo(
    () => activeConversationMessages.map((message) => message.uid).join(","),
    [activeConversationMessages]
  );
  const conversationSelection = useMemo<ConversationSelectionState>(
    () => ({
      selectedConversationId: activeConversation?.id ?? null,
      selectedMessageUid: selectedMessage?.uid ?? selectedUid ?? null
    }),
    [activeConversation?.id, selectedMessage?.uid, selectedUid]
  );
  const conversationViewState = useMemo<ConversationViewState>(
    () => ({
      expandedConversationIds,
      expandedMessageUids: expandedConversationMessageUids
    }),
    [expandedConversationIds, expandedConversationMessageUids]
  );
  const showConversationView =
    threadingEnabled &&
    Boolean(activeConversation) &&
    activeConversationMessages.length > 1;
  const printThreadAvailable = showConversationView && activeConversationMessages.length > 1;
  const effectivePrintTargetUid = printTargetUid ?? selectedMessage?.uid ?? null;
  const selectedSpoof = selectedMessage ? detectSpoof(selectedMessage) : null;
  const selectedSenderIsVerified = Boolean(
    selectedMessage && !selectedSpoof?.isSpoofed && domainVerification?.bimiVerified
  );
  const currentLightboxImage = lightboxImages[lightboxIndex] ?? null;
  const cropScaleX =
    cropCanvasSize.width > 0 ? cropNaturalSize.width / cropCanvasSize.width : 1;
  const cropScaleY =
    cropCanvasSize.height > 0 ? cropNaturalSize.height / cropCanvasSize.height : 1;
  const cropNaturalWidth = cropRect ? Math.max(1, Math.round(cropRect.w * cropScaleX)) : 0;
  const cropNaturalHeight = cropRect ? Math.max(1, Math.round(cropRect.h * cropScaleY)) : 0;
  const isAppleMobile =
    typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const canNativeShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function";

  useEffect(() => {
    if (!threadingEnabled || !activeConversation || activeConversation.messageCount < 2) {
      return;
    }

    void Promise.all(
      activeConversation.messages.map((message) => {
        if (
          message.uid === selectedMessage?.uid ||
          cleanupPreviewCache[message.uid]
        ) {
          return Promise.resolve();
        }

        return loadCleanupPreview(message.uid).then(() => undefined).catch(() => undefined);
      })
    );
  }, [
    activeConversation?.id,
    activeConversationMessageUidSignature,
    cleanupPreviewCache,
    selectedMessage?.uid,
    threadingEnabled
  ]);

  useEffect(() => {
    if (!activeConversation) {
      setExpandedConversationMessageUids(new Set());
      return;
    }

    setExpandedConversationMessageUids((current) => {
      const validUids = new Set(activeConversation.messages.map((message) => message.uid));
      const next = new Set(Array.from(current).filter((uid) => validUids.has(uid)));

      if (next.size === 0) {
        return validUids;
      }

      if (
        next.size === current.size &&
        Array.from(next).every((uid) => current.has(uid))
      ) {
        return current;
      }

      return next;
    });
  }, [activeConversation?.id, activeConversationMessageUidSignature]);

  useEffect(() => {
    const selectedConversationMessageUid = conversationSelection.selectedMessageUid;
    if (selectedConversationMessageUid === null) {
      return;
    }

    setExpandedConversationMessageUids((current) => {
      if (current.has(selectedConversationMessageUid)) {
        return current;
      }

      const next = new Set(current);
      next.add(selectedConversationMessageUid);
      return next;
    });
  }, [conversationSelection.selectedMessageUid]);

  function renderPrintEmailHeader(
    message: Pick<MailSummary, "from" | "fromAddress" | "subject" | "date">,
    detail?: Pick<MailDetail, "to"> | null
  ) {
    const recipients = detail?.to?.length ? detail.to.join(", ") : "me";

    return (
      <div className="print-email-header">
        <div className="print-email-field">
          <span className="print-email-label">From:</span>{" "}
          {formatPrintSender(message.from, message.fromAddress)}
        </div>
        <div className="print-email-field">
          <span className="print-email-label">To:</span> {recipients}
        </div>
        <div className="print-email-field">
          <span className="print-email-label">Date:</span> {message.date}
        </div>
        <div className="print-email-field">
          <span className="print-email-label">Subject:</span> {message.subject}
        </div>
      </div>
    );
  }

  function resetLightboxView() {
    setLightboxZoom(1);
    setLightboxRotation(0);
    setLightboxOffset({ x: 0, y: 0 });
  }

  function getLightboxImageLabel(image: LightboxImage | null) {
    if (!image) {
      return "";
    }

    if (image.alt.trim()) {
      return image.alt.trim();
    }

    try {
      const url = new URL(image.src);
      const filename = url.pathname.split("/").filter(Boolean).pop();
      return filename ? decodeURIComponent(filename) : "Email image";
    } catch {
      return "Email image";
    }
  }

  function closeLightbox() {
    setLightboxOpen(false);
    setLightboxImages([]);
    setLightboxIndex(0);
    setLightboxDragging(false);
    lightboxPointersRef.current.clear();
    lightboxPanRef.current = null;
    lightboxPinchRef.current = null;
    resetLightboxView();
  }

  function renderSenderAvatar(message: Pick<MailSummary, "uid" | "from" | "fromAddress">) {
    const useBimiAvatar =
      selectedSenderIsVerified &&
      selectedMessage?.uid === message.uid &&
      Boolean(domainVerification?.bimiLogoUrl) &&
      !bimiAvatarFailed;

    return (
      <div className="email-sender-avatar-wrap">
        {useBimiAvatar ? (
          <img
            className="bimi-avatar"
            src={domainVerification?.bimiLogoUrl ?? ""}
            alt={`${displaySender(message.from)} logo`}
            onError={() => setBimiAvatarFailed(true)}
          />
        ) : (
          <div
            className="email-sender-avatar"
            style={{ background: getAvatarColor(message.fromAddress) }}
          >
            {getSenderInitials(message.from)}
          </div>
        )}
        {selectedSenderIsVerified && selectedMessage?.uid === message.uid ? (
          <span className="bimi-avatar-badge">✓</span>
        ) : null}
      </div>
    );
  }

  function renderSenderTrustSummary(
    message: TrustAwareMessage & Pick<MailSummary, "uid">,
    options?: { className?: string; hidden?: boolean }
  ) {
    if (options?.hidden) {
      return null;
    }

    const trust = resolveSenderTrustPresentation(message, domainVerification);
    const expanded = senderTrustExpandedUid === message.uid;
    const showCollapsedSummary = trust.tier === "red" || trust.tier === "amber";

    return (
      <div
        className={[
          "sender-trust-summary",
          `sender-trust-summary-${trust.tier}`,
          showCollapsedSummary ? "" : "sender-trust-summary-compact",
          options?.className ?? ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <button
          type="button"
          className="sender-trust-toggle"
          onClick={() =>
            setSenderTrustExpandedUid((current) => (current === message.uid ? null : message.uid))
          }
          aria-expanded={expanded}
        >
          <span className="sender-trust-icon" aria-hidden="true">
            {trust.icon}
          </span>
          <span className="sender-trust-label">{trust.label}</span>
          {showCollapsedSummary ? (
            <span className="sender-trust-summary-copy">{trust.summary}</span>
          ) : null}
          <span className={`sender-trust-chevron ${expanded ? "open" : ""}`}>›</span>
        </button>
        {expanded ? (
          <div className="sender-trust-detail">
            <p className="sender-trust-detail-copy">{trust.detail}</p>
            {trust.signals.length > 0 ? (
              <div className="sender-trust-signals">
                {trust.signals.map((signal) => (
                  <span key={signal} className="sender-trust-signal">
                    {signal}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const clampLightboxOffset = useCallback(
    (offset: { x: number; y: number }, zoom: number, rotation: number) => {
      const area = lightboxAreaRef.current;
      const image = lightboxImageRef.current;

      if (!area || !image || zoom <= 1) {
        return { x: 0, y: 0 };
      }

      const baseWidth = image.clientWidth || image.naturalWidth || area.clientWidth;
      const baseHeight = image.clientHeight || image.naturalHeight || area.clientHeight;
      const rotated = rotation % 180 !== 0;
      const visualWidth = (rotated ? baseHeight : baseWidth) * zoom;
      const visualHeight = (rotated ? baseWidth : baseHeight) * zoom;
      const maxX = Math.max(0, (visualWidth - area.clientWidth) / (2 * zoom));
      const maxY = Math.max(0, (visualHeight - area.clientHeight) / (2 * zoom));

      return {
        x: Math.max(-maxX, Math.min(maxX, offset.x)),
        y: Math.max(-maxY, Math.min(maxY, offset.y))
      };
    },
    []
  );

  const applyLightboxZoom = useCallback(
    (nextZoom: number, clientX?: number, clientY?: number) => {
      const clampedZoom = Math.min(4, Math.max(0.5, nextZoom));

      if (clampedZoom <= 1) {
        setLightboxZoom(1);
        setLightboxOffset({ x: 0, y: 0 });
        return;
      }

      if (
        clientX == null ||
        clientY == null ||
        !lightboxAreaRef.current ||
        !lightboxImageRef.current
      ) {
        setLightboxZoom(clampedZoom);
        setLightboxOffset((current) =>
          clampLightboxOffset(current, clampedZoom, lightboxRotation)
        );
        return;
      }

      const imageRect = lightboxImageRef.current.getBoundingClientRect();
      const relativeX = clientX - (imageRect.left + imageRect.width / 2);
      const relativeY = clientY - (imageRect.top + imageRect.height / 2);
      const zoomRatio = clampedZoom / lightboxZoom;
      const nextOffset = {
        x: lightboxOffset.x - relativeX * (zoomRatio - 1) / clampedZoom,
        y: lightboxOffset.y - relativeY * (zoomRatio - 1) / clampedZoom
      };

      setLightboxZoom(clampedZoom);
      setLightboxOffset(clampLightboxOffset(nextOffset, clampedZoom, lightboxRotation));
    },
    [clampLightboxOffset, lightboxOffset.x, lightboxOffset.y, lightboxRotation, lightboxZoom]
  );

  const goToPreviousLightboxImage = useCallback(() => {
    if (lightboxImages.length < 2) {
      return;
    }

    setLightboxIndex((current) =>
      current === 0 ? lightboxImages.length - 1 : current - 1
    );
  }, [lightboxImages.length]);

  const goToNextLightboxImage = useCallback(() => {
    if (lightboxImages.length < 2) {
      return;
    }

    setLightboxIndex((current) =>
      current === lightboxImages.length - 1 ? 0 : current + 1
    );
  }, [lightboxImages.length]);

  const fallbackDownload = useCallback((src: string, alt: string) => {
    const link = document.createElement("a");
    link.href = src;
    link.download = alt || "email-image";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
  }, []);

  const downloadLightboxBlob = useCallback((blob: Blob, filename: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.rel = "noopener noreferrer";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }, []);

  const buildLightboxFilename = useCallback((alt: string, mimeType?: string) => {
    const safeBase =
      (alt || "email-image")
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, " ")
        .replace(/\s+/g, " ")
        .slice(0, 80) || "email-image";
    const extension = mimeType?.split("/")[1]?.split("+")[0]?.replace(/[^a-z0-9]/gi, "") || "jpg";

    return safeBase.toLowerCase().endsWith(`.${extension.toLowerCase()}`)
      ? safeBase
      : `${safeBase}.${extension}`;
  }, []);

  const fetchLightboxFile = useCallback(
    async (src: string, alt: string) => {
      const response = await fetch(src);

      if (!response.ok) {
        throw new Error(`Unable to download image (${response.status}).`);
      }

      const blob = await response.blob();
      return new File([blob], buildLightboxFilename(alt, blob.type), {
        type: blob.type || "image/jpeg"
      });
    },
    [buildLightboxFilename]
  );

  const handleLightboxSaveToFiles = useCallback(
    async (src: string, alt: string) => {
      if (typeof window === "undefined") {
        return;
      }

      try {
        const file = await fetchLightboxFile(src, alt);
        const pickerWindow = window as Window & {
          showSaveFilePicker?: (options?: {
            suggestedName?: string;
            types?: Array<{ description?: string; accept: Record<string, string[]> }>;
          }) => Promise<{
            createWritable: () => Promise<{
              write: (data: Blob) => Promise<void>;
              close: () => Promise<void>;
            }>;
          }>;
        };

        if (typeof pickerWindow.showSaveFilePicker === "function") {
          const extension = file.name.includes(".") ? `.${file.name.split(".").pop()}` : ".jpg";
          const handle = await pickerWindow.showSaveFilePicker({
            suggestedName: file.name,
            types: [
              {
                description: "Image",
                accept: { [file.type || "image/jpeg"]: [extension] }
              }
            ]
          });
          const writable = await handle.createWritable();
          await writable.write(file);
          await writable.close();
          showToast("Saved to files", "success");
          return;
        }

        downloadLightboxBlob(file, file.name);
        showToast("Download started", "success");
        return;
      } catch {
        fallbackDownload(src, alt);
        showToast("Download started", "success");
      }
    },
    [downloadLightboxBlob, fallbackDownload, fetchLightboxFile, showToast]
  );

  const handleLightboxSaveToPhotos = useCallback(
    async (src: string, alt: string) => {
      const title = alt || "Email image";

      if (canNativeShare) {
        try {
          const file = await fetchLightboxFile(src, alt);

          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share?.({
              files: [file],
              title
            });
            showToast("Choose Save Image or Save to Photos in the share sheet", "info");
            return;
          }
        } catch {
          // Fall through to a file save.
        }
      }

      await handleLightboxSaveToFiles(src, alt);
      showToast(
        isAppleMobile
          ? "Direct photo save isn't available here — saved as a file instead"
          : "Saved as a file — Photos save isn't supported in this browser",
        "info"
      );
    },
    [canNativeShare, fetchLightboxFile, handleLightboxSaveToFiles, isAppleMobile, showToast]
  );

  const collectLightboxImages = useCallback((
    doc: Document,
    clickedImage?: HTMLImageElement,
    receivedMedia: ReceivedMessageMedia[] = []
  ) => {
    const getImageEntry = (image: HTMLImageElement): LightboxImage | null => {
      const linkedSrc = image.closest("a")?.getAttribute("href")?.trim() ?? "";
      const resolvedSrc =
        image.currentSrc ||
        image.src ||
        image.getAttribute("data-src") ||
        image.getAttribute("data-original") ||
        "";
      const openSrc =
        linkedSrc && isLikelyImageUrl(linkedSrc) ? linkedSrc : resolvedSrc;
      const saveSrc = resolvedSrc || openSrc;

      if (!openSrc) {
        return null;
      }

      return {
        src: openSrc,
        saveSrc,
        alt: image.alt || image.getAttribute("title") || ""
      };
    };

    const clickedEntry = clickedImage ? getImageEntry(clickedImage) : null;
    const clickedSrc = clickedEntry?.src ?? "";
    const seen = new Set<string>();
    const images: LightboxImage[] = [];

    for (const entry of Array.from(doc.querySelectorAll("img"))) {
      const image = entry as HTMLImageElement;
      const lightboxImage = getImageEntry(image);
      const src = lightboxImage?.src ?? "";

      if (!src || seen.has(src)) {
        continue;
      }

      const width = image.naturalWidth || image.width || 0;
      const height = image.naturalHeight || image.height || 0;
      const isTinyTrackingImage = width > 0 && height > 0 && width <= 1 && height <= 1;

      if (isTinyTrackingImage && src !== clickedSrc) {
        continue;
      }

      seen.add(src);
      if (lightboxImage) {
        images.push(lightboxImage);
      }
    }

    if (images.length === 0 && clickedEntry) {
      images.push(clickedEntry);
    }

    for (const mediaItem of receivedMedia) {
      if (!isInlineViewerMedia(mediaItem) || seen.has(mediaItem.sourceUrl)) {
        continue;
      }

      seen.add(mediaItem.sourceUrl);
      images.push({
        src: mediaItem.sourceUrl,
        saveSrc: mediaItem.saveUrl,
        alt: mediaItem.filename
      });
    }

    return images;
  }, []);

  const applyReceivedInlineImageSources = useCallback(
    (doc: Document, receivedMedia: ReceivedMessageMedia[] = []) => {
      if (receivedMedia.length === 0) {
        return;
      }

      const inlineCidMap = new Map<string, string>();

      for (const mediaItem of receivedMedia) {
        if (!isInlineViewerMedia(mediaItem) || !mediaItem.contentId || !mediaItem.sourceUrl) {
          continue;
        }

        inlineCidMap.set(mediaItem.contentId.toLowerCase(), mediaItem.sourceUrl);
      }

      if (inlineCidMap.size === 0) {
        return;
      }

      for (const entry of Array.from(doc.querySelectorAll("img"))) {
        const image = entry as HTMLImageElement;
        const rawSrc = image.getAttribute("src")?.trim() ?? "";
        const cidMatch = rawSrc.match(/^cid:(.+)$/i);

        if (!cidMatch) {
          continue;
        }

        const normalizedContentId = cidMatch[1]?.trim().replace(/^<|>$/g, "").toLowerCase();
        const nextSrc = normalizedContentId ? inlineCidMap.get(normalizedContentId) : "";

        if (!nextSrc) {
          continue;
        }

        image.setAttribute("src", nextSrc);
        image.setAttribute("data-mmwb-inline-cid", normalizedContentId);
      }
    },
    []
  );

  const openLightboxFromEmailImage = useCallback(
    (doc: Document, image: HTMLImageElement, receivedMedia: ReceivedMessageMedia[] = []) => {
      const src = image.currentSrc || image.src;

      if (!src) {
        return false;
      }

      const bounds = image.getBoundingClientRect();
      const width = image.naturalWidth || image.width || bounds.width || 0;
      const height = image.naturalHeight || image.height || bounds.height || 0;

      if (width > 0 && height > 0 && width <= 1 && height <= 1) {
        return false;
      }

      const allImages = collectLightboxImages(doc, image, receivedMedia);
      const nextIndex = allImages.findIndex((entry) => entry.src === src);

      if (allImages.length === 0) {
        return false;
      }

      setLightboxImages(allImages);
      setLightboxIndex(nextIndex >= 0 ? nextIndex : 0);
      setLightboxOpen(true);
      return true;
    },
    [collectLightboxImages]
  );

  const attachLightboxImageHandlers = useCallback(
    (iframe: HTMLIFrameElement, receivedMedia: ReceivedMessageMedia[] = []) => {
      const doc = iframe.contentDocument;
      const frame = iframe as LightboxBridgedFrame;

      if (!doc) {
        return;
      }

      frame.__mmwbmailLightboxCleanup?.();

      const win = doc.defaultView;
      if (!win) {
        return;
      }

      const resolveImageFromPoint = (event: Event) => {
        if (!(event instanceof win.MouseEvent)) {
          return null;
        }

        const elementsAtPoint = doc.elementsFromPoint(event.clientX, event.clientY);
        for (const element of elementsAtPoint) {
          if (element instanceof win.HTMLImageElement) {
            return element as HTMLImageElement;
          }

          const nestedImage = element.querySelector("img");
          if (nestedImage instanceof win.HTMLImageElement) {
            return nestedImage as HTMLImageElement;
          }
        }

        return null;
      };

      const resolveTargetImage = (target: EventTarget | null, event?: Event) => {
        const baseNode =
          target instanceof win.Node ? target : null;
        const baseElement =
          baseNode instanceof win.Element
            ? baseNode
            : baseNode?.parentElement ?? null;

        if (!baseElement) {
          return null;
        }

        if (baseElement instanceof win.HTMLImageElement) {
          return baseElement as HTMLImageElement;
        }

        const closestImage = baseElement.closest("img");
        if (closestImage instanceof win.HTMLImageElement) {
          return closestImage as HTMLImageElement;
        }

        const nestedImage = baseElement.querySelector("img");
        if (nestedImage instanceof win.HTMLImageElement) {
          return nestedImage as HTMLImageElement;
        }

        return event ? resolveImageFromPoint(event) : null;
      };

      const resolveTargetAnchor = (target: EventTarget | null) => {
        const baseNode = target instanceof win.Node ? target : null;
        const baseElement =
          baseNode instanceof win.Element
            ? baseNode
            : baseNode?.parentElement ?? null;

        if (!baseElement) {
          return null;
        }

        const anchor = baseElement.closest("a");
        return anchor instanceof win.HTMLAnchorElement ? anchor : null;
      };

      const handleImageActivation = (image: HTMLImageElement, event: Event) => {
        if (!(image.currentSrc || image.src || image.getAttribute("data-src"))) {
          return;
        }

        const opened = openLightboxFromEmailImage(doc, image, receivedMedia);
        if (!opened) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
      };

      const markImagesInteractive = () => {
        doc.querySelectorAll("img").forEach((entry) => {
          const image = entry as HTMLImageElement;
          const anchor = image.closest("a");
          if (image.currentSrc || image.src || image.getAttribute("data-src")) {
            image.style.cursor = "zoom-in";
            image.style.pointerEvents = "auto";
            image.draggable = false;
            image.setAttribute("role", "button");
            image.tabIndex = image.tabIndex >= 0 ? image.tabIndex : 0;
            if (anchor instanceof win.HTMLAnchorElement) {
              anchor.style.cursor = "zoom-in";
              anchor.style.pointerEvents = "auto";
              anchor.draggable = false;
            }
          }

          if (image.dataset.mmwbLightboxBound === "true") {
            return;
          }

          image.dataset.mmwbLightboxBound = "true";
          image.addEventListener("click", (event) => {
            handleImageActivation(image, event);
          });
          image.addEventListener("keydown", (event) => {
            const keyboardEvent = event as KeyboardEvent;
            if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
              handleImageActivation(image, event);
            }
          });

          if (
            anchor instanceof win.HTMLAnchorElement &&
            anchor.dataset.mmwbLightboxBound !== "true"
          ) {
            anchor.dataset.mmwbLightboxBound = "true";
            anchor.addEventListener("click", (event) => {
              handleImageActivation(image, event);
            });
            anchor.addEventListener("keydown", (event) => {
              const keyboardEvent = event as KeyboardEvent;
              if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                handleImageActivation(image, event);
              }
            });
          }
        });
      };

      const handleDocumentPointerDown = (event: Event) => {
        const image = resolveTargetImage(event.target, event);
        if (!image) {
          return;
        }

        const anchor = resolveTargetAnchor(event.target);
        if (!anchor) {
          return;
        }

        handleImageActivation(image, event);
      };

      const handleDocumentClick = (event: Event) => {
        const image = resolveTargetImage(event.target, event);
        if (!image || !(image.currentSrc || image.src || image.getAttribute("data-src"))) {
          return;
        }

        handleImageActivation(image, event);
      };

      const observer = new MutationObserver(() => {
        applyReceivedInlineImageSources(doc, receivedMedia);
        markImagesInteractive();
      });
      applyReceivedInlineImageSources(doc, receivedMedia);
      markImagesInteractive();
      doc.addEventListener("pointerdown", handleDocumentPointerDown, true);
      doc.addEventListener("mousedown", handleDocumentPointerDown, true);
      doc.addEventListener("click", handleDocumentClick, true);

      if (doc.body || doc.documentElement) {
        observer.observe(doc.body ?? doc.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["src"]
        });
      }

      frame.__mmwbmailLightboxCleanup = () => {
        doc.removeEventListener("pointerdown", handleDocumentPointerDown, true);
        doc.removeEventListener("mousedown", handleDocumentPointerDown, true);
        doc.removeEventListener("click", handleDocumentClick, true);
        observer.disconnect();
      };
    },
    [applyReceivedInlineImageSources, openLightboxFromEmailImage]
  );

  const handleEmailFrameLoad = useCallback(
    (iframe: HTMLIFrameElement, receivedMedia: ReceivedMessageMedia[] = []) => {
      const doc = iframe.contentDocument;
      const body = doc?.body;
      const root = doc?.documentElement;
      const nextHeight = Math.max(
        body?.scrollHeight ?? 0,
        body?.offsetHeight ?? 0,
        root?.scrollHeight ?? 0,
        root?.offsetHeight ?? 0,
        320
      );

      iframe.style.display = "block";
      iframe.style.height = `${nextHeight}px`;
      attachLightboxImageHandlers(iframe, receivedMedia);
    },
    [attachLightboxImageHandlers]
  );

  useEffect(() => {
    if (!lightboxOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeLightbox();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToPreviousLightboxImage();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        goToNextLightboxImage();
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        applyLightboxZoom(lightboxZoom + 0.25);
        return;
      }

      if (event.key === "-") {
        event.preventDefault();
        applyLightboxZoom(lightboxZoom - 0.25);
        return;
      }

      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        setLightboxRotation((current) => (current + 90) % 360);
        setLightboxOffset({ x: 0, y: 0 });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    applyLightboxZoom,
    closeLightbox,
    goToNextLightboxImage,
    goToPreviousLightboxImage,
    lightboxOpen,
    lightboxZoom
  ]);

  async function executePrint(options: {
    scope: "message" | "thread";
    includeHeaders: boolean;
    includeQuoted: boolean;
    format: "print" | "pdf";
  }) {
    if (typeof document === "undefined" || typeof window === "undefined" || !selectedMessage) {
      return;
    }

    const messagesToPrint: MailDetail[] = [];

    if (options.scope === "thread" && showConversationView) {
      for (const message of activeConversationMessages) {
        try {
          const detail =
            selectedMessage.uid === message.uid
              ? selectedMessage
              : cleanupPreviewCache[message.uid] ?? (await resolveMessageDetail(message));
          messagesToPrint.push(detail);
        } catch {
          // Skip thread members that fail to resolve instead of blocking the whole print job.
        }
      }
    } else {
      let detailToPrint: MailDetail | null = null;
      const requestedTargetUid = effectivePrintTargetUid ?? selectedMessage.uid;

      if (effectivePrintTargetUid) {
        const targetMessage =
          activeConversationMessages.find((message) => message.uid === effectivePrintTargetUid) ??
          activeConversation?.messages.find((message) => message.uid === effectivePrintTargetUid)
            ?.raw ??
          messages.find((message) => message.uid === effectivePrintTargetUid) ??
          null;

        if (targetMessage) {
          try {
            detailToPrint =
              selectedMessage.uid === targetMessage.uid
                ? selectedMessage
                : cleanupPreviewCache[targetMessage.uid] ?? (await resolveMessageDetail(targetMessage));
          } catch {
            detailToPrint = selectedMessage.uid === targetMessage.uid ? selectedMessage : null;
          }
        }
      }

      if (!detailToPrint && requestedTargetUid === selectedMessage.uid) {
        detailToPrint = selectedMessage;
      }

      if (detailToPrint) {
        messagesToPrint.push(detailToPrint);
      }
    }

    if (messagesToPrint.length === 0) {
      showToast("Couldn't prepare this email for printing", "error");
      return;
    }

    const titleMessage =
      messagesToPrint.find((message) => message.uid === effectivePrintTargetUid) ??
      messagesToPrint[messagesToPrint.length - 1];
    const originalTitle = document.title;
    const nextTitle = [
      displaySender(titleMessage.from),
      titleMessage.subject,
      formatTimestamp(titleMessage.date)
    ]
      .filter(Boolean)
      .join(" - ");

    document.title = nextTitle;
    const restoreTitleTimer = window.setTimeout(() => {
      document.title = originalTitle;
    }, 2000);

    setPrintModalOpen(false);

    const printFrame = document.createElement("iframe");
    printFrame.setAttribute("aria-hidden", "true");
    printFrame.style.position = "fixed";
    printFrame.style.right = "0";
    printFrame.style.bottom = "0";
    printFrame.style.width = "0";
    printFrame.style.height = "0";
    printFrame.style.opacity = "0";
    printFrame.style.border = "0";
    printFrame.style.pointerEvents = "none";
    printFrame.dataset.printFormat = options.format;

    document.body.appendChild(printFrame);

    const cleanup = (() => {
      let cleaned = false;
      return () => {
        if (cleaned) {
          return;
        }

        cleaned = true;
        window.clearTimeout(restoreTitleTimer);
        document.title = originalTitle;
        printFrame.remove();
      };
    })();

    try {
      const printDocument = printFrame.contentDocument;
      const printWindow = printFrame.contentWindow;

      if (!printDocument || !printWindow) {
        throw new Error("Print frame unavailable.");
      }

      printDocument.open();
      printDocument.write(
        buildPrintDocument(messagesToPrint, {
          includeHeaders: options.includeHeaders,
          includeQuoted: options.includeQuoted,
          scope: options.scope
        })
      );
      printDocument.close();

      await waitForPrintDocumentAssets(printDocument);
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });

      const cleanupAfterPrint = () => {
        window.setTimeout(cleanup, 150);
      };
      const fallbackCleanup = window.setTimeout(cleanup, 60000);

      printWindow.addEventListener("afterprint", cleanupAfterPrint, { once: true });
      window.addEventListener(
        "focus",
        () => {
          window.clearTimeout(fallbackCleanup);
          cleanupAfterPrint();
        },
        { once: true }
      );

      printWindow.focus();
      printWindow.print();
    } catch (error) {
      cleanup();
      showToast(
        error instanceof Error ? error.message : "Couldn't open the print view",
        "error"
      );
    }
  }

  async function handlePrintAction() {
    await executePrint({
      scope: printScope,
      includeHeaders: printIncludeHeaders,
      includeQuoted: printIncludeQuoted,
      format: printFormat
    });
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      const activeElement = document.activeElement as HTMLElement | null;
      const tag = (activeElement?.tagName ?? "").toLowerCase();
      const isEditing =
        tag === "input" ||
        tag === "textarea" ||
        activeElement?.contentEditable === "true" ||
        activeElement?.isContentEditable === true;

      if (event.key === "Escape" && selectedUids.size > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      if (isEditing && !meta) {
        return;
      }

      if (meta && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openCompose();
        return;
      }

      if (meta && !event.shiftKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (!selectedMessage) {
          void forceRefresh();
          return;
        }
        if (selectedMessage) {
          handleReply(selectedMessage);
        }
        return;
      }

      if (meta && event.shiftKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (selectedMessage) {
          handleReplyAll(selectedMessage);
        }
        return;
      }

      if (meta && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (selectedMessage) {
          handleForward(selectedMessage);
        }
        return;
      }

      if ((event.key === "Backspace" || event.key === "Delete") && !isEditing) {
        event.preventDefault();
        if (selectedMessage) {
          void handleDeleteOne(selectedMessage);
        }
        return;
      }

      if (meta && event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
        return;
      }

      if (event.key === "Escape") {
        if (composeOpen) {
          const editor = composeEditorRef.current;
          const hasContent =
            composeToList.length > 0 ||
            (editor?.innerText?.trim().length ?? 0) > 2 ||
            composeSubject.trim().length > 0;

          if (hasContent) {
            setDiscardConfirmOpen(true);
          } else {
            lastEditableRef.current = null;
            setComposeOpen(false);
          }
          return;
        }

        if (cleanupMode) {
          setCleanupMode(false);
          return;
        }

        if (contextMenu) {
          setContextMenu(null);
          return;
        }

        if (listAreaContextMenu) {
          setListAreaContextMenu(null);
          return;
        }

        if (bulkSelectionMenu) {
          setBulkSelectionMenu(null);
          return;
        }

        if (senderFilter) {
          clearSenderFocus();
          return;
        }

        if (subjectFilter) {
          setSubjectFilter(null);
          setSubjectPattern(null);
        }
        return;
      }

      if (!isEditing && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();

        if (sortedMessages.length === 0) {
          return;
        }

        const currentIndex = sortedMessages.findIndex(
          (message) => message.uid === (selectedMessage?.uid ?? selectedUid)
        );

        if (event.key === "ArrowDown") {
          const next = sortedMessages[Math.min(currentIndex + 1, sortedMessages.length - 1)];
          if (next) {
            void openMessage(next.uid);
          }
        } else {
          const prev = sortedMessages[Math.max(currentIndex - 1, 0)];
          if (prev) {
            void openMessage(prev.uid);
          }
        }
        return;
      }

      if (event.key.toLowerCase() === "u" && !isEditing && !meta && selectedMessage) {
        void handleToggleRead(selectedMessage);
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    cleanupMode,
    composeOpen,
    composeSubject,
    composeToList,
    contextMenu,
    listAreaContextMenu,
    bulkSelectionMenu,
    clearSelection,
    handleDeleteOne,
    handleForward,
    handleBulkToggleRead,
    forceRefresh,
    handleReply,
    handleReplyAll,
    handleToggleRead,
    selectedMessage,
    selectedUids.size,
    selectedUid,
    senderFilter,
    sortedMessages,
    subjectFilter
  ]);

  return (
    <main className="shell">
      {hasHydrated ? (
        <div className="menubar" onMouseDown={(event) => event.stopPropagation()}>
        <div className="menubar-item-wrap">
          <div
            className={`menubar-item ${openMenu === "app" ? "active" : ""}`}
            onMouseDown={() => setOpenMenu(openMenu === "app" ? null : "app")}
          >
            Maximail
          </div>
          {openMenu === "app" ? (
            <div className="menu-dropdown">
              <div className="menu-item menu-item-disabled">About Maximail</div>
              <div className="menu-sep" />
              <div
                className="menu-item"
                onMouseDown={() => {
                  setSettingsOpen(true);
                  setOpenMenu(null);
                }}
              >
                Settings…
                <span className="menu-shortcut">⌘,</span>
              </div>
              <div className="menu-sep" />
              <div
                className="menu-item"
                onMouseDown={() => {
                  setCleanupMode(true);
                  setOpenMenu(null);
                }}
              >
                Cleanup Inbox…
              </div>
              <div className="menu-sep" />
              <div className="menu-item menu-item-disabled">
                Quit Maximail
                <span className="menu-shortcut">⌘Q</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="menubar-item-wrap">
          <div
            className={`menubar-item ${openMenu === "file" ? "active" : ""}`}
            onMouseDown={() => setOpenMenu(openMenu === "file" ? null : "file")}
          >
            File
          </div>
          {openMenu === "file" ? (
            <div className="menu-dropdown">
              <div
                className="menu-item"
                onMouseDown={() => {
                  openCompose();
                  setOpenMenu(null);
                }}
              >
                New Message
                <span className="menu-shortcut">⌘N</span>
              </div>
              <div className="menu-item" onMouseDown={() => setOpenMenu(null)}>
                New Window
                <span className="menu-shortcut">⌘⇧N</span>
              </div>
              <div className="menu-sep" />
              <div className="menu-item menu-item-disabled">
                Close Window
                <span className="menu-shortcut">⌘W</span>
              </div>
              <div className="menu-sep" />
              <div
                className="menu-item"
                onMouseDown={() => {
                  if (selectedMessage) {
                    handleReply(selectedMessage);
                  }
                  setOpenMenu(null);
                }}
              >
                Reply
                <span className="menu-shortcut">⌘R</span>
              </div>
              <div
                className="menu-item"
                onMouseDown={() => {
                  if (selectedMessage) {
                    handleReplyAll(selectedMessage);
                  }
                  setOpenMenu(null);
                }}
              >
                Reply All
                <span className="menu-shortcut">⌘⇧R</span>
              </div>
              <div
                className="menu-item"
                onMouseDown={() => {
                  if (selectedMessage) {
                    handleForward(selectedMessage);
                  }
                  setOpenMenu(null);
                }}
              >
                Forward
                <span className="menu-shortcut">⌘⇧F</span>
              </div>
              <div
                className="menu-item"
                onMouseDown={() => {
                  if (selectedMessage) {
                    handleEditAsNew(selectedMessage);
                  }
                  setOpenMenu(null);
                }}
              >
                Edit as New
              </div>
              <div className="menu-sep" />
              <div
                className="menu-item"
                onMouseDown={() => {
                  if (selectedMessage) {
                    void handleDeleteOne(selectedMessage);
                  }
                  setOpenMenu(null);
                }}
              >
                Move to Trash
                <span className="menu-shortcut">⌫</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="menubar-item-wrap">
          <div
            className={`menubar-item ${openMenu === "edit" ? "active" : ""}`}
            onMouseDown={() => setOpenMenu(openMenu === "edit" ? null : "edit")}
          >
            Edit
          </div>
          {openMenu === "edit" ? (
            <div className="menu-dropdown">
              <div
                className={`menu-item${!editableActive ? " menu-item-disabled" : ""}`}
                onMouseDown={() => {
                  if (!editableActive) {
                    return;
                  }
                  execOnEditable("undo", undefined, lastEditableRef.current);
                  setOpenMenu(null);
                }}
              >
                Undo <span className="menu-shortcut">⌘Z</span>
              </div>
              <div
                className={`menu-item${!editableActive ? " menu-item-disabled" : ""}`}
                onMouseDown={() => {
                  if (!editableActive) {
                    return;
                  }
                  execOnEditable("redo", undefined, lastEditableRef.current);
                  setOpenMenu(null);
                }}
              >
                Redo <span className="menu-shortcut">⌘⇧Z</span>
              </div>
              <div className="menu-sep" />
              <div
                className={`menu-item${!editableActive ? " menu-item-disabled" : ""}`}
                onMouseDown={() => {
                  if (!editableActive) {
                    return;
                  }
                  execOnEditable("cut", undefined, lastEditableRef.current);
                  setOpenMenu(null);
                }}
              >
                Cut <span className="menu-shortcut">⌘X</span>
              </div>
              <div
                className="menu-item"
                onMouseDown={() => {
                  document.execCommand("copy");
                  setOpenMenu(null);
                }}
              >
                Copy <span className="menu-shortcut">⌘C</span>
              </div>
              <div
                className={`menu-item${!editableActive ? " menu-item-disabled" : ""}`}
                onMouseDown={() => {
                  if (!editableActive) {
                    return;
                  }
                  execOnEditable("paste", undefined, lastEditableRef.current);
                  setOpenMenu(null);
                }}
              >
                Paste <span className="menu-shortcut">⌘V</span>
              </div>
              <div
                className={`menu-item${!editableActive ? " menu-item-disabled" : ""}`}
                onMouseDown={() => {
                  if (!editableActive) {
                    return;
                  }
                  const editable =
                    getActiveEditableElement() ?? lastEditableRef.current;
                  if (editable) {
                    editable.focus();
                    document.execCommand("selectAll");
                  }
                  setOpenMenu(null);
                }}
              >
                Select All <span className="menu-shortcut">⌘A</span>
              </div>
              <div className="menu-sep" />
              <div
                className={`menu-item${!editableActive ? " menu-item-disabled" : ""}`}
                onMouseDown={() => {
                  if (!editableActive) {
                    return;
                  }
                  execOnEditable("bold", undefined, lastEditableRef.current);
                  setOpenMenu(null);
                }}
              >
                Bold <span className="menu-shortcut">⌘B</span>
              </div>
              <div
                className={`menu-item${!editableActive ? " menu-item-disabled" : ""}`}
                onMouseDown={() => {
                  if (!editableActive) {
                    return;
                  }
                  execOnEditable("italic", undefined, lastEditableRef.current);
                  setOpenMenu(null);
                }}
              >
                Italic <span className="menu-shortcut">⌘I</span>
              </div>
              <div
                className={`menu-item${!editableActive ? " menu-item-disabled" : ""}`}
                onMouseDown={() => {
                  if (!editableActive) {
                    return;
                  }
                  execOnEditable("underline", undefined, lastEditableRef.current);
                  setOpenMenu(null);
                }}
              >
                Underline <span className="menu-shortcut">⌘U</span>
              </div>
              <div className="menu-sep" />
              <div
                className={`menu-item menu-item-submenu${!editableActive ? " menu-item-disabled" : ""}`}
                onMouseEnter={() => {
                  if (!editableActive) {
                    return;
                  }
                  setOpenSubmenu("transform");
                }}
                onMouseLeave={() => setOpenSubmenu(null)}
              >
                Transformations
                <span className="menu-submenu-arrow">›</span>
                {openSubmenu === "transform" && editableActive ? (
                  <div className="menu-dropdown menu-subdropdown">
                    <div
                      className={`menu-item${!editableActive ? " menu-item-disabled" : ""}`}
                      onMouseDown={() => {
                        if (!editableActive) {
                          return;
                        }
                        transformCase("upper");
                        setOpenMenu(null);
                      }}
                    >
                      Make Upper Case
                    </div>
                    <div
                      className={`menu-item${!editableActive ? " menu-item-disabled" : ""}`}
                      onMouseDown={() => {
                        if (!editableActive) {
                          return;
                        }
                        transformCase("lower");
                        setOpenMenu(null);
                      }}
                    >
                      Make Lower Case
                    </div>
                    <div
                      className={`menu-item${!editableActive ? " menu-item-disabled" : ""}`}
                      onMouseDown={() => {
                        if (!editableActive) {
                          return;
                        }
                        transformCase("title");
                        setOpenMenu(null);
                      }}
                    >
                      Capitalize
                    </div>
                    <div
                      className={`menu-item${!editableActive ? " menu-item-disabled" : ""}`}
                      onMouseDown={() => {
                        if (!editableActive) {
                          return;
                        }
                        transformCase("sentence");
                        setOpenMenu(null);
                      }}
                    >
                      Sentence Case
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="menubar-item-wrap">
          <div
            className={`menubar-item ${openMenu === "view" ? "active" : ""}`}
            onMouseDown={() => setOpenMenu(openMenu === "view" ? null : "view")}
          >
            View
          </div>
          {openMenu === "view" ? (
            <div className="menu-dropdown">
              <div
                className="menu-item"
                onMouseDown={() => {
                  setSortBy("date");
                  setOpenMenu(null);
                }}
              >
                Sort by Date
              </div>
              <div
                className="menu-item"
                onMouseDown={() => {
                  setSortBy("name");
                  setOpenMenu(null);
                }}
              >
                Sort by Name
              </div>
              <div
                className="menu-item"
                onMouseDown={() => {
                  setSortBy("subject");
                  setOpenMenu(null);
                }}
              >
                Sort by Subject
              </div>
              <div className="menu-sep" />
              <div
                className="menu-item"
                onMouseDown={() => {
                  clearSenderFocus();
                  setSubjectFilter(null);
                  setSubjectPattern(null);
                  setOpenMenu(null);
                }}
              >
                Clear All Filters
              </div>
              <div className="menu-sep" />
              <div
                className="menu-item"
                onMouseDown={() => {
                  setCleanupMode(true);
                  setOpenMenu(null);
                }}
              >
                Cleanup Mode
              </div>
            </div>
          ) : null}
        </div>
        </div>
      ) : null}

      <section
        ref={workspaceRef}
        className={`workspace ${isWideWorkspace ? "workspace-resizable" : ""} ${
          workspaceActiveDivider ? "workspace-resizing" : ""
        } ${workspacePaneSettling ? "workspace-resize-settling" : ""}`}
        data-interaction-mode={responsiveInteractionMode}
        data-mobile-screen={isMobileStackedMode ? mobileStackedScreen : undefined}
        style={
          isWideWorkspace
            ? {
                gridTemplateColumns: `${workspacePaneWidths.sidebar}px ${WORKSPACE_DIVIDER_WIDTH}px ${workspacePaneWidths.list}px ${WORKSPACE_DIVIDER_WIDTH}px minmax(${WORKSPACE_MIN_VIEWER_WIDTH}px, 1fr)`
              }
            : undefined
        }
      >
        <aside
          className={`rail sidebar ${showSidebarPane ? "" : "mobile-stacked-pane-hidden"}`}
          data-size={sidebarSize}
        >
          <div className="brand sidebar-brand">
            <p className="eyebrow">Maximail</p>
            <div className="sidebar-hero">
              <div className="sidebar-hero-title">
                This is what inbox control actually feels like.
              </div>
              <div className="sidebar-hero-sub">
                Pivot to any sender instantly, bulk-delete and block in one move,
                and sort through noise without ever losing your place.
              </div>
            </div>
          </div>

          {shouldShowLightweightOnboarding ? (
            <div className="sidebar-onboarding" role="status" aria-live="polite">
              <div className="sidebar-onboarding-kicker">Welcome</div>
              <div className="sidebar-onboarding-title">
                Maximail works a little differently.
              </div>
              <div className="sidebar-onboarding-list">
                <div className="sidebar-onboarding-item">
                  <span className="sidebar-onboarding-item-icon">●</span>
                  <div className="sidebar-onboarding-item-copy">
                    <strong>New Mail</strong> keeps active unread inbox mail together. Read Mail
                    holds the inbox you have already worked through.
                  </div>
                </div>
                <div className="sidebar-onboarding-item">
                  <span className="sidebar-onboarding-item-icon">●</span>
                  <div className="sidebar-onboarding-item-copy">
                    <strong>Sort</strong> is the fast way to file into Receipts, Travel,
                    Follow-Up, or Reference.
                  </div>
                </div>
                <div className="sidebar-onboarding-item">
                  <span className="sidebar-onboarding-item-icon">●</span>
                  <div className="sidebar-onboarding-item-copy">
                    Each account stays live. Expand an account when you want more folders, not
                    more noise.
                  </div>
                </div>
              </div>
              <div className="sidebar-onboarding-actions">
                <button
                  type="button"
                  className="sidebar-onboarding-btn sidebar-onboarding-btn-primary"
                  onClick={() => {
                    clearPrioritizedSenderFocus();
                    setLightweightOnboardingDismissed(true);
                    setMailboxViewMode("new-mail");
                    if (isInboxMailboxNode(activeMailboxNode)) {
                      setInboxAttentionView("new-mail");
                    }
                  }}
                >
                  Try New Mail
                </button>
                <button
                  type="button"
                  className="sidebar-onboarding-btn"
                  onClick={() => setLightweightOnboardingDismissed(true)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}

          <div className="panel sidebar-shell">
            <div className="sidebar-section">
              <div className="sidebar-label">Prioritized</div>
              {prioritizedSenders.length > 0 ? (
                prioritizedSenders.map((sender) => {
                  const count = messages.filter((message) => message.from === sender.name).length;
                  const unread = messages.filter(
                    (message) => message.from === sender.name && !message.seen
                  ).length;
                  const isActive =
                    senderFilterScope === "prioritized" && senderFilter === sender.name;
                  const autoFilter = autoFilters.find(
                    (filterRule) => filterRule.senderName === sender.name
                  );

                  return (
                    <div
                      key={sender.name}
                      className={`sidebar-item priority-item ${isActive ? "active" : ""}`}
                      onClick={() => {
                        if (isActive) {
                          clearSenderFocus();
                        } else {
                          applyPrioritizedSenderFocus(sender.name);
                        }
                        if (isMobileStackedMode) {
                          setMobileStackedScreen("messages");
                        }
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setSidebarCtx({
                          x: event.clientX,
                          y: event.clientY,
                          sender
                        });
                      }}
                    >
                      <div className="priority-leading">
                        <span
                          className="priority-folder-icon"
                          style={{ color: sender.color }}
                          aria-hidden="true"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M3 7.75A2.75 2.75 0 0 1 5.75 5h3.42c.56 0 1.1.22 1.5.62l1.1 1.1c.19.19.44.28.7.28h5.78A2.75 2.75 0 0 1 21 9.75v6.5A2.75 2.75 0 0 1 18.25 19H5.75A2.75 2.75 0 0 1 3 16.25z" />
                          </svg>
                        </span>
                      </div>
                      <div className="priority-info">
                        <div className="priority-name">{displaySender(sender.name)}</div>
                        {unread > 0 ? (
                          <div className="priority-meta">{unread} unread</div>
                        ) : null}
                      </div>
                      {autoFilter ? (
                        <span
                          className="priority-autofilter-badge"
                          title={`Auto-filter: keep ${autoFilter.keepDays} days`}
                        >
                          🕐
                        </span>
                      ) : null}
                      <div className="priority-count">{count}</div>
                      <button
                        className="priority-remove"
                        title="Remove"
                        onClick={(event) => {
                          event.stopPropagation();
                          const updatedList = prioritizedSenders.filter(
                            (item) => item.name !== sender.name
                          );
                          setPrioritizedSenders(updatedList);
                          if (activeAccountId) {
                            syncServerPreferences(activeAccountId, {
                              prioritizedSenders: updatedList
                            });
                          }
                          if (senderFilter === sender.name) {
                            clearSenderFocus();
                          }
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="sidebar-smart-empty">
                  <div className="sidebar-smart-empty-title">No Prioritized Senders yet</div>
                  <div className="sidebar-smart-empty-sub">
                    Keep important people here when you want a quieter, more focused relationship view.
                  </div>
                </div>
              )}
            </div>

            <div className="sidebar-cleanup-btn-wrap">
              <button className="sidebar-cleanup-btn" onClick={() => setCleanupMode(true)}>
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4h6v2" />
                </svg>
                Cleanup Inbox
              </button>
            </div>

            <div className="sidebar-folders">
              <div className="sidebar-folders-header">
                <span className="sidebar-label">Mailboxes</span>
                <div className="sidebar-folders-header-actions">
                  <div
                    className="mailbox-view-toggle"
                    title="New Mail View: An optional attention-first mode where Inbox becomes New Mail, read inbox items appear in a virtual Read Mail folder, and threaded conversations stay complete."
                  >
                    <button
                      type="button"
                      className={`mailbox-view-btn ${mailboxViewMode === "classic" ? "active" : ""}`}
                      onClick={() => {
                        clearPrioritizedSenderFocus();
                        setMailboxViewMode("classic");
                        setInboxAttentionView(null);
                      }}
                    >
                      Classic
                    </button>
                    <button
                      type="button"
                      className={`mailbox-view-btn ${mailboxViewMode === "new-mail" ? "active" : ""}`}
                      onClick={() => {
                        clearPrioritizedSenderFocus();
                        setMailboxViewMode("new-mail");
                        if (isInboxMailboxNode(activeMailboxNode)) {
                          setInboxAttentionView("new-mail");
                        }
                      }}
                    >
                      New Mail
                    </button>
                  </div>
                  <button
                    className="sidebar-refresh-btn"
                    onClick={() => forceRefresh()}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                  </button>
                </div>
              </div>

              {accounts.length === 0 ? (
                <p className="empty">Connect an account to load folders.</p>
              ) : (
                <div className="sidebar-mailbox-groups">
                  {sidebarMailboxGroups.map(({ account, isActive: isAccountActive, mailboxTargets }) => {
                    const persistedDisclosureState =
                      accountMailboxDisclosureStates[account.id] ?? 1;
                    const disclosureState = sidebarMailDragState
                      ? 3
                      : persistedDisclosureState;
                    const disclosureTargetInput = {
                      mailboxViewMode,
                      activeProviderPath: mailboxQuery.target.providerPath,
                      activeInboxAttentionView,
                      includeActiveSortFoldersInCollapsed:
                        collapsedSortFolderVisibility === "include_active_sort_folders"
                    };
                    const { visibleTargets, quietTargets } = getAccountMailboxDisclosureTargets(
                      mailboxTargets,
                      {
                        disclosureState,
                        ...disclosureTargetInput
                      }
                    );
                    const persistedDisclosureTargets =
                      sidebarMailDragState &&
                      persistedDisclosureState !== 3
                        ? getAccountMailboxDisclosureTargets(mailboxTargets, {
                            disclosureState: persistedDisclosureState,
                            ...disclosureTargetInput
                          })
                        : null;
                    const disclosureAnimation =
                      accountMailboxDisclosureAnimations[account.id] ?? null;
                    const animatedVisibleTargets = disclosureAnimation
                      ? mergeSidebarMailboxTargetsById(mailboxTargets, [
                          ...disclosureAnimation.previousVisibleIds,
                          ...disclosureAnimation.currentVisibleIds
                        ])
                      : visibleTargets;
                    const animatedQuietTargets = disclosureAnimation
                      ? mergeSidebarMailboxTargetsById(mailboxTargets, [
                          ...disclosureAnimation.previousQuietIds,
                          ...disclosureAnimation.currentQuietIds
                        ])
                      : quietTargets;
                    const previousVisibleIdSet = disclosureAnimation
                      ? new Set(disclosureAnimation.previousVisibleIds)
                      : null;
                    const previousQuietIdSet = disclosureAnimation
                      ? new Set(disclosureAnimation.previousQuietIds)
                      : null;
                    const currentVisibleIdSet = disclosureAnimation
                      ? new Set(disclosureAnimation.currentVisibleIds)
                      : null;
                    const currentQuietIdSet = disclosureAnimation
                      ? new Set(disclosureAnimation.currentQuietIds)
                      : null;
                    const persistedVisibleIdSet = persistedDisclosureTargets
                      ? new Set(persistedDisclosureTargets.visibleTargets.map((target) => target.id))
                      : null;
                    const persistedQuietIdSet = persistedDisclosureTargets
                      ? new Set(persistedDisclosureTargets.quietTargets.map((target) => target.id))
                      : null;

                    const cycleDisclosureState = () => {
                      if (sidebarMailDragState) {
                        return;
                      }

                      const nextDisclosureState = nextAccountMailboxDisclosureState(disclosureState);
                      const nextTargets = getAccountMailboxDisclosureTargets(mailboxTargets, {
                        disclosureState: nextDisclosureState,
                        ...disclosureTargetInput
                      });

                      queueAccountMailboxDisclosureAnimation(account.id, {
                        phase: nextDisclosureState > disclosureState ? "expanding" : "collapsing",
                        previousVisibleIds: visibleTargets.map((target) => target.id),
                        previousQuietIds: quietTargets.map((target) => target.id),
                        currentVisibleIds: nextTargets.visibleTargets.map((target) => target.id),
                        currentQuietIds: nextTargets.quietTargets.map((target) => target.id)
                      });

                      setAccountMailboxDisclosureStates((current) => ({
                        ...current,
                        [account.id]: nextDisclosureState
                      }));
                    };

                    const resolveMailboxRowAnimationClass = (
                      mailboxTargetId: string,
                      quiet: boolean
                    ) => {
                      if (
                        !disclosureAnimation ||
                        !previousVisibleIdSet ||
                        !previousQuietIdSet ||
                        !currentVisibleIdSet ||
                        !currentQuietIdSet
                      ) {
                        return "";
                      }

                      const previousSet = quiet ? previousQuietIdSet : previousVisibleIdSet;
                      const currentSet = quiet ? currentQuietIdSet : currentVisibleIdSet;
                      const wasVisible = previousSet.has(mailboxTargetId);
                      const isVisible = currentSet.has(mailboxTargetId);

                      if (!wasVisible && isVisible) {
                        return "folder-row-entering";
                      }

                      if (wasVisible && !isVisible) {
                        return "folder-row-exiting";
                      }

                      return "";
                    };

                    const renderMailboxRow = (
                      mailboxTarget: SidebarMailboxTarget,
                      options?: { quiet?: boolean }
                    ) => {
                      const mailboxNode = mailboxTarget.mailboxNode;
                      const isMailboxActive =
                        isAccountActive &&
                        mailboxNode.identity.providerPath === mailboxQuery.target.providerPath &&
                        activeInboxAttentionView === mailboxTarget.inboxAttentionView;
                      const canReorder = isAccountActive;
                      const sortFolderTooltip = getSortFolderTooltip(
                        mailboxTarget.name,
                        mailboxNode.identity.providerPath
                      );
                      const sortFolderPresentation = getSortFolderPresentation(
                        mailboxTarget.name,
                        mailboxNode.identity.providerPath
                      );
                      const mobileMailboxRowHint = getMobileMailboxRowHint({
                        inboxAttentionView: mailboxTarget.inboxAttentionView,
                        sortFolderPresentation,
                        isMobileStackedMode
                      });
                      const rowAnimationClass = resolveMailboxRowAnimationClass(
                        mailboxTarget.id,
                        Boolean(options?.quiet)
                      );
                      const isValidMailDropTarget = isValidSidebarMailDropTarget(
                        account.id,
                        mailboxTarget
                      );
                      const isMailDropHover =
                        isValidMailDropTarget &&
                        sidebarMailDragHoverTargetId === mailboxTarget.id;
                      const isDragReveal =
                        Boolean(sidebarMailDragState) &&
                        Boolean(persistedVisibleIdSet) &&
                        Boolean(persistedQuietIdSet) &&
                        !persistedVisibleIdSet?.has(mailboxTarget.id) &&
                        !persistedQuietIdSet?.has(mailboxTarget.id);

                      return (
                        <div
                          key={mailboxTarget.id}
                          className={`folder-row ${isMailboxActive ? "active" : ""} ${
                            mailboxTarget.inboxAttentionView === "read" ? "folder-row-quiet" : ""
                          } ${options?.quiet ? "folder-row-historical" : ""} ${
                            sortFolderPresentation ? "folder-row-sort-preset" : ""
                          } ${
                            draggedFolderPath === mailboxNode.identity.providerPath ? "dragging" : ""
                          } ${rowAnimationClass}
                          ${
                            disclosureAnimation
                              ? `folder-row-disclosure-${disclosureAnimation.phase}`
                              : ""
                          } ${isMailDropHover ? "folder-row-drop-target" : ""} ${
                            isDragReveal ? "folder-row-drag-reveal" : ""
                          }`}
                          title={sortFolderTooltip ?? undefined}
                          draggable={canReorder && !mailboxTarget.isVirtual && !sidebarMailDragState}
                          onContextMenu={(event) => {
                            if (mailboxNode.systemKey !== "trash") {
                              return;
                            }

                            event.preventDefault();
                            event.stopPropagation();
                            setFolderContextMenu({
                              x: event.clientX,
                              y: event.clientY,
                              accountId: account.id,
                              accountEmail: account.email,
                              folderPath: mailboxNode.identity.providerPath,
                              folderName: mailboxTarget.name
                            });
                          }}
                          onClick={async () => {
                            clearPrioritizedSenderFocus();
                            const nextAttentionView =
                              mailboxViewMode === "new-mail"
                                ? mailboxTarget.inboxAttentionView
                                : null;

                            if (isAccountActive) {
                              persistConnection({
                                ...connection,
                                folder: mailboxNode.identity.providerPath
                              });
                              setInboxAttentionView(nextAttentionView);
                              if (isMobileStackedMode) {
                                setMobileStackedScreen("messages");
                              }
                              startTransition(() => {
                                refreshCurrentFolder(mailboxNode.identity.providerPath);
                              });
                              return;
                            }

                            setIsBusy(true);
                            try {
                              await activateAccount(account, {
                                sync: true,
                                folderOverride: mailboxNode.identity.providerPath
                              });
                              setInboxAttentionView(nextAttentionView);
                              if (isMobileStackedMode) {
                                setMobileStackedScreen("messages");
                              }
                            } catch (error) {
                              setStatus(
                                error instanceof Error
                                  ? error.message
                                  : "Unable to switch accounts."
                              );
                            } finally {
                              setIsBusy(false);
                            }
                          }}
                          onDragStart={() => {
                            if (canReorder && !mailboxTarget.isVirtual && !sidebarMailDragState) {
                              setDraggedFolderPath(mailboxNode.identity.providerPath);
                            }
                          }}
                          onDragOver={(event) => {
                            if (isValidMailDropTarget) {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                              if (sidebarMailDragHoverTargetId !== mailboxTarget.id) {
                                setSidebarMailDragHoverTargetId(mailboxTarget.id);
                              }
                              return;
                            }

                            if (!sidebarMailDragState && canReorder && !mailboxTarget.isVirtual) {
                              event.preventDefault();
                            }
                          }}
                          onDragLeave={() => {
                            if (sidebarMailDragHoverTargetId === mailboxTarget.id) {
                              setSidebarMailDragHoverTargetId(null);
                            }
                          }}
                          onDrop={(event) => {
                            if (isValidMailDropTarget) {
                              event.preventDefault();
                              event.stopPropagation();
                              void handleSidebarMailDrop(account.id, mailboxTarget);
                              return;
                            }

                            if (sidebarMailDragState || !canReorder || mailboxTarget.isVirtual) {
                              return;
                            }
                            event.preventDefault();
                            if (draggedFolderPath) {
                              reorderFolders(draggedFolderPath, mailboxNode.identity.providerPath);
                            }
                            setDraggedFolderPath(null);
                          }}
                          onDragEnd={() => {
                            setDraggedFolderPath(null);
                            if (sidebarMailDragHoverTargetId === mailboxTarget.id) {
                              setSidebarMailDragHoverTargetId(null);
                            }
                          }}
                        >
                          <div className="folder-row-main">
                            <span
                              className={`folder-row-icon ${
                                sortFolderPresentation
                                  ? `sort-folder-glyph sort-folder-glyph-${sortFolderPresentation.tone}`
                                  : ""
                              }`}
                            >
                              {sortFolderPresentation
                                ? renderSortFolderGlyph(sortFolderPresentation)
                                : renderFolderGlyph(
                                    mailboxTarget.name,
                                    mailboxNode.identity.providerPath
                                  )}
                            </span>
                            <span className="folder-row-labels">
                              <span className="folder-row-name">{mailboxTarget.name}</span>
                              {mobileMailboxRowHint ? (
                                <span className="folder-row-meta">{mobileMailboxRowHint}</span>
                              ) : null}
                            </span>
                          </div>
                          {mailboxTarget.count ? (
                            <span
                              className={`folder-row-count ${isMailboxActive ? "active" : ""}`}
                            >
                              {mailboxTarget.count}
                            </span>
                          ) : null}
                        </div>
                      );
                    };

                    return (
                      <div
                        key={account.id}
                        className={`sidebar-mailbox-group ${
                          isAccountActive ? "active" : ""
                        } ${
                          disclosureAnimation
                            ? `sidebar-mailbox-group-disclosure-${disclosureAnimation.phase}`
                            : ""
                        } ${
                          sidebarMailDragState && persistedDisclosureState < 3
                            ? "sidebar-mailbox-group-drag-expanded"
                            : ""
                        }`}
                        data-disclosure-state={disclosureState}
                      >
                        <div
                          className={`sidebar-mailbox-heading ${
                            isAccountActive ? "active" : ""
                          }`}
                          onClick={cycleDisclosureState}
                        >
                          <div className="sidebar-account-row-info">
                            <div className="sidebar-account-row-label">
                              {account.label || account.email}
                            </div>
                            <div className="sidebar-account-row-email">
                              {isAccountActive ? "Current account" : account.email}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="sidebar-mailbox-disclosure-btn"
                            aria-label={`Show ${
                              disclosureState === 1
                                ? "more"
                                : disclosureState === 2
                                  ? "all"
                                  : "fewer"
                            } folders`}
                            aria-expanded={disclosureState === 3}
                            onClick={(event) => {
                              event.stopPropagation();
                              cycleDisclosureState();
                            }}
                          >
                            <span className="sidebar-mailbox-disclosure-lines">
                              <span
                                className={`sidebar-mailbox-disclosure-line ${
                                  disclosureState >= 1 ? "active" : ""
                                }`}
                              />
                              <span
                                className={`sidebar-mailbox-disclosure-line ${
                                  disclosureState >= 2 ? "active" : ""
                                }`}
                              />
                              <span
                                className={`sidebar-mailbox-disclosure-line ${
                                  disclosureState >= 3 ? "active" : ""
                                }`}
                              />
                            </span>
                          </button>
                        </div>

                        {mailboxTargets.length === 0 ? (
                          <div className="sidebar-folder-empty">No folders loaded yet.</div>
                        ) : (
                          <div className="sidebar-mailbox-content">
                            {animatedVisibleTargets.map((mailboxTarget) =>
                              renderMailboxRow(mailboxTarget)
                            )}
                            {animatedQuietTargets.length > 0 ? (
                              <>
                                <div
                                  className={`sidebar-mailbox-history-divider ${
                                    disclosureAnimation &&
                                    disclosureAnimation.previousQuietIds.length === 0 &&
                                    disclosureAnimation.currentQuietIds.length > 0
                                      ? "sidebar-mailbox-history-divider-entering"
                                      : disclosureAnimation &&
                                          disclosureAnimation.previousQuietIds.length > 0 &&
                                          disclosureAnimation.currentQuietIds.length === 0
                                        ? "sidebar-mailbox-history-divider-exiting"
                                        : ""
                                  }`}
                                />
                                {animatedQuietTargets.map((mailboxTarget) =>
                                  renderMailboxRow(mailboxTarget, { quiet: true })
                                )}
                              </>
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </aside>
        {isWideWorkspace ? (
          <div
            className={`pane-divider ${
              workspaceHoveredDivider === "sidebar" ? "hovered" : ""
            } ${workspaceActiveDivider === "sidebar" ? "active" : ""}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar and message list"
            onMouseDown={(event) => startWorkspacePaneResize("sidebar", event)}
            onMouseEnter={() => setWorkspaceHoveredDivider("sidebar")}
            onMouseLeave={() =>
              setWorkspaceHoveredDivider((current) => (current === "sidebar" ? null : current))
            }
          />
        ) : null}

        <section className={`inbox ${showInboxPane ? "" : "mobile-stacked-pane-hidden"}`}>
          <div className="inbox-header">
            <div className="inbox-header-leading">
              {isMobileStackedMode ? (
                <button
                  type="button"
                  className="mobile-stacked-back-btn"
                  onClick={returnMobileStackedToMailboxes}
                  aria-label="Back to mailboxes"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  <span>Mailboxes</span>
                </button>
              ) : null}
              <div className="inbox-title-block">
                <div className="inbox-folder-line">
                  {currentMailboxLabel}
                </div>
                <div className="inbox-count-line">
                  {(threadingEnabled
                    ? renderedConversationSummaries.length
                    : sortedMessages.length)}{" "}
                  {threadingEnabled ? "threads" : "messages"}
                  {effectiveEmptyAttentionView !== "read" && sortedUnreadCount > 0
                    ? `, ${sortedUnreadCount} unread`
                    : ""}
                  {mailboxRefreshHint?.accountId === activeAccountId &&
                  mailboxRefreshHint?.folderPath === currentFolderPath ? (
                    <>
                      <span className="inbox-count-sep">·</span>
                      <span className="inbox-refresh-hint">
                        Sync issue
                        <button
                          type="button"
                          className="inbox-refresh-retry"
                          onClick={() => {
                            void refreshCurrentFolder(currentFolderPath);
                          }}
                        >
                          Retry
                        </button>
                      </span>
                    </>
                  ) : null}
                </div>
                {mobileMailboxContextHint ? (
                  <div className="mobile-mailbox-context-line">{mobileMailboxContextHint}</div>
                ) : null}
              </div>
            </div>
            <div className="inbox-header-actions">
              <input
                className="inbox-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(normalizeMailboxSearchText(event.target.value))}
                placeholder={searchPlaceholder}
                title={
                  activeSortFolderPresentation
                    ? `Searching within ${activeSortFolderPresentation.label}`
                    : undefined
                }
              />
              {isCurrentTrashView && activeAccountId ? (
                <button
                  className="compose-icon-btn"
                  onClick={() => {
                    void emptyTrashForAccount(activeAccountId, currentFolderPath, currentAccountEmail);
                  }}
                  title="Empty Trash"
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4h6v2" />
                  </svg>
                </button>
              ) : (
                <button className="compose-icon-btn" onClick={openCompose} title="New message">
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <div className="sort-toolbar">
            <span className="sort-label">Sort:</span>
            {(["date", "name", "subject"] as const).map((option) => (
              <button
                key={option}
                className={`sort-btn ${sortBy === option ? "active" : ""}`}
                onClick={() => setSortBy(option)}
              >
                {option.charAt(0).toUpperCase() + option.slice(1)}
              </button>
            ))}
            <div style={{ marginLeft: "auto" }} />
            <button
              className={`sort-btn ${threadingEnabled ? "active" : ""}`}
              onClick={() => setThreadingEnabled((current) => !current)}
              title={threadingEnabled ? "Switch to flat view" : "Switch to threaded view"}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ marginRight: 3 }}
              >
                <line x1="21" y1="10" x2="7" y2="10" />
                <line x1="21" y1="6" x2="3" y2="6" />
                <line x1="21" y1="14" x2="3" y2="14" />
                <line x1="21" y1="18" x2="7" y2="18" />
              </svg>
              {threadingEnabled ? "Threaded" : "Flat"}
            </button>
          </div>

          <div className="col-header-bar">
            {!isPrioritizedSenderView ? (
              <div
                role="button"
                tabIndex={0}
                className={`col-chip ${senderFilter ? "col-chip-active" : ""}`}
                onClick={() => {
                  if (senderFilter) {
                    clearSenderFocus();
                  } else if (pivotMessage) {
                    applySenderPivot(pivotMessage, isSentFolder);
                  }
                }}
              >
                {isSentFolder ? "To" : "From"} <span className="col-chip-icon">⊙</span>
              </div>
            ) : null}
            <div
              role="button"
              tabIndex={0}
              className={`col-chip ${subjectFilter ? "col-chip-active" : ""}`}
              style={{ flex: isPrioritizedSenderView ? 1 : 1.4 }}
              onClick={() => {
                if (subjectFilter) {
                  setSubjectFilter(null);
                  setSubjectPattern(null);
                } else if (pivotMessage) {
                  applySubjectPivot(pivotMessage);
                }
              }}
            >
              Subject <span className="col-chip-icon">⊙</span>
            </div>
            <div className="col-chip col-chip-date">
              Date <span style={{ opacity: 0.5, fontSize: "10px" }}>▾</span>
            </div>
          </div>

          {!isPrioritizedSenderView ? (
            <div className="filter-strip">
              <span className="filter-label">Filter:</span>
              {senderFilter ? (
                <span className="filter-pill">
                  {displaySender(senderFilter)}
                </span>
              ) : null}
              {subjectFilter ? (
                <span className="filter-pill">
                  {subjectPattern ? `${subjectPattern} *` : subjectFilter}
                  {subjectPattern ? (
                    <span className="filter-pattern-badge">wildcard</span>
                  ) : null}
                </span>
              ) : null}
              {!senderFilter && !subjectFilter ? (
                <span className="filter-empty">
                  no active filters — select a message then click {isSentFolder ? "To" : "From"} or Subject to pivot
                </span>
              ) : null}
              {senderFilter || subjectFilter ? (
                <button
                  className="filter-clear-all"
                  title="Clear all filters"
                  onClick={() => {
                    clearSenderFocus();
                    setSubjectFilter(null);
                    setSubjectPattern(null);
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
          ) : null}

          {senderFilter && senderStats && !subjectFilter ? (
            <div className="senderStatBar">
              <div
                className="senderAvatar"
                style={{ backgroundColor: getAvatarColor(senderStats.email) }}
              >
                {getSenderInitials(senderStats.name || senderStats.email)}
              </div>
              <strong>{senderStats.name}</strong>
              <span>{senderStats.total} messages</span>
              <span>{senderStats.unread} unread</span>
              <span>since {formatSinceDate(senderStats.oldestDate)}</span>
            </div>
          ) : null}

          {selectedUids.size > 0 ? (
            <div className="bulk-action-bar">
              <div className="bulk-bar-left">
                <span className="bulk-count">{selectedUids.size} selected</span>
              </div>

              <div className="bulk-bar-right">
                <button
                  type="button"
                  className={`bulk-action-btn ${allVisibleSelected ? "bulk-action-btn-muted" : ""}`}
                  onClick={selectAll}
                  disabled={allVisibleSelected || sortedMessages.length === 0}
                >
                  <span>Select All</span>
                </button>
                <div className="bulk-menu-wrap" ref={bulkSelectionMenu === "sort" ? bulkSortMenuRef : null}>
                  <button
                    type="button"
                    className={`bulk-action-btn bulk-action-btn-sort-primary ${bulkSelectionMenu === "sort" ? "bulk-action-btn-active" : ""}`}
                    title={sortActionTitle}
                    onClick={() =>
                      setBulkSelectionMenu((current) => (current === "sort" ? null : "sort"))
                    }
                  >
                    <span>Sort</span>
                  </button>
                  {bulkSelectionMenu === "sort" ? (
                    <div className="bulk-menu">
                      <div className="action-menu-header">
                        <div className="action-menu-title">Quick Sort</div>
                        <div className="action-menu-sub">
                          Fast-file into the built-in organization folders for {currentActionAccountLabel}.
                        </div>
                      </div>
                      {SORT_FOLDER_PRESETS.map((preset) => {
                        const isCurrentFolder =
                          getSortFolderPresetByMailbox(null, currentFolderPath)?.key === preset.key;

                      return (
                        <button
                          key={preset.key}
                          className="bulk-menu-item"
                          disabled={isCurrentFolder}
                            title={preset.tooltip}
                          onClick={() => {
                            void handleBulkSortToFolder(preset);
                          }}
                        >
                          <span className="bulk-menu-item-label">
                            <span className={`sort-folder-glyph sort-folder-glyph-${preset.tone}`}>
                              {renderSortFolderGlyph(preset)}
                            </span>
                            <span>{preset.label}</span>
                          </span>
                          <span className="bulk-menu-item-sub">
                              {isCurrentFolder ? "Already in this quick-sort folder." : preset.description}
                          </span>
                        </button>
                      );
                    })}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="bulk-action-btn"
                  title={moveActionTitle}
                  onClick={handleBulkMove}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span>Move…</span>
                </button>
                <button
                  type="button"
                  className="bulk-action-btn bulk-action-btn-danger"
                  onClick={() => void handleBulkDelete()}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4h6v2" />
                  </svg>
                  <span>Delete</span>
                </button>
                <div className="bulk-menu-wrap" ref={bulkSelectionMenu === "more" ? bulkMoreMenuRef : null}>
                  <button
                    type="button"
                    className={`bulk-action-btn ${bulkSelectionMenu === "more" ? "bulk-action-btn-active" : ""}`}
                    onClick={() =>
                      setBulkSelectionMenu((current) => (current === "more" ? null : "more"))
                    }
                  >
                    <span>More</span>
                  </button>
                  {bulkSelectionMenu === "more" ? (
                    <div className="bulk-menu bulk-menu-right">
                      <button
                        type="button"
                        className="bulk-menu-item bulk-menu-item-inline"
                        onClick={() => {
                          void handleBulkToggleRead();
                        }}
                      >
                        <span className="bulk-menu-item-label">
                          Mark as {selectedMessages.some((message) => !message.seen) ? "Read" : "Unread"}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="bulk-menu-item bulk-menu-item-inline"
                        onClick={() => {
                          handleBulkBlock();
                        }}
                      >
                        <span className="bulk-menu-item-label">Block Senders</span>
                      </button>
                      <button
                        type="button"
                        className="bulk-menu-item bulk-menu-item-inline"
                        onClick={clearSelection}
                      >
                        <span className="bulk-menu-item-label">Clear Selection</span>
                      </button>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="bulk-action-btn bulk-action-btn-exit"
                  onClick={clearSelection}
                  title="Leave multi-select"
                >
                  <span>Done</span>
                </button>
              </div>
            </div>
          ) : null}

          <div
            className={`messageList ${selectMode ? "select-mode" : ""} ${
              isPrioritizedSenderView ? "messageList-prioritized-view" : ""
            }`}
            onClick={(event) => {
              if (event.target === event.currentTarget && selectedUids.size > 0) {
                clearSelection();
              }
            }}
            onContextMenu={(event) => {
              if (event.target !== event.currentTarget) {
                return;
              }

              event.preventDefault();
              event.stopPropagation();
              setContextMenu(null);
              setListAreaContextMenu({
                x: event.clientX,
                y: event.clientY
              });
            }}
          >
            {!swipeHintShown && isCoarsePointer && swipeFirstMessageList ? (
              <div className="swipe-hint">
                ← Swipe left to delete · Swipe right for actions →
              </div>
            ) : null}
            {mailboxResultState === "empty" ? (
              <div className="empty empty-state">
                {scopedMailboxEmptyState.eyebrow ? (
                  <div className="empty-state-eyebrow">{scopedMailboxEmptyState.eyebrow}</div>
                ) : null}
                <div className="empty-state-title">{scopedMailboxEmptyState.title}</div>
                <div className="empty-state-sub">{scopedMailboxEmptyState.message}</div>
                {scopedMailboxEmptyState.hint ? (
                  <div className="empty-state-hint">{scopedMailboxEmptyState.hint}</div>
                ) : null}
              </div>
            ) : threadingEnabled ? (
              renderedConversationSummaries.map((conversation) => {
                const latestMessage = conversation.latestMessage.raw;
                const conversationMessages = conversations.byId.get(conversation.id)?.messages ?? [];
                const isExpanded = conversationViewState.expandedConversationIds.has(
                  conversation.id
                );
                const isSingleMessage = !conversation.hasMultipleMessages;
                const isSelected = conversationMessages.some(
                  (message) =>
                    message.uid === conversationSelection.selectedMessageUid
                );
                const latestSpoof = detectSpoof(latestMessage).isSpoofed;
                const recipientLabel = isSentFolder
                  ? (() => {
                      const allTo = conversationMessages.flatMap(
                        (message) => message.raw.to ?? []
                      );
                      const unique = Array.from(new Set(allTo));
                      const first = formatSentRowRecipient([unique[0] ?? ""]);
                      return unique.length > 1 ? `${first}, +${unique.length - 1} more` : first;
                    })()
                  : conversation.participantLabels.slice(0, 3).join(", ") +
                    (conversation.participantLabels.length > 3
                      ? ` +${conversation.participantLabels.length - 3}`
                      : "");

                return (
                  <div
                    key={conversation.id}
                    className={`thread-wrap ${isSelected ? "thread-selected" : ""} ${
                      newMailExitingConversationIds.has(conversation.id) ? "new-mail-exit" : ""
                    }`}
                  >
                    <div
                      className={`thread-row ${isSelected ? "selected" : ""} ${
                        conversation.unreadCount > 0 ? "unread" : ""
                      }`}
                      draggable={dragFirstMessageList}
                      onDragStart={
                        dragFirstMessageList
                          ? (event) => {
                              const dragState = buildConversationRowDragState(
                                conversation.id,
                                latestMessage.uid
                              );
                              if (!dragState) {
                                event.preventDefault();
                                return;
                              }

                              beginSidebarMailDrag(
                                event,
                                dragState,
                                dragState.target.scope === "conversation"
                                  ? latestMessage.subject || "Conversation"
                                  : `${dragState.messageCount} messages`
                              );
                            }
                          : undefined
                      }
                      onDragEnd={dragFirstMessageList ? () => clearSidebarMailDrag() : undefined}
                      onClick={() => {
                        if (selectedUids.size > 0) {
                          toggleSelectUid(latestMessage.uid);
                          return;
                        }

                        if (isSingleMessage) {
                          void openMessage(latestMessage.uid);
                        } else {
                          setExpandedConversationIds((current) => {
                            const next = new Set(current);
                            if (isExpanded) {
                              next.delete(conversation.id);
                            } else {
                              next.add(conversation.id);
                            }
                            return next;
                          });
                          void openMessage(latestMessage.uid);
                        }
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setListAreaContextMenu(null);
                        setContextMenu({
                          x: event.clientX,
                          y: event.clientY,
                          msg: latestMessage
                        });
                      }}
                    >
                      <div
                        className={`row-checkbox ${
                          selectedUids.has(latestMessage.uid) ? "checked" : ""
                        }`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleSelectUid(latestMessage.uid);
                        }}
                        role="checkbox"
                        aria-checked={selectedUids.has(latestMessage.uid)}
                        tabIndex={-1}
                      >
                        {selectedUids.has(latestMessage.uid) ? (
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : null}
                      </div>
                      {conversation.unreadCount > 0 ? <div className="unread-dot" /> : null}

                      <div className="thread-avatars">
                        {conversationMessages.slice(0, 3).map((message, index) => (
                          <div
                            key={`${conversation.id}-${message.uid}`}
                            className="thread-avatar"
                            style={{
                              background: getAvatarColor(
                                isSentFolder
                                  ? (message.raw.to?.[0] ?? "")
                                  : message.raw.fromAddress
                              ),
                              zIndex: 3 - index,
                              left: index * 10
                            }}
                          >
                            {getSenderInitials(
                              isSentFolder
                                ? formatSentRowRecipient(message.raw.to)
                                : message.raw.from
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="row-body">
                        <div className="row-top">
                          <div className="row-sender-group">
                            <span className="row-sender">{recipientLabel}</span>

                            {!isSingleMessage ? (
                              <span className="thread-count-badge">
                                {conversation.messageCount}
                              </span>
                            ) : null}

                            {!isSentFolder && latestSpoof ? (
                              <span className="sender-trust-row-warning" title="High Risk sender">
                                ⚠
                              </span>
                            ) : null}

                              {(() => {
                                const type = getSenderType(
                                  latestMessage.from,
                                  latestMessage.fromAddress ?? ""
                                );
                                return type ? (
                                  <span className={`type-chip type-chip-${type}`}>
                                  {type.toUpperCase()}
                                </span>
                              ) : null;
                            })()}

                            {!isSentFolder ? (
                              <button
                                type="button"
                                className="focus-pill"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  applySenderPivot(latestMessage, isSentFolder);
                                }}
                              >
                                ⊙ Focus
                              </button>
                            ) : null}
                          </div>

                          <span className="row-date">
                            {formatTimestamp(conversation.latestDate)}
                          </span>
                        </div>

                        <div
                          className="row-subject"
                          style={{ fontWeight: conversation.unreadCount > 0 ? 600 : 400 }}
                        >
                          {isSentFolder ? <span className="row-to-label">To:</span> : null}
                          {conversation.subject || latestMessage.subject}
                        </div>

                        <div className="thread-snippet">
                          {conversation.preview ?? ""}
                        </div>
                      </div>

                      {!isSingleMessage ? (
                        <svg
                          className={`thread-chevron ${isExpanded ? "open" : ""}`}
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      ) : null}
                    </div>

                    {isExpanded && !isSingleMessage ? (
                      <div className="thread-expanded">
                        {conversationMessages.map((message) => (
                          <div
                            key={`${conversation.id}-child-${message.uid}`}
                            className={`thread-msg-row ${
                              selectedMessage?.uid === message.uid ? "active" : ""
                            } ${!message.raw.seen ? "unread" : ""}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              void openMessage(message.uid);
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setListAreaContextMenu(null);
                              setContextMenu({
                                x: event.clientX,
                                y: event.clientY,
                                msg: message.raw
                              });
                            }}
                          >
                            <div className="thread-msg-connector">
                              <div className="thread-msg-line" />
                              <div className="thread-msg-dot" />
                            </div>
                            <div
                              className="thread-msg-avatar"
                              style={{ background: getAvatarColor(message.raw.fromAddress) }}
                            >
                              {getSenderInitials(message.raw.from)}
                            </div>
                            <div className="thread-msg-body">
                              <div className="thread-msg-from">
                                {displaySender(message.raw.from)}
                                {!message.raw.seen ? (
                                  <span className="thread-msg-unread-dot" />
                                ) : null}
                              </div>
                              <div className="thread-msg-subj">{message.raw.subject}</div>
                            </div>
                            <div className="thread-msg-meta">
                              <div className="thread-msg-date">
                                {formatTimestamp(message.raw.date)}
                              </div>
                              <div className="thread-msg-actions">
                                <button
                                  type="button"
                                  className="thread-msg-action-btn"
                                  title="Reply"
                                  onClick={async (event) => {
                                    event.stopPropagation();
                                    const detail = await resolveMessageDetail(message.raw);
                                    handleReply(detail);
                                  }}
                                >
                                  Reply
                                </button>
                                <button
                                  type="button"
                                  className="thread-msg-action-btn"
                                  title={getReadToggleActionCopy(message.raw.seen, {
                                    concise: true
                                  }).title}
                                  onClick={async (event) => {
                                    event.stopPropagation();
                                    const detail = await resolveMessageDetail(message.raw);
                                    await handleToggleRead(detail);
                                  }}
                                >
                                  {getReadToggleActionCopy(message.raw.seen, {
                                    concise: true
                                  }).label}
                                </button>
                                <button
                                  type="button"
                                  className="thread-msg-action-btn thread-msg-action-danger"
                                  title="Delete"
                                  onClick={async (event) => {
                                    event.stopPropagation();
                                    const detail = await resolveMessageDetail(message.raw);
                                    await handleDeleteOne(detail);
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              sortedMessages.map((message) => (
                <SwipeRow
                  key={message.uid}
                  message={message}
                  selected={message.uid === selectedUid}
                  exiting={newMailExitingMessageUids.has(message.uid)}
                  dragEnabled={dragFirstMessageList}
                  swipeEnabled={swipeFirstMessageList}
                  isSentFolder={isSentFolder}
                  isChecked={selectedUids.has(message.uid)}
                  activeSwipeUid={activeSwipeUid}
                  setActiveSwipeUid={setActiveSwipeUid}
                  onOpen={() => {
                    if (selectedUids.size > 0) {
                      toggleSelectUid(message.uid);
                      return;
                    }
                    void openMessage(message.uid);
                  }}
                  onSelect={() => toggleSelectUid(message.uid)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setActiveSwipeUid(null);
                    setListAreaContextMenu(null);
                    setContextMenu({ x: event.clientX, y: event.clientY, msg: message });
                  }}
                  onDragStart={(event) => {
                    const dragState = buildMessageRowDragState(message);
                    if (!dragState) {
                      event.preventDefault();
                      return;
                    }

                    beginSidebarMailDrag(
                      event,
                      dragState,
                      dragState.messageCount === 1 ? message.subject || "Message" : `${dragState.messageCount} messages`
                    );
                  }}
                  onDragEnd={() => clearSidebarMailDrag()}
                  onFocus={() => applySenderPivot(message, isSentFolder)}
                  onDelete={() => {
                    setDeleteTarget(message);
                  }}
                  onToggleRead={() => {
                    if (!activeAccountId) {
                      setStatus("Connect an account first.");
                      return;
                    }

                    void dispatchMailAction({
                      kind: message.seen ? "mark_unread" : "mark_read",
                      accountId: activeAccountId,
                      folderPath: currentFolderPath,
                      target: createMessageActionTarget(message.uid)
                    });
                  }}
                />
              ))
            )}
          </div>
        </section>
        {isWideWorkspace ? (
          <div
            className={`pane-divider ${
              workspaceHoveredDivider === "list" ? "hovered" : ""
            } ${workspaceActiveDivider === "list" ? "active" : ""}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize message list and reader"
            onMouseDown={(event) => startWorkspacePaneResize("list", event)}
            onMouseEnter={() => setWorkspaceHoveredDivider("list")}
            onMouseLeave={() =>
              setWorkspaceHoveredDivider((current) => (current === "list" ? null : current))
            }
          />
        ) : null}

        <section className={`viewer ${showViewerPane ? "" : "mobile-stacked-pane-hidden"}`}>
          {isMobileStackedMode ? (
            <div className="mobile-stacked-viewer-bar">
              <button
                type="button"
                className="mobile-stacked-back-btn"
                onClick={returnMobileStackedToMessages}
                aria-label="Back to messages"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                <span>{currentMailboxLabel}</span>
              </button>
              {selectedMessage ? renderMobileViewerActions(selectedMessage) : null}
            </div>
          ) : null}
          {selectedMessage ? showConversationView ? (
            <article className="messageDetail thread-conversation">
              {activeConversation && !isMobileStackedMode ? (
                <div className="thread-conversation-toolbar-wrap">
                  <div className="thread-conversation-summary">
                    <span className="thread-conversation-summary-title">
                      Conversation
                    </span>
                    <span className="thread-conversation-summary-meta">
                      {activeConversation.messageCount} messages
                      {activeConversation.unreadCount > 0
                        ? ` · ${activeConversation.unreadCount} unread`
                        : ""}
                    </span>
                  </div>
                  <div className="email-toolbar thread-conversation-toolbar">
                    {mailActionCapabilities.archive.supported ? (
                      <button
                        className="tb-btn"
                        title="Archive conversation"
                        disabled={mailActionBusy}
                        onClick={() =>
                          void dispatchConversationAction("archive", activeConversation.id, {
                            destinationFolder: mailActionCapabilities.archive.destinationFolder,
                            toastMessage: "Conversation archived"
                          })
                        }
                      >
                        <span>Archive</span>
                      </button>
                    ) : null}
                    <button
                      className="tb-btn"
                      title={getReadToggleActionCopy(activeConversation.unreadCount === 0, {
                        scope: "conversation"
                      }).title}
                      disabled={mailActionBusy}
                      onClick={() =>
                        void dispatchConversationAction(
                          activeConversation.unreadCount > 0
                            ? "mark_read"
                            : "mark_unread",
                          activeConversation.id
                        )
                      }
                      >
                        <span>
                          {
                            getReadToggleActionCopy(activeConversation.unreadCount === 0, {
                              scope: "conversation"
                            }).label
                          }
                        </span>
                      </button>
                    {mailActionCapabilities.move.supported ? (
                      <button
                        className="tb-btn"
                        title="Move conversation"
                        disabled={mailActionBusy}
                        onClick={() => openConversationMove(activeConversation.id)}
                      >
                        <span>Move</span>
                      </button>
                    ) : null}
                    <button
                      className="tb-btn tb-btn-danger"
                      title="Delete conversation"
                      disabled={mailActionBusy}
                      onClick={() =>
                        void dispatchConversationAction("delete", activeConversation.id)
                      }
                    >
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="thread-conversation-list">
                {activeConversationMessages.map((message) => {
                  const detail =
                    selectedMessage.uid === message.uid
                      ? selectedMessage
                      : cleanupPreviewCache[message.uid];
                  const isExpanded = conversationViewState.expandedMessageUids.has(
                    message.uid
                  );
                  return (
                    <section
                      key={`thread-view-${message.uid}`}
                      className={`thread-view-item ${
                        selectedMessage.uid === message.uid ? "active" : ""
                      } ${effectivePrintTargetUid === message.uid ? "print-target" : ""}`}
                      onClick={() => {
                        if (selectedMessage.uid !== message.uid) {
                          void openMessage(message.uid);
                        }
                      }}
                    >
                      <div className="email-sender-block">
                        {renderSenderAvatar(message)}
                        <div className="email-sender-meta">
                          <div className="email-sender-name-row">
                            <span className="email-sender-name">
                              {displaySender(message.from)}
                            </span>
                            <span className="email-inbox-label">
                              📁 {currentMailboxLabel} · {currentAccountEmail || "Mail"}
                            </span>
                            {isSentFolder ? <span className="sent-folder-chip">✓ Sent</span> : null}
                          </div>
                          <div className="email-sender-address">
                            {message.fromAddress || message.from}
                          </div>
                          {renderSenderTrustSummary(message, { hidden: isSentFolder })}
                          <div className="email-to-row">
                            <span className="email-meta-key">To:</span>
                            <span className="email-meta-val">
                              {detail?.to.join(", ") || "me"}
                            </span>
                          </div>
                        </div>
                        <div className="email-date-block">
                          <div className="email-date-str">
                            {message.date
                              ? new Date(message.date).toLocaleString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit"
                                })
                              : ""}
                          </div>
                          <button
                            type="button"
                            className="thread-view-toggle"
                            onClick={(event) => {
                              event.stopPropagation();
                              setExpandedConversationMessageUids((current) => {
                                const next = new Set(current);
                                if (next.has(message.uid)) {
                                  next.delete(message.uid);
                                } else {
                                  next.add(message.uid);
                                }
                                return next;
                              });
                            }}
                          >
                            {isExpanded ? "Collapse" : "Expand"}
                          </button>
                        </div>
                      </div>

                      <div className="email-subject-bar">{message.subject}</div>

                      {isExpanded ? renderPrintEmailHeader(message, detail ?? null) : null}

                      {isExpanded && !isMobileStackedMode ? (
                      <div className="email-toolbar">
                        <button
                          className="tb-btn"
                          title="Reply"
                          onClick={async (event) => {
                            event.stopPropagation();
                            const resolved = await resolveMessageDetail(message);
                            handleReply(resolved);
                          }}
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="9 17 4 12 9 7" />
                            <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                          </svg>
                          <span>Reply</span>
                        </button>
                        <button
                          className="tb-btn"
                          title="Reply All"
                          onClick={async (event) => {
                            event.stopPropagation();
                            const resolved = await resolveMessageDetail(message);
                            handleReplyAll(resolved);
                          }}
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="7 17 2 12 7 7" />
                            <polyline points="12 17 7 12 12 7" />
                            <path d="M22 18v-2a4 4 0 0 0-4-4H7" />
                          </svg>
                          <span>Reply All</span>
                        </button>
                        <button
                          className="tb-btn"
                          title="Forward"
                          onClick={async (event) => {
                            event.stopPropagation();
                            const resolved = await resolveMessageDetail(message);
                            handleForward(resolved);
                          }}
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="15 17 20 12 15 7" />
                            <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
                          </svg>
                          <span>Forward</span>
                        </button>
                        <button
                          className="tb-btn"
                          title="Edit as New"
                          onClick={async (event) => {
                            event.stopPropagation();
                            const resolved = await resolveMessageDetail(message);
                            handleEditAsNew(resolved);
                          }}
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                          <span>Edit as New</span>
                        </button>

                        <div className="tb-sep" />

                        <button
                          className="tb-btn"
                          title="Archive"
                          onClick={async (event) => {
                            event.stopPropagation();
                            const resolved = await resolveMessageDetail(message);
                            await handleArchive(resolved);
                          }}
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="21 8 21 21 3 21 3 8" />
                            <rect x="1" y="3" width="22" height="5" />
                            <line x1="10" y1="12" x2="14" y2="12" />
                          </svg>
                          <span>Archive</span>
                        </button>
                        <button
                          className="tb-btn tb-btn-danger"
                          title="Delete"
                          onClick={async (event) => {
                            event.stopPropagation();
                            const resolved = await resolveMessageDetail(message);
                            await handleDeleteOne(resolved);
                          }}
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4h6v2" />
                          </svg>
                          <span>Delete</span>
                        </button>
                        <button
                          className="tb-btn"
                          title="Mark as Spam"
                          onClick={async (event) => {
                            event.stopPropagation();
                            const resolved = await resolveMessageDetail(message);
                            await handleSpam(resolved);
                          }}
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                          </svg>
                          <span>Spam</span>
                        </button>

                        <div className="tb-sep" />

                        <button
                          className="tb-btn"
                          title={getReadToggleActionCopy(message.seen).title}
                          onClick={async (event) => {
                            event.stopPropagation();
                            const resolved = await resolveMessageDetail(message);
                            await handleToggleRead(resolved);
                          }}
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                          </svg>
                          <span>{getReadToggleActionCopy(message.seen).label}</span>
                        </button>
                        <button
                          className="tb-btn"
                          title={moveActionTitle}
                          onClick={async (event) => {
                            event.stopPropagation();
                            const resolved = await resolveMessageDetail(message);
                            handleMove(resolved);
                          }}
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                          <span>Move…</span>
                        </button>
                        {renderSortButton(message, { stopPropagation: true })}
                        <button
                          className="tb-btn"
                          title="Print"
                          onClick={(event) => {
                            event.stopPropagation();
                            openPrintModal(message.uid);
                          }}
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M6 9V3h12v6" />
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                            <rect x="6" y="14" width="12" height="7" rx="1" />
                            <line x1="8" y1="7" x2="16" y2="7" />
                          </svg>
                          <span>Print</span>
                        </button>
                      </div>
                      ) : null}

                      {isExpanded ? detail ? (
                        <div className="thread-view-body">
                          <iframe
                            title={`Email body for ${message.subject}`}
                            className="messageBodyFrame thread-view-frame"
                            srcDoc={detail.emailBody}
                            sandbox="allow-same-origin"
                            style={{ width: "100%", height: "100%", border: "none" }}
                            onLoad={(event) =>
                              handleEmailFrameLoad(event.currentTarget, detail.media ?? [])
                            }
                          />
                        </div>
                      ) : (
                        <div className="thread-view-loading">Loading message…</div>
                      ) : (
                        <div className="thread-view-collapsed-preview">
                          {message.preview || "Select to load this message."}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            </article>
          ) : (
            <article className="messageDetail">
              <div className="email-sender-block">
                {renderSenderAvatar(selectedMessage)}
                <div className="email-sender-meta">
                  <div className="email-sender-name-row">
                    <span className="email-sender-name">
                      {displaySender(selectedMessage.from)}
                    </span>
                    <span className="email-inbox-label">
                      📁 {currentMailboxLabel} · {currentAccountEmail || "Mail"}
                    </span>
                    {isSentFolder ? <span className="sent-folder-chip">✓ Sent</span> : null}
                  </div>
                  <div className="email-sender-address">
                    {selectedMessage.fromAddress || selectedMessage.from}
                  </div>
                  {renderSenderTrustSummary(selectedMessage, { hidden: isSentFolder })}
                  <div className="email-to-row">
                    <span className="email-meta-key">To:</span>
                    <span className="email-meta-val">
                      {selectedMessage.to.join(", ") || "me"}
                    </span>
                  </div>
                </div>
                <div className="email-date-block">
                  <div className="email-date-str">
                    {selectedMessage.date
                      ? new Date(selectedMessage.date).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit"
                        })
                      : ""}
                  </div>
                </div>
              </div>

              <div className="email-subject-bar">{selectedMessage.subject}</div>

              {renderPrintEmailHeader(selectedMessage, selectedMessage)}

              {!isMobileStackedMode ? (
              <div className="email-toolbar">
                <button
                  className="tb-btn"
                  title="Reply"
                  onClick={() => handleReply(selectedMessage)}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="9 17 4 12 9 7" />
                    <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                  </svg>
                  <span>Reply</span>
                </button>
                <button
                  className="tb-btn"
                  title="Reply All"
                  onClick={() => handleReplyAll(selectedMessage)}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="7 17 2 12 7 7" />
                    <polyline points="12 17 7 12 12 7" />
                    <path d="M22 18v-2a4 4 0 0 0-4-4H7" />
                  </svg>
                  <span>Reply All</span>
                </button>
                <button
                  className="tb-btn"
                  title="Forward"
                  onClick={() => handleForward(selectedMessage)}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="15 17 20 12 15 7" />
                    <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
                  </svg>
                  <span>Forward</span>
                </button>
                <button
                  className="tb-btn"
                  title="Edit as New"
                  onClick={() => handleEditAsNew(selectedMessage)}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                  <span>Edit as New</span>
                </button>

                <div className="tb-sep" />

                <button
                  className="tb-btn"
                  title="Archive"
                  onClick={() => handleArchive(selectedMessage)}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="21 8 21 21 3 21 3 8" />
                    <rect x="1" y="3" width="22" height="5" />
                    <line x1="10" y1="12" x2="14" y2="12" />
                  </svg>
                  <span>Archive</span>
                </button>
                <button
                  className="tb-btn tb-btn-danger"
                  title="Delete"
                  onClick={() => handleDeleteOne(selectedMessage)}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4h6v2" />
                  </svg>
                  <span>Delete</span>
                </button>
                <button
                  className="tb-btn"
                  title="Mark as Spam"
                  onClick={() => handleSpam(selectedMessage)}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>Spam</span>
                </button>

                <div className="tb-sep" />

                <button
                  className="tb-btn"
                  title={getReadToggleActionCopy(selectedMessage.seen).title}
                  onClick={() => handleToggleRead(selectedMessage)}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                  <span>{getReadToggleActionCopy(selectedMessage.seen).label}</span>
                </button>
                <button
                  className="tb-btn"
                  title={moveActionTitle}
                  onClick={() => handleMove(selectedMessage)}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span>Move…</span>
                </button>
                {renderSortButton(selectedMessage)}
                <button
                  className="tb-btn"
                  title="Print"
                  onClick={() => openPrintModal(selectedMessage.uid)}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 9V3h12v6" />
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                    <rect x="6" y="14" width="12" height="7" rx="1" />
                    <line x1="8" y1="7" x2="16" y2="7" />
                  </svg>
                  <span>Print</span>
                </button>
                {(() => {
                  const unsub = detectUnsubscribe(selectedMessage);
                  const unsubscribeEmail = selectedMessage.listUnsubscribeEmail?.trim() ?? "";
                  const canOpenLink = unsub.found && Boolean(unsub.url);
                  const canSendEmail = unsubscribeEmail.length > 0;

                  if (!canOpenLink && !canSendEmail) return null;

                  return (
                    <>
                      <div className="tb-sep" />
                      <div className="tb-unsub-wrap">
                        <button
                          className={`tb-btn tb-btn-unsub${unsubscribeConfirm ? " tb-btn-unsub-active" : ""}`}
                          title="Unsubscribe from this sender"
                          onClick={() => setUnsubscribeConfirm((v) => !v)}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                          </svg>
                          <span>Unsubscribe</span>
                        </button>
                        {unsubscribeConfirm ? (
                          <div className="tb-unsub-confirm">
                            <span className="tb-unsub-confirm-text">
                              {canOpenLink ? (
                                <>
                                  Open unsubscribe link for <strong>{selectedMessage.from}</strong>?
                                </>
                              ) : (
                                <>
                                  Send an unsubscribe email to{" "}
                                  <strong>{unsubscribeEmail}</strong>?
                                </>
                              )}
                            </span>
                            <div className="tb-unsub-confirm-actions">
                              <button
                                className="tb-unsub-confirm-btn"
                                onClick={() => {
                                  if (canOpenLink && unsub.url) {
                                    window.open(unsub.url, "_blank", "noopener,noreferrer");
                                    setUnsubscribeConfirm(false);
                                    showToast(
                                      `Unsubscribe link opened for ${selectedMessage.from}`
                                    );
                                    return;
                                  }

                                  if (canSendEmail) {
                                    handleUnsubscribeByEmail(selectedMessage);
                                  }
                                }}
                              >
                                {canOpenLink ? "Open link" : "Send unsubscribe email"}
                              </button>
                              {canOpenLink && canSendEmail ? (
                                <button
                                  className="tb-unsub-email-link"
                                  onClick={() => handleUnsubscribeByEmail(selectedMessage)}
                                >
                                  or send unsubscribe email
                                </button>
                              ) : null}
                              <button
                                className="tb-unsub-cancel-btn"
                                onClick={() => setUnsubscribeConfirm(false)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </>
                  );
                })()}
              </div>
              ) : null}

              {suspiciousLinks.length > 0 ? (
                <div className="suspicious-links-banner">
                  <span className="suspicious-links-icon">🔗</span>
                  <span className="suspicious-links-text">
                    {suspiciousLinks.length} link{suspiciousLinks.length > 1 ? "s" : ""} in
                    this message {suspiciousLinks.length > 1 ? "were" : "was"} flagged by
                    Google Safe Browsing. Do not click links in this message.
                  </span>
                </div>
              ) : null}

              <div className="messageBody">
                <iframe
                  title={`Email body for ${selectedMessage.subject}`}
                  className="messageBodyFrame"
                  srcDoc={selectedMessage.emailBody}
                  sandbox="allow-same-origin"
                  style={{ width: "100%", height: "100%", border: "none", flexGrow: 1 }}
                  onLoad={(event) =>
                    handleEmailFrameLoad(event.currentTarget, selectedMessage.media ?? [])
                  }
                />
              </div>
            </article>
          ) : (
            <div className="detail-empty">
              <div className="detail-empty-text">No message selected</div>
            </div>
          )}
        </section>

        {cleanupMode
          ? (() => {
              type SenderGroup = {
                name: string;
                email: string;
                color: string;
                messages: MailSummary[];
                unread: number;
              };

              const senderGroups = Object.values(
                messages.reduce<Record<string, SenderGroup>>((accumulator, message) => {
                  const key = message.from;

                  if (!accumulator[key]) {
                    accumulator[key] = {
                      name: message.from,
                      email: message.fromAddress ?? "",
                      color: getAvatarColor(message.from),
                      messages: [],
                      unread: 0
                    };
                  }

                  accumulator[key].messages.push(message);

                  if (!message.seen) {
                    accumulator[key].unread += 1;
                  }

                  return accumulator;
                }, {})
              ).sort((left, right) => right.messages.length - left.messages.length);

              return (
                <div className="cleanup-overlay">
                  <div className="cleanup-header">
                    <div className="cleanup-title">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4h6v2" />
                      </svg>
                      Cleanup Mode
                    </div>
                    <div className="cleanup-meta">
                      {messages.length} messages · {senderGroups.length} senders
                    </div>
                    <button className="cleanup-close" onClick={() => setCleanupMode(false)}>
                      Done
                    </button>
                  </div>

                  <div className="cleanup-list">
                    {senderGroups.map((group) => {
                      const oldest = [...group.messages].sort(
                        (left, right) =>
                          new Date(left.date).getTime() - new Date(right.date).getTime()
                      )[0];
                      const sortedMessages = [...group.messages].sort(
                        (left, right) =>
                          new Date(right.date).getTime() - new Date(left.date).getTime()
                      );

                      return (
                        <div key={group.name} className="cleanup-row-wrap">
                          <div
                            className={`cleanup-row ${
                              cleanupExpandedSender === group.name ? "expanded" : ""
                            }`}
                            onClick={() => {
                              setCleanupExpandedMsg(null);
                              setCleanupExpandedSender(
                                cleanupExpandedSender === group.name ? null : group.name
                              );
                            }}
                          >
                            <div
                              className="cleanup-row-avatar"
                              style={{ background: group.color }}
                            >
                              {getSenderInitials(group.name)}
                            </div>
                            <div className="cleanup-row-info">
                              <div className="cleanup-row-name">
                                {displaySender(group.name)}
                              </div>
                              <div className="cleanup-row-meta">
                                {group.messages.length} messages
                                {group.unread > 0 ? (
                                  <span className="cleanup-unread">
                                    {group.unread} unread
                                  </span>
                                ) : null}
                                · since{" "}
                                {oldest
                                  ? new Date(oldest.date).toLocaleDateString(undefined, {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric"
                                    })
                                  : "—"}
                              </div>
                            </div>
                            <div
                              className="cleanup-row-actions"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <div
                                className="tb-sort-wrap cleanup-sort-wrap"
                                ref={cleanupSortMenuSender === group.name ? cleanupSortMenuRef : null}
                              >
                                <button
                                  className={`cleanup-action-btn cleanup-action-btn-sort ${
                                    cleanupSortMenuSender === group.name ? "cleanup-action-btn-active" : ""
                                  }`}
                                  title={sortActionTitle}
                                  onClick={() =>
                                    setCleanupSortMenuSender((current) =>
                                      current === group.name ? null : group.name
                                    )
                                  }
                                >
                                  <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M3 7h12" />
                                    <path d="M3 12h18" />
                                    <path d="M3 17h10" />
                                    <path d="m17 5 4 4-4 4" />
                                  </svg>
                                  Sort
                                </button>
                                {cleanupSortMenuSender === group.name ? (
                                  <div
                                    className="tb-sort-menu cleanup-sort-menu"
                                    onClick={(event) => event.stopPropagation()}
                                    onMouseDown={(event) => event.stopPropagation()}
                                  >
                                    <div className="action-menu-header">
                                      <div className="action-menu-title">Quick Sort</div>
                                      <div className="action-menu-sub">
                                        Fast-file this sender into your built-in organization folders.
                                      </div>
                                    </div>
                                    {SORT_FOLDER_PRESETS.map((preset) => (
                                      <button
                                        key={`${group.name}-${preset.key}`}
                                        className="tb-sort-item"
                                        title={preset.tooltip}
                                        onClick={() => {
                                          void handleCleanupSortToFolder(
                                            group.name,
                                            group.messages,
                                            preset
                                          );
                                        }}
                                      >
                                        <span className="tb-sort-item-label">
                                          <span
                                            className={`sort-folder-glyph sort-folder-glyph-${preset.tone}`}
                                          >
                                            {renderSortFolderGlyph(preset)}
                                          </span>
                                          <span>{preset.label}</span>
                                        </span>
                                        <span className="tb-sort-item-sub">{preset.description}</span>
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                              <button
                                className="cleanup-action-btn"
                                onClick={() =>
                                  openAutoFilterEditor({
                                    name: group.messages[0]?.from ?? group.name,
                                    email: group.messages[0]?.fromAddress ?? ""
                                  })
                                }
                              >
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <circle cx="12" cy="12" r="10" />
                                  <polyline points="12 6 12 12 16 14" />
                                </svg>
                                Keep Recent
                              </button>
                              <button
                                className="cleanup-action-btn cleanup-action-danger"
                                onClick={() => setDeleteTarget(group.messages[0])}
                              >
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                </svg>
                                Delete All
                              </button>
                            </div>
                            <div className="cleanup-row-right">
                              <span className="cleanup-row-count">{group.messages.length}</span>
                              <svg
                                className={`cleanup-chevron ${
                                  cleanupExpandedSender === group.name ? "open" : ""
                                }`}
                                width="13"
                                height="13"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </div>
                          </div>

                          {cleanupExpandedSender === group.name ? (
                            <div className="cleanup-expanded">
                              {sortedMessages.map((message) => {
                                const previewDetail = cleanupPreviewCache[message.uid];

                                return (
                                  <Fragment key={message.uid}>
                                    <div
                                      className={`cleanup-msg-row ${
                                        !message.seen ? "unread" : ""
                                      }`}
                                      onClick={async (event) => {
                                        event.stopPropagation();
                                        const nextExpanded =
                                          cleanupExpandedMsg === message.uid ? null : message.uid;
                                        setCleanupExpandedMsg(nextExpanded);

                                        if (nextExpanded === message.uid && !previewDetail) {
                                          try {
                                            await loadCleanupPreview(message.uid);
                                          } catch (error) {
                                            console.error("Cleanup preview failed:", error);
                                            setStatus("Could not load that message preview.");
                                          }
                                        }
                                      }}
                                    >
                                      <div className="cleanup-msg-icon-wrap">
                                        <svg
                                          className="cleanup-msg-icon"
                                          width="13"
                                          height="13"
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="1.8"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        >
                                          <rect x="2" y="4" width="20" height="16" rx="2" />
                                          <path d="M2 7l10 7 10-7" />
                                        </svg>
                                        {!message.seen ? (
                                          <span className="cleanup-unread-dot-abs" />
                                        ) : null}
                                      </div>
                                      <div className="cleanup-msg-subject">{message.subject}</div>
                                      <div className="cleanup-msg-date">
                                        {new Date(message.date).toLocaleDateString(undefined, {
                                          month: "short",
                                          day: "numeric"
                                        })}
                                      </div>
                                      <button
                                        className="cleanup-msg-delete"
                                        title="Delete"
                                        onClick={async (event) => {
                                          event.stopPropagation();
                                          setMessages((current) =>
                                            current.filter((entry) => entry.uid !== message.uid)
                                          );
                                          void removeCachedMessage(
                                            makeCachedMessageId(
                                              message.uid,
                                              currentFolderPath,
                                              activeAccountId ?? ""
                                            )
                                          );
                                          setCleanupExpandedMsg((current) =>
                                            current === message.uid ? null : current
                                          );

                                          if (selectedUid === message.uid) {
                                            setSelectedMessage(null);
                                            setSelectedUid(null);
                                          }

                                          try {
                                            await postJson<{
                                              success: true;
                                              deletedCount: number;
                                              movedToTrash: boolean;
                                            }>(`/api/accounts/${activeAccountId}/bulk-delete`, {
                                              folder: currentFolderPath,
                                              uids: [message.uid],
                                              moveToTrash: true
                                            });
                                            await refreshFolderCounts(activeAccountId ?? undefined);
                                          } catch (error) {
                                            console.error("Cleanup delete failed:", error);
                                            setStatus("Could not move that message to Trash.");
                                          }
                                        }}
                                      >
                                        ×
                                      </button>
                                    </div>

                                    {cleanupExpandedMsg === message.uid ? (
                                      <div
                                        className="cleanup-msg-preview"
                                        onClick={(event) => event.stopPropagation()}
                                      >
                                        <div className="cleanup-msg-preview-meta">
                                          <span className="cleanup-preview-from">
                                            {message.from}
                                          </span>
                                          <span className="cleanup-preview-date">
                                            {new Date(message.date).toLocaleString(undefined, {
                                              month: "short",
                                              day: "numeric",
                                              hour: "numeric",
                                              minute: "2-digit"
                                            })}
                                          </span>
                                        </div>
                                        <iframe
                                          className="cleanup-msg-iframe"
                                          srcDoc={
                                            previewDetail?.emailBody ??
                                            `<pre style="font-family:inherit;font-size:13px;line-height:1.6;padding:0;margin:0;white-space:pre-wrap;">${
                                              message.preview || "No content available."
                                            }</pre>`
                                          }
                                          sandbox="allow-same-origin"
                                          onLoad={(event) => {
                                            const iframe = event.currentTarget;
                                            const height = iframe.contentDocument?.body?.scrollHeight;
                                            if (height) {
                                              iframe.style.height = `${height + 24}px`;
                                            }
                                          }}
                                        />
                                        <div className="cleanup-msg-preview-actions">
                                          <button
                                            className="cleanup-preview-btn"
                                            onClick={async () => {
                                              await openMessage(message.uid);
                                              setCleanupExpandedMsg(null);
                                            }}
                                          >
                                            Open full message
                                          </button>
                                          <button
                                            className="cleanup-preview-btn"
                                            onClick={async () => {
                                              try {
                                                const detail =
                                                  previewDetail ?? (await loadCleanupPreview(message.uid));
                                                handleReply(detail);
                                              } catch (error) {
                                                console.error("Cleanup reply failed:", error);
                                                setStatus("Could not prepare a reply.");
                                              }
                                            }}
                                          >
                                            ↩ Reply
                                          </button>
                                          <button
                                            className="cleanup-preview-btn cleanup-preview-btn-danger"
                                            onClick={async (event) => {
                                              event.stopPropagation();
                                              setMessages((current) =>
                                                current.filter((entry) => entry.uid !== message.uid)
                                              );
                                              void removeCachedMessage(
                                                makeCachedMessageId(
                                                  message.uid,
                                                  currentFolderPath,
                                                  activeAccountId ?? ""
                                                )
                                              );
                                              setCleanupExpandedMsg(null);

                                              if (selectedUid === message.uid) {
                                                setSelectedMessage(null);
                                                setSelectedUid(null);
                                              }

                                              try {
                                                await postJson<{
                                                  success: true;
                                                  deletedCount: number;
                                                  movedToTrash: boolean;
                                                }>(`/api/accounts/${activeAccountId}/bulk-delete`, {
                                                  folder: currentFolderPath,
                                                  uids: [message.uid],
                                                  moveToTrash: true
                                                });
                                                await refreshFolderCounts(activeAccountId ?? undefined);
                                              } catch (error) {
                                                console.error("Cleanup preview delete failed:", error);
                                                setStatus("Could not move that message to Trash.");
                                              }
                                            }}
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      </div>
                                    ) : null}
                                  </Fragment>
                                );
                })}
              </div>
            ) : null}

          </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()
          : null}
      </section>

      {contextMenu ? (
        (() => {
          const senderFilterValue = getSenderFilterValue(contextMenu.msg);
          const senderMessages = getScopedSenderMessages(senderFilterValue);

          return (
            <div
              className="ctx-menu"
              style={{ top: clampedY, left: clampedX }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="ctx-header">
                <div className="ctx-sender-name">{contextMenu.msg.from}</div>
                <div className="ctx-sender-email">{contextMenu.msg.fromAddress}</div>
              </div>
              <div
                className="ctx-item"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  selectAll();
                  setContextMenu(null);
                }}
              >
                <span className="ctx-icon">✓</span> Select All in View
                <span className="ctx-badge">{selectableVisibleMessageUids.length}</span>
              </div>
              <div className="ctx-sep" />
              <div
                className="ctx-item"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const already = prioritizedSenders.find(
                    (sender) => sender.name === contextMenu.msg.from
                  );

                  if (!already) {
                    const nextSender = {
                      name: contextMenu.msg.from,
                      email: contextMenu.msg.fromAddress ?? "",
                      color: getAvatarColor(contextMenu.msg.from)
                    };
                    const updatedList = [...prioritizedSenders, nextSender];
                    setPrioritizedSenders(updatedList);
                    if (activeAccountId) {
                      syncServerPreferences(activeAccountId, {
                        prioritizedSenders: updatedList
                      });
                    }
                  }

                  setContextMenu(null);
                }}
              >
                <span className="ctx-icon">★</span>
                {prioritizedSenders.find((sender) => sender.name === contextMenu.msg.from)
                  ? "Already Prioritized"
                  : "Prioritize Sender"}
              </div>
              <div className="ctx-sep" />
              <div
                className="ctx-item"
                onClick={() => {
                  applySenderPivot(contextMenu.msg, isSentFolder);
                  setContextMenu(null);
                }}
              >
                <span className="ctx-icon">⊙</span>{" "}
                {isSentFolder ? "Focus on This Recipient" : "Focus on This Sender"}
              </div>
              <div className="ctx-item" onClick={() => setContextMenu(null)}>
                <span className="ctx-icon">🔕</span> Mute Sender
              </div>
              <div className="ctx-sep" />
              <div className="ctx-submenu-wrap">
                <div
                  className="ctx-item ctx-item-submenu"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  <span className="ctx-icon">↗</span> Quick Sort
                  <span className="ctx-submenu-arrow">›</span>
                </div>
                <div className="ctx-menu ctx-submenu">
                  <div className="ctx-header">
                    <div className="ctx-sender-name">Quick Sort</div>
                    <div className="ctx-sender-email">
                      Fast-file this sender into built-in folders.
                    </div>
                  </div>
                  {SORT_FOLDER_PRESETS.map((preset) => (
                    <div
                      key={`ctx-sort-${contextMenu.msg.uid}-${preset.key}`}
                      className="ctx-item"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void handleCleanupSortToFolder(contextMenu.msg.from, senderMessages, preset);
                        setContextMenu(null);
                      }}
                    >
                      <span className="ctx-icon">{renderSortFolderGlyph(preset)}</span>
                      Sort to {preset.label}
                      <span className="ctx-badge">{senderMessages.length}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="ctx-sep" />
              <div
                className="ctx-item"
                onClick={() => {
                  setMoveConversationTargetId(null);
                  setMoveTarget(contextMenu.msg);
                  setMoveFolderOpen(true);
                  setContextMenu(null);
                }}
              >
                <span className="ctx-icon">📁</span> Move All to Folder…
                <span className="ctx-badge">{senderMessages.length}</span>
              </div>
              <div
                className="ctx-item"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openAutoFilterEditor({
                    name: contextMenu.msg.from,
                    email: contextMenu.msg.fromAddress ?? ""
                  });
                  setContextMenu(null);
                }}
              >
                <span className="ctx-icon">🕐</span> Keep Only Recent…
                <span className="ctx-badge">{senderMessages.length}</span>
              </div>
          <div className="ctx-sep" />
          <div
            className="ctx-item"
            onMouseDown={async (event) => {
              event.preventDefault();
              event.stopPropagation();
              setContextMenu(null);
              await handleToggleRead(contextMenu.msg);
            }}
            title={getReadToggleActionCopy(contextMenu.msg.seen).title}
          >
            <span className="ctx-icon">{contextMenu.msg.seen ? "○" : "●"}</span>
            {getReadToggleActionCopy(contextMenu.msg.seen).contextLabel}
          </div>
          {getSenderType(contextMenu.msg.from, contextMenu.msg.fromAddress ?? "") === "nl" ? (
            <>
              <div className="ctx-sep" />
              <div
                className="ctx-item ctx-item-unsub"
                onClick={() => {
                  setContextMenu(null);
                  // Surface the toolbar unsubscribe flow by selecting the message
                  // (detail pane button handles the actual confirmation)
                  setUnsubscribeConfirm(true);
                }}
              >
                <svg className="ctx-unsub-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                </svg>
                Unsubscribe…
              </div>
            </>
          ) : null}
          <div className="ctx-sep" />
          <div
            className="ctx-item ctx-item-danger"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openDeleteSenderModal(contextMenu.msg);
            }}
          >
            <span className="ctx-icon">🗑</span> Delete All from Sender…
            <span className="ctx-badge ctx-badge-danger">
              {
                messages.filter(
                  (message) =>
                    getSenderFilterValue(message) === getSenderFilterValue(contextMenu.msg)
                ).length
              }
            </span>
          </div>
            </div>
          );
        })()
      ) : null}

      {listAreaContextMenu ? (
        <div
          className="ctx-menu"
          style={{
            top:
              typeof window === "undefined"
                ? listAreaContextMenu.y
                : Math.min(listAreaContextMenu.y, window.innerHeight - 160),
            left:
              typeof window === "undefined"
                ? listAreaContextMenu.x
                : Math.min(listAreaContextMenu.x, window.innerWidth - 220)
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="ctx-header">
            <div className="ctx-sender-name">Message list</div>
            <div className="ctx-sender-email">{selectableVisibleMessageUids.length} in current view</div>
          </div>
          <div
            className="ctx-item"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              selectAll();
              setListAreaContextMenu(null);
            }}
          >
            <span className="ctx-icon">✓</span> Select All
            <span className="ctx-badge">{selectableVisibleMessageUids.length}</span>
          </div>
        </div>
      ) : null}

      {folderContextMenu ? (
        <div
          className="ctx-menu"
          style={{
            top:
              typeof window === "undefined"
                ? folderContextMenu.y
                : Math.min(folderContextMenu.y, window.innerHeight - 180),
            left:
              typeof window === "undefined"
                ? folderContextMenu.x
                : Math.min(folderContextMenu.x, window.innerWidth - 230)
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="ctx-header">
            <div className="ctx-sender-name">{folderContextMenu.folderName}</div>
            <div className="ctx-sender-email">{folderContextMenu.accountEmail}</div>
          </div>
          <div
            className="ctx-item ctx-item-danger"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void emptyTrashForAccount(
                folderContextMenu.accountId,
                folderContextMenu.folderPath,
                folderContextMenu.accountEmail
              );
              setFolderContextMenu(null);
            }}
          >
            <span className="ctx-icon">🗑</span> Empty Trash
          </div>
        </div>
      ) : null}

      {sidebarCtx ? (
        (() => {
          const senderMessages = messages.filter(
            (message) => message.from === sidebarCtx.sender.name
          );

          return (
            <div
              className="ctx-menu"
              style={{
                top:
                  typeof window === "undefined"
                    ? sidebarCtx.y
                    : Math.min(sidebarCtx.y, window.innerHeight - 220),
                left:
                  typeof window === "undefined"
                    ? sidebarCtx.x
                    : Math.min(sidebarCtx.x, window.innerWidth - 230)
              }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="ctx-header">
                <div className="ctx-sender-name">{displaySender(sidebarCtx.sender.name)}</div>
                <div className="ctx-sender-email">{sidebarCtx.sender.email}</div>
              </div>
          <div
            className="ctx-item"
            onMouseDown={(event) => {
              event.stopPropagation();
              openAutoFilterEditor({
                name: sidebarCtx.sender.name,
                email: sidebarCtx.sender.email
              });
              setSidebarCtx(null);
            }}
          >
            <span className="ctx-icon">🕐</span>
            {autoFilters.find(
              (filterRule) =>
                filterRule.senderEmail === sidebarCtx.sender.email ||
                filterRule.senderName === sidebarCtx.sender.name
            )
              ? "Edit Auto-Filter…"
              : "Keep Only Recent…"}
            {autoFilters.find(
              (filterRule) =>
                filterRule.senderEmail === sidebarCtx.sender.email ||
                filterRule.senderName === sidebarCtx.sender.name
            ) ? (
              <span
                className="ctx-badge"
                style={{
                  background: "rgba(255,77,0,0.10)",
                  color: "var(--accent)"
                }}
              >
                {
                  autoFilters.find(
                    (filterRule) =>
                      filterRule.senderEmail === sidebarCtx.sender.email ||
                      filterRule.senderName === sidebarCtx.sender.name
                  )?.keepDays
                }
                d
              </span>
            ) : null}
          </div>
          {autoFilters.find(
            (filterRule) =>
              filterRule.senderEmail === sidebarCtx.sender.email ||
              filterRule.senderName === sidebarCtx.sender.name
          ) ? (
            <div
              className="ctx-item ctx-item-danger"
              onMouseDown={(event) => {
                event.stopPropagation();
                const updatedFilters = autoFilters.filter(
                  (filterRule) =>
                    filterRule.senderEmail !== sidebarCtx.sender.email &&
                    filterRule.senderName !== sidebarCtx.sender.name
                );
                setAutoFilters(updatedFilters);
                if (activeAccountId) {
                  syncServerPreferences(activeAccountId, {
                    autoFilters: updatedFilters
                  });
                }
                setSidebarCtx(null);
              }}
            >
              <span className="ctx-icon">✕</span> Remove Auto-Filter
            </div>
          ) : null}
          <div className="ctx-sep" />
          <div className="ctx-submenu-wrap">
            <div
              className="ctx-item ctx-item-submenu"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <span className="ctx-icon">↗</span> Quick Sort
              <span className="ctx-submenu-arrow">›</span>
            </div>
            <div className="ctx-menu ctx-submenu">
              <div className="ctx-header">
                <div className="ctx-sender-name">Quick Sort</div>
                <div className="ctx-sender-email">
                  Fast-file this sender into built-in folders.
                </div>
              </div>
              {SORT_FOLDER_PRESETS.map((preset) => (
                <div
                  key={`sidebar-sort-${sidebarCtx.sender.name}-${preset.key}`}
                  className="ctx-item"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void handleCleanupSortToFolder(sidebarCtx.sender.name, senderMessages, preset);
                    setSidebarCtx(null);
                  }}
                >
                  <span className="ctx-icon">{renderSortFolderGlyph(preset)}</span>
                  Sort to {preset.label}
                  <span className="ctx-badge">{senderMessages.length}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="ctx-sep" />
          <div
            className="ctx-item ctx-item-danger"
            onMouseDown={(event) => {
              event.stopPropagation();
              setDeleteTarget(
                messages.find((message) => message.from === sidebarCtx.sender.name) ?? null
              );
              setSidebarCtx(null);
            }}
          >
            <span className="ctx-icon">🗑</span> Delete All from Sender…
            <span className="ctx-badge ctx-badge-danger">
              {messages.filter((message) => message.from === sidebarCtx.sender.name).length}
            </span>
          </div>
          <div className="ctx-sep" />
          <div
            className="ctx-item"
            onMouseDown={(event) => {
              event.stopPropagation();
              const updatedList = prioritizedSenders.filter(
                (sender) => sender.name !== sidebarCtx.sender.name
              );
              setPrioritizedSenders(updatedList);
              if (activeAccountId) {
                syncServerPreferences(activeAccountId, {
                  prioritizedSenders: updatedList
                });
              }
              if (senderFilter === sidebarCtx.sender.name) {
                clearSenderFocus();
              }
              setSidebarCtx(null);
            }}
          >
            <span className="ctx-icon">★</span> Remove from Prioritized
          </div>
            </div>
          );
        })()
      ) : null}

      {moveFolderOpen && (moveTarget || bulkMoveActive || moveConversationTargetId) ? (
        <div
          className="modal-overlay"
          onClick={() => {
            setMoveFolderOpen(false);
            setMoveTarget(null);
            setMoveConversationTargetId(null);
            setBulkMoveActive(false);
          }}
        >
          <div className="modal move-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-copy">
                <div className="modal-title">Move to Folder</div>
                <div className="modal-subtitle">
                  Use Sort for Receipts, Travel, Follow-Up, or Reference.
                </div>
              </div>
              <button
                className="modal-close"
                onClick={() => {
                  setMoveFolderOpen(false);
                  setMoveTarget(null);
                  setMoveConversationTargetId(null);
                  setBulkMoveActive(false);
                }}
              >
                ✕
              </button>
            </div>
            <div className="move-folder-list">
              {orderedFolders
                .filter((folder) => folder.path !== currentFolderPath)
                .map((folder) => (
                  <div
                    key={folder.path}
                    className="move-folder-row"
                    onClick={async () => {
                      if (!activeAccountId) {
                        setStatus("Connect an account first.");
                        return;
                      }

                      if (moveConversationTargetId) {
                        await dispatchConversationAction("move", moveConversationTargetId, {
                          destinationFolder: folder.path,
                          toastMessage: `Moved conversation to ${folder.name}`
                        });
                        setMoveFolderOpen(false);
                        setMoveTarget(null);
                        setMoveConversationTargetId(null);
                        setBulkMoveActive(false);
                        return;
                      }

                      if (bulkMoveActive) {
                        const scopedMessages = getScopedBulkActionMessages();
                        if (!scopedMessages) {
                          return;
                        }

                        await dispatchMailAction(
                          {
                            kind: "move",
                            accountId: activeAccountId,
                            folderPath: currentFolderPath,
                            target: {
                              scope: "message",
                              messageUids: scopedMessages.map((message) => message.uid)
                            },
                            destinationFolder: folder.path
                          },
                          {
                            clearSelectionOnSuccess: true,
                            toastMessage: `Moved ${scopedMessages.length} message${
                              scopedMessages.length === 1 ? "" : "s"
                            } to ${folder.name}`
                          }
                        );
                        setMoveFolderOpen(false);
                        setMoveTarget(null);
                        setMoveConversationTargetId(null);
                        setBulkMoveActive(false);
                        return;
                      }

                      const targetMessage = moveTarget;
                      if (!targetMessage) {
                        return;
                      }

                      await dispatchMailAction(
                        {
                          kind: "move",
                          accountId: activeAccountId,
                          folderPath: currentFolderPath,
                          target: createMessageActionTarget(targetMessage.uid),
                          destinationFolder: folder.path
                        },
                        {
                          toastMessage: `Moved to ${folder.name}`
                        }
                      );
                      setMoveFolderOpen(false);
                      setMoveTarget(null);
                      setMoveConversationTargetId(null);
                      setBulkMoveActive(false);
                    }}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span className="move-folder-name">{folder.name}</span>
                    {folder.count ? (
                      <span className="move-folder-count">{folder.count}</span>
                    ) : null}
                  </div>
                ))}
            </div>
          </div>
        </div>
      ) : null}

      {autoFilterTarget
        ? (() => {
            const existing = autoFilters.find(
              (filterRule) => filterRule.senderName === autoFilterTarget.name
            );
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - autoFilterDays);
            const toRemoveNow = messages.filter(
              (message) =>
                message.from === autoFilterTarget.name &&
                new Date(message.date).getTime() < cutoff.getTime()
            );

            return (
              <div className="modal-overlay" onClick={() => setAutoFilterTarget(null)}>
                <div className="modal" onClick={(event) => event.stopPropagation()}>
                  <div className="modal-header">
                    <div className="modal-title">🕐 Auto-Filter Rule</div>
                    <div className="modal-subtitle">
                      {displaySender(autoFilterTarget.name)}
                    </div>
                  </div>
                  <div className="modal-body">
                    <div className="autofilter-description">
                      Automatically move messages older than {autoFilterDays}{" "}
                      {autoFilterDays === 1 ? "day" : "days"} to Trash. This rule
                      runs every time you connect and once daily while the app is
                      open.
                    </div>

                    <div className="keep-threshold-row">
                      <span className="keep-threshold-label">
                        Keep messages from the last
                      </span>
                      <div className="keep-threshold-options">
                        {([1, 7, 30, 60, 90] as const).map((days) => (
                          <button
                            key={days}
                            className={`keep-threshold-btn ${
                              autoFilterDays === days ? "active" : ""
                            }`}
                            onClick={() => setAutoFilterDays(days)}
                          >
                            {days} {days === 1 ? "day" : "days"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="keep-summary">
                      <div className="keep-summary-row">
                        <span className="keep-summary-keep">
                          ✓ Keep{" "}
                          <strong>
                            {
                              messages.filter(
                                (message) =>
                                  message.from === autoFilterTarget.name &&
                                  new Date(message.date).getTime() >= cutoff.getTime()
                              ).length
                            }
                          </strong>{" "}
                          recent messages
                        </span>
                        <span className="keep-summary-remove">
                          🗑 Move <strong>{toRemoveNow.length}</strong> older messages to
                          Trash now
                        </span>
                      </div>
                    </div>

                  </div>

                  <div className="modal-footer">
                    <button
                      className="modal-btn-cancel"
                      onClick={() => setAutoFilterTarget(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="modal-btn-confirm"
                      onClick={async () => {
                        const updatedFilters = [
                          ...autoFilters.filter(
                            (filterRule) =>
                              filterRule.senderEmail !== autoFilterTarget.email &&
                              filterRule.senderName !== autoFilterTarget.name
                          ),
                          {
                            senderName: autoFilterTarget.name,
                            senderEmail: autoFilterTarget.email,
                            keepDays: autoFilterDays,
                            createdAt: new Date().toISOString()
                          }
                        ];
                        setAutoFilters(updatedFilters);
                        if (activeAccountId) {
                          syncServerPreferences(activeAccountId, {
                            autoFilters: updatedFilters
                          });
                        }
                        showToast("Auto-filter rule created");

                        const freshCutoff = new Date();
                        freshCutoff.setDate(freshCutoff.getDate() - autoFilterDays);
                        const toRemove = messages.filter(
                          (message) =>
                            message.from === autoFilterTarget.name &&
                            new Date(message.date).getTime() < freshCutoff.getTime()
                        );
                        const uids = toRemove
                          .map((message) => message.uid)
                          .filter((uid): uid is number => Boolean(uid));

                        if (toRemove.length > 0) {
                          setMessages((current) =>
                            current.filter(
                              (message) =>
                                message.from !== autoFilterTarget.name ||
                                new Date(message.date).getTime() >= freshCutoff.getTime()
                            )
                          );
                          await Promise.all(
                            toRemove.map((message) =>
                              removeCachedMessage(
                                makeCachedMessageId(
                                  message.uid,
                                  currentFolderPath,
                                  activeAccountId ?? ""
                                )
                              )
                            )
                          );

                          if (uids.length > 0) {
                            try {
                              await postJson<{
                                success: true;
                                deletedCount: number;
                                movedToTrash: boolean;
                              }>(`/api/accounts/${activeAccountId}/bulk-delete`, {
                                folder: currentFolderPath,
                                uids,
                                moveToTrash: true
                              });
                              await refreshFolderCounts(activeAccountId ?? undefined);
                            } catch (error) {
                              console.error("Auto-filter initial run failed:", error);
                            }
                          }
                        }

                        setAutoFilterTarget(null);
                      }}
                    >
                      {existing ? "Update Rule" : "Create Rule & Run Now"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()
        : null}

      {keepRecentTarget
        ? (() => {
            const senderMessages = messages
              .filter((message) => message.from === keepRecentTarget.from)
              .sort(
                (left, right) =>
                  new Date(right.date).getTime() - new Date(left.date).getTime()
              );

            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - keepRecentDays);

            const toRemove = senderMessages.filter(
              (message) => new Date(message.date) < cutoff
            );
            const toKeep = senderMessages.filter(
              (message) => new Date(message.date) >= cutoff
            );

            return (
              <div className="modal-overlay" onClick={() => setKeepRecentTarget(null)}>
                <div className="modal" onClick={(event) => event.stopPropagation()}>
                  <div className="modal-header">
                    <div className="modal-title">🕐 Keep Only Recent</div>
                    <div className="modal-subtitle">
                      {displaySender(keepRecentTarget.from)}
                    </div>
                  </div>
                  <div className="modal-body">
                    <div className="keep-threshold-row">
                      <span className="keep-threshold-label">
                        Keep messages from the last
                      </span>
                      <div className="keep-threshold-options">
                        {([1, 7, 30, 60, 90] as const).map((days) => (
                          <button
                            key={days}
                            className={`keep-threshold-btn ${
                              keepRecentDays === days ? "active" : ""
                            }`}
                            onClick={() => setKeepRecentDays(days)}
                          >
                            {days} day{days === 1 ? "" : "s"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="keep-summary">
                      <div className="keep-summary-row">
                        <span className="keep-summary-keep">
                          ✓ Keep <strong>{toKeep.length}</strong> message
                          {toKeep.length !== 1 ? "s" : ""}
                        </span>
                        <span className="keep-summary-remove">
                          🗑 Remove <strong>{toRemove.length}</strong> older message
                          {toRemove.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      {toRemove.length === 0 ? (
                        <div className="keep-summary-none">
                          No messages older than {keepRecentDays} days — nothing to
                          remove.
                        </div>
                      ) : null}
                    </div>

                    {toRemove.length > 0 ? (
                      <div className="modal-warning">
                        Messages older than {keepRecentDays} days from{" "}
                        {displaySender(keepRecentTarget.from)} will be permanently
                        deleted. This cannot be undone.
                      </div>
                    ) : null}
                  </div>

                  <div className="modal-footer">
                    <button
                      className="modal-btn-cancel"
                      onClick={() => setKeepRecentTarget(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="modal-btn-delete"
                      disabled={toRemove.length === 0}
                      style={{ opacity: toRemove.length === 0 ? 0.45 : 1 }}
                      onClick={async () => {
                        const freshCutoff = new Date();
                        freshCutoff.setDate(freshCutoff.getDate() - keepRecentDays);

                        const toRemoveNow = messages.filter(
                          (message) =>
                            message.from === keepRecentTarget.from &&
                            new Date(message.date).getTime() < freshCutoff.getTime()
                        );

                        const uids = toRemoveNow.map((message) => message.uid).filter(Boolean);

                        console.log(
                          "Keep only recent — removing:",
                          toRemoveNow.length,
                          "uids:",
                          uids
                        );

                        setMessages((current) =>
                          current.filter(
                            (message) =>
                              message.from !== keepRecentTarget.from ||
                              new Date(message.date).getTime() >= freshCutoff.getTime()
                          )
                        );
                        await Promise.all(
                          toRemoveNow.map((message) =>
                            removeCachedMessage(
                              makeCachedMessageId(
                                message.uid,
                                currentFolderPath,
                                activeAccountId ?? ""
                              )
                            )
                          )
                        );

                        if (
                          selectedMessage &&
                          selectedMessage.from === keepRecentTarget.from &&
                          new Date(selectedMessage.date).getTime() < freshCutoff.getTime()
                        ) {
                          setSelectedMessage(null);
                          setSelectedUid(null);
                        }

                        setKeepRecentTarget(null);

                        if (uids.length > 0) {
                          try {
                            const response = await postJson<{
                              success: true;
                              deletedCount: number;
                              movedToTrash: boolean;
                            }>(`/api/accounts/${activeAccountId}/bulk-delete`, {
                              folder: currentFolderPath,
                              uids,
                              moveToTrash: true
                            });
                            console.log("Keep only recent: server delete succeeded");
                            await refreshFolderCounts(activeAccountId ?? undefined);
                            setStatus(
                              `Removed ${response.deletedCount} older message${
                                response.deletedCount !== 1 ? "s" : ""
                              }.`
                            );
                            showToast(`${toRemoveNow.length} older emails removed`);
                          } catch (error) {
                            console.error("Keep only recent delete failed:", error);
                            setStatus(
                              error instanceof Error
                                ? error.message
                                : "Unable to remove older messages."
                            );
                          }
                        } else {
                          console.warn(
                            "Keep only recent: no UIDs found — messages may be missing uid field"
                          );
                        }
                      }}
                    >
                      Remove {toRemove.length} Older Email
                      {toRemove.length !== 1 ? "s" : ""}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()
        : null}

      {deleteTarget ? (
        <div
          className="modal-overlay"
          onClick={() => {
            setDeleteTarget(null);
            setBlockSender(false);
          }}
        >
          <div className="modal modal-delete-sender" onClick={(event) => event.stopPropagation()}>
            <div className="dms-hero">
              <div
                className="dms-avatar"
                style={{ background: getAvatarColor(deleteTarget.from) }}
              >
                {getSenderInitials(deleteTarget.from)}
              </div>
              <div className="dms-identity">
                <div className="dms-sender-name">{displaySender(deleteTarget.from)}</div>
                <div className="dms-sender-email">{deleteTarget.fromAddress}</div>
              </div>
              <button
                className="dms-close"
                onClick={() => {
                  setDeleteTarget(null);
                  setBlockSender(false);
                }}
                aria-label="Close"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="dms-body">
              <div className="dms-count-statement">
                <span className="dms-count-num">
                  {
                    messages.filter((message) => message.from === deleteTarget.from).length
                  }
                </span>
                <span className="dms-count-label">
                  emails will be
                  <br />
                  permanently deleted
                </span>
              </div>
              <p className="dms-warning">
                All messages from this sender across all folders will be removed. This
                cannot be undone.
              </p>

              <label className="dms-block-card">
                <div className="dms-block-card-text">
                  <div className="dms-block-card-title">Block this sender</div>
                  <div className="dms-block-card-sub">
                    Future emails from {deleteTarget.fromAddress} will be automatically
                    deleted.
                  </div>
                </div>
                <div
                  className={`dms-toggle ${blockSender ? "on" : ""}`}
                  onClick={(event) => {
                    event.preventDefault();
                    setBlockSender((value) => !value);
                  }}
                  role="switch"
                  aria-checked={blockSender}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault();
                      setBlockSender((value) => !value);
                    }
                  }}
                >
                  <div className="dms-toggle-knob" />
                </div>
              </label>
            </div>

            <div className="dms-footer">
              <button
                className="dms-btn-cancel"
                onClick={() => {
                  setDeleteTarget(null);
                  setBlockSender(false);
                }}
              >
                Cancel
              </button>
              <button
                className="dms-btn-delete"
                onClick={async () => {
                  const senderName = deleteTarget.from;
                  const senderEmail = deleteTarget.fromAddress ?? "";
                  const toDeleteCount = messages.filter(
                    (message) => message.from === senderName
                  ).length;

                  setIsBusy(true);
                  setStatus(`Deleting messages from ${senderEmail}...`);

                  try {
                    await postJson<{ success: true; deletedCount: number; movedToTrash: boolean }>(
                      `/api/accounts/${activeAccountId}/delete-sender`,
                      {
                        senderEmail
                      }
                    );

                    if (blockSender) {
                      setBlockedSenders((current) => new Set([...current, senderEmail]));
                    }

                    if (senderFilter === getSenderFilterValue(deleteTarget)) {
                      clearSenderFocus();
                    }

                    if (selectedMessage?.fromAddress === senderEmail) {
                      setSelectedMessage(null);
                      setSelectedUid(null);
                    }

                    const [folderResponse, messageResponse] = await Promise.all([
                      getJson<{ folders: MailFolder[] }>(
                        `/api/accounts/${activeAccountId}/folders`
                      ),
                      loadMessages(currentFolderPath, {
                        force: true,
                        manageBusy: false
                      })
                    ]);

                    setFolders(folderResponse.folders);
                    await Promise.all(
                      messages
                        .filter((message) => message.from === senderName)
                        .map((message) =>
                          removeCachedMessage(
                            makeCachedMessageId(
                              message.uid,
                              currentFolderPath,
                              activeAccountId ?? ""
                            )
                          )
                        )
                    );
                    clearMessageViewState(
                      setSelectedUid,
                      setSelectedMessage,
                      setQuery,
                      setSenderFilter,
                      setSubjectFilter,
                      setSubjectPattern
                    );
                    setSelectedUid(messageResponse[0]?.uid ?? null);
                    setStatus(`Deleted messages from ${senderEmail}.`);
                    showToast(
                      `${toDeleteCount} emails deleted${blockSender ? " · Sender blocked" : ""}`
                    );
                  } catch (error) {
                    setStatus(
                      error instanceof Error
                        ? error.message
                        : "Unable to delete sender messages."
                    );
                  } finally {
                    setDeleteTarget(null);
                    setBlockSender(false);
                    setIsBusy(false);
                  }
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4h6v2" />
                </svg>
                Delete {messages.filter((message) => message.from === deleteTarget.from).length}{" "}
                Email
                {messages.filter((message) => message.from === deleteTarget.from).length !== 1
                  ? "s"
                  : ""}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="modal settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Settings</div>
              <button className="modal-close" onClick={() => setSettingsOpen(false)}>
                ✕
              </button>
            </div>

            <div className="settings-tabs">
              <button
                className={`settings-tab ${settingsTab === "ui" ? "active" : ""}`}
                onClick={() => setSettingsTab("ui")}
              >
                Interface
              </button>
              <button
                className={`settings-tab ${settingsTab === "account" ? "active" : ""}`}
                onClick={() => setSettingsTab("account")}
              >
                Email Account
              </button>
              <button
                className={`settings-tab ${settingsTab === "sorting" ? "active" : ""}`}
                onClick={() => setSettingsTab("sorting")}
              >
                Sort Folders
              </button>
              <button
                className={`settings-tab ${settingsTab === "blocked" ? "active" : ""}`}
                onClick={() => setSettingsTab("blocked")}
              >
                Blocked
              </button>
              <button
                className={`settings-tab ${settingsTab === "rules" ? "active" : ""}`}
                onClick={() => setSettingsTab("rules")}
              >
                Sender Rules
              </button>
            </div>

            {settingsTab === "ui" ? (
              <div className="settings-body">
                <div className="settings-section">
                  <div className="settings-section-label">Sidebar</div>

                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-title">Density</div>
                      <div className="settings-row-sub">
                        Controls font size and spacing of folders and prioritized
                        senders
                      </div>
                    </div>
                    <div className="settings-size-picker">
                      {(["small", "medium", "large"] as const).map((size) => (
                        <button
                          key={size}
                          className={`settings-size-btn ${
                            sidebarSize === size ? "active" : ""
                          }`}
                          onClick={() => setSidebarSize(size)}
                        >
                          <span
                            className="settings-size-icon"
                            style={{
                              fontSize:
                                size === "small"
                                  ? "11px"
                                  : size === "medium"
                                    ? "14px"
                                    : "17px"
                            }}
                          >
                            A
                          </span>
                          <span className="settings-size-label">
                            {size.charAt(0).toUpperCase() + size.slice(1)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="settings-section">
                  <div className="settings-section-label">Notifications</div>

                  {notifPlatform.canWebNotify ? (
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-title">New email alerts</div>
                        <div className="settings-row-sub">
                          {notifPermission === "granted"
                            ? "OS notifications enabled — you'll see alerts when new mail arrives"
                            : notifPermission === "denied"
                              ? "Blocked in browser settings — open Safari \u203a Settings for this website to re-enable"
                              : "Get an OS-level alert when new mail arrives, even if the tab is in the background"}
                        </div>
                      </div>
                      {notifPermission === "default" ? (
                        <button
                          className="settings-notify-btn"
                          onClick={() => {
                            void requestNotificationPermission();
                          }}
                        >
                          Enable
                        </button>
                      ) : notifPermission === "granted" ? (
                        <span className="settings-notify-status on">● On</span>
                      ) : (
                        <span className="settings-notify-status off">Blocked</span>
                      )}
                    </div>
                  ) : notifPlatform.isIosSafariTab ? (
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-title">New email alerts</div>
                        <div className="settings-row-sub">
                          To receive notifications on iOS, add Maximail to your Home
                          Screen: tap the Share button in Safari, then &quot;Add to Home
                          Screen&quot;. Open the installed app to enable alerts.
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-title">Tab badge</div>
                      <div className="settings-row-sub">
                        Show unread count in the browser tab title — visible when
                        Maximail is in the background
                      </div>
                    </div>
                    <span className="settings-notify-status on">● Always on</span>
                  </div>
                </div>
              </div>
            ) : settingsTab === "account" ? (
              <div className="settings-body">
                <div className="settings-section">
                  <div className="settings-section-header">
                    <div className="settings-section-label">Email Accounts</div>
                    <button
                      className="settings-add-account-btn"
                      onClick={() => {
                        closeAccountForm();
                        openAddAccount();
                      }}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      >
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      Add Account
                    </button>
                  </div>

                  {accountFormSuccess ? (
                    <div className="settings-account-feedback success">{accountFormSuccess}</div>
                  ) : null}

                  {accounts.length === 0 ? (
                    <div className="settings-accounts-empty">
                      No accounts configured. Add one to get started.
                    </div>
                  ) : (
                    <div className="settings-accounts-list">
                      {accounts.map((account) => {
                        const isActive = account.id === activeAccountId;
                        const isEditing =
                          accountFormMode === "edit" && accountFormTarget === account.id;

                        return (
                          <div
                            key={account.id}
                            className={`settings-account-row ${isActive ? "active" : ""} ${
                              isEditing ? "editing" : ""
                            }`}
                          >
                            <div
                              className="settings-account-row-main"
                              onClick={async () => {
                                if (isActive) {
                                  return;
                                }
                                setIsBusy(true);
                                try {
                                  await activateAccount(account, {
                                    sync: true
                                  });
                                } catch (error) {
                                  setStatus(
                                    error instanceof Error
                                      ? error.message
                                      : "Unable to switch accounts."
                                  );
                                } finally {
                                  setIsBusy(false);
                                }
                              }}
                            >
                              <div
                                className="settings-account-avatar"
                                style={{ background: getAvatarColor(account.email) }}
                              >
                                {account.email[0]?.toUpperCase() ?? "?"}
                              </div>
                              <div className="settings-account-info">
                                <div className="settings-account-label">
                                  {account.label || account.email}
                                </div>
                                <div className="settings-account-email">{account.email}</div>
                              </div>
                              <div className="settings-account-pills">
                                {account.isDefault ? (
                                  <span className="settings-account-pill">Default</span>
                                ) : null}
                                {isActive ? (
                                  <span className="settings-account-pill active">Active</span>
                                ) : null}
                              </div>
                            </div>

                            <div className="settings-account-actions">
                              {!account.isDefault ? (
                                <button
                                  type="button"
                                  className="settings-account-default-btn"
                                  title="Set as default account"
                                  onClick={async (event) => {
                                    event.stopPropagation();
                                    setIsBusy(true);
                                    try {
                                      await patchJson<{ account: MailAccountSummary }>(
                                        `/api/accounts/${account.id}`,
                                        { makeDefault: true }
                                      );
                                      await loadPersistedAccounts(activeAccountIdRef.current);
                                      showToast(`${account.email} is now the default account`);
                                    } catch (error) {
                                      setStatus(
                                        error instanceof Error
                                          ? error.message
                                          : "Unable to set default account."
                                      );
                                    } finally {
                                      setIsBusy(false);
                                    }
                                  }}
                                >
                                  Make Default
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className={`settings-account-edit-btn ${
                                  isEditing ? "active" : ""
                                }`}
                                title="Edit account settings"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (isEditing) {
                                    closeAccountForm();
                                  } else {
                                    openEditAccount(account);
                                  }
                                }}
                              >
                                <svg
                                  width="13"
                                  height="13"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="settings-account-delete-btn"
                                title="Delete account"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void deleteConfiguredAccount(account);
                                }}
                              >
                                <svg
                                  width="13"
                                  height="13"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                  <path d="M10 11v6M14 11v6" />
                                  <path d="M9 6V4h6v2" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {accountFormMode !== null ? (
                  <div className="settings-section settings-account-form-section">
                    <div className="settings-section-label">
                      {accountFormMode === "add"
                        ? "New Account"
                        : `Edit: ${
                            accountFormTarget
                              ? (accounts.find((account) => account.id === accountFormTarget)
                                  ?.email ?? "")
                              : ""
                          }`}
                    </div>

                    {accountFormError ? (
                      <div className="settings-account-feedback error">{accountFormError}</div>
                    ) : null}

                    <div className="settings-section">
                      <div className="settings-section-label">IMAP / Incoming Mail</div>
                      <div className="settings-field-group">
                        <div className="settings-field">
                          <label>Email address</label>
                          <input
                            value={connection.email}
                            onChange={(event) => {
                              const email = event.target.value;
                              const nextConnection = { ...connection, email };
                              persistConnection(nextConnection);

                              if (!hasAppliedPreset) {
                                applyPresetFromEmail(email);
                              }
                            }}
                            onBlur={(event) => {
                              applyPresetFromEmail(event.target.value, false);
                            }}
                            placeholder="you@example.com"
                          />
                        </div>
                        <div className="settings-field">
                          <label>Password</label>
                          <input
                            type="password"
                            value={connection.password}
                            onChange={(event) =>
                              persistConnection({ ...connection, password: event.target.value })
                            }
                            placeholder="App password"
                          />
                          {storedPasswordHintVisible ? (
                            <div className="settings-field-hint">
                              Password is already stored securely for this account. Leave this
                              blank to keep using it, or enter a new one to replace it.
                            </div>
                          ) : null}
                        </div>
                        <div className="settings-field-row">
                          <div className="settings-field">
                            <label>IMAP host</label>
                            <input
                              value={connection.imapHost}
                              onChange={(event) =>
                                persistConnection({ ...connection, imapHost: event.target.value })
                              }
                              placeholder="imap.mailserver.com"
                            />
                          </div>
                          <div className="settings-field settings-field-short">
                            <label>Port</label>
                            <input
                              type="number"
                              value={connection.imapPort}
                              onChange={(event) =>
                                persistConnection({
                                  ...connection,
                                  imapPort: Number(event.target.value)
                                })
                              }
                            />
                          </div>
                        </div>
                        <label className="settings-field-checkbox">
                          <input
                            type="checkbox"
                            checked={connection.imapSecure}
                            onChange={(event) =>
                              persistConnection({
                                ...connection,
                                imapSecure: event.target.checked
                              })
                            }
                          />
                          <span>Secure IMAP</span>
                        </label>
                      </div>
                    </div>

                    <div className="settings-section">
                      <div className="settings-section-label">SMTP / Outgoing Mail</div>
                      <div className="settings-field-group">
                        <div className="settings-field-row">
                          <div className="settings-field">
                            <label>SMTP host</label>
                            <input
                              value={connection.smtpHost}
                              onChange={(event) =>
                                persistConnection({ ...connection, smtpHost: event.target.value })
                              }
                              placeholder="smtp.mailserver.com"
                            />
                          </div>
                          <div className="settings-field settings-field-short">
                            <label>Port</label>
                            <input
                              type="number"
                              value={connection.smtpPort}
                              onChange={(event) =>
                                persistConnection({
                                  ...connection,
                                  smtpPort: Number(event.target.value)
                                })
                              }
                            />
                          </div>
                        </div>
                        <label className="settings-field-checkbox">
                          <input
                            type="checkbox"
                            checked={connection.smtpSecure}
                            onChange={(event) =>
                              persistConnection({
                                ...connection,
                                smtpSecure: event.target.checked
                              })
                            }
                          />
                          <span>Secure SMTP</span>
                        </label>
                      </div>
                    </div>

                    <div className="settings-section">
                      <div className="settings-section-label">Presets</div>
                      {hasInMotionPreset ? (
                        <div className="settings-preset-hint">
                          InMotion defaults are available for this address and are applied
                          automatically when needed.
                        </div>
                      ) : null}
                      <button
                        className="ghostButton"
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applyInMotionPreset();
                        }}
                      >
                        {hasInMotionPreset ? "Reapply InMotion preset" : "Use InMotion preset"}
                      </button>
                    </div>

                    <div className="settings-footer-actions">
                      <button
                        className="modal-btn-cancel"
                        type="button"
                        onClick={closeAccountForm}
                      >
                        Cancel
                      </button>
                      <button
                        className="modal-btn-confirm"
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          void handleConnect();
                        }}
                      >
                        {accountFormMode === "add" ? "Add Account" : "Save Changes"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : settingsTab === "sorting" ? (
              <div className="settings-body">
                <div className="settings-section">
                  <div className="settings-section-label">Sort Folders</div>
                  <div className="settings-section-subtle">
                    Sort folders are created the first time you use them from the email
                    viewer. Unused folders stay hidden from the sidebar.
                  </div>
                  <div className="settings-row sort-settings-visibility-row">
                    <div className="settings-row-info">
                      <div className="settings-row-title">Collapsed sidebar visibility</div>
                      <div className="settings-row-sub">
                        Choose whether collapsed account sections show only essential
                        folders or also include non-empty built-in sort folders.
                      </div>
                    </div>
                    <div className="sort-settings-visibility-picker">
                      <button
                        type="button"
                        className={`sort-settings-visibility-btn ${
                          collapsedSortFolderVisibility === "essential_only" ? "active" : ""
                        }`}
                        onClick={() => setCollapsedSortFolderVisibility("essential_only")}
                      >
                        Only essential folders
                      </button>
                      <button
                        type="button"
                        className={`sort-settings-visibility-btn ${
                          collapsedSortFolderVisibility === "include_active_sort_folders"
                            ? "active"
                            : ""
                        }`}
                        onClick={() =>
                          setCollapsedSortFolderVisibility("include_active_sort_folders")
                        }
                      >
                        Include active sort folders
                      </button>
                    </div>
                  </div>
                  <div className="sort-settings-account-list">
                    {sortFolderSettingsGroups.map(({ account, presets }) => (
                      <div key={account.id} className="sort-settings-account-card">
                        <div className="sort-settings-account-header">
                          <div className="sort-settings-account-label">
                            {account.label || account.email}
                          </div>
                          <div className="sort-settings-account-email">{account.email}</div>
                        </div>
                        <div className="sort-settings-preset-list">
                          {presets.map(({ preset, exists }) => (
                            <div key={preset.key} className="sort-settings-preset-row">
                              <div className="sort-settings-preset-copy">
                                <div className="sort-settings-preset-label">
                                  <span
                                    className={`sort-folder-glyph sort-folder-glyph-${preset.tone}`}
                                  >
                                    {renderSortFolderGlyph(preset)}
                                  </span>
                                  <span>{preset.label}</span>
                                </div>
                                <div className="sort-settings-preset-sub">{preset.description}</div>
                              </div>
                              <span
                                className={`sort-settings-preset-status ${
                                  exists ? "active" : ""
                                }`}
                              >
                                {exists ? "In use" : "Not used yet"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : settingsTab === "rules" ? (
              <div className="settings-body">
                <div className="settings-section">
                  <div className="settings-section-label">Keep Only Recent — Active Rules</div>

                  {autoFilters.length === 0 ? (
                    <div className="settings-rules-empty">
                      <div className="settings-rules-empty-icon">🕐</div>
                      <div className="settings-rules-empty-title">No sender rules yet</div>
                      <div className="settings-rules-empty-sub">
                        Right-click any sender and choose "Keep Only Recent…" to create a
                        rule. Rules automatically remove older messages from that sender when
                        you open the app.
                      </div>
                    </div>
                  ) : (
                    <div className="settings-rules-list">
                      <div className="settings-rules-summary">
                        <span>
                          {autoFilters.length} rule{autoFilters.length !== 1 ? "s" : ""} active
                        </span>
                        <button
                          className="settings-rules-clear-all"
                          onClick={() => {
                            if (
                              window.confirm(
                                "Remove all sender rules? This won't affect existing messages."
                              )
                            ) {
                              setAutoFilters([]);
                              if (activeAccountId) {
                                syncServerPreferences(activeAccountId, {
                                  autoFilters: []
                                });
                              }
                            }
                          }}
                        >
                          Remove all
                        </button>
                      </div>

                      {autoFilters.map((rule) => (
                        <div key={rule.senderEmail || rule.senderName} className="settings-rule-row">
                          <div
                            className="settings-rule-avatar"
                            style={{ background: getAvatarColor(rule.senderName) }}
                          >
                            {getSenderInitials(rule.senderName)}
                          </div>

                          <div className="settings-rule-identity">
                            <div className="settings-rule-name">
                              {displaySender(rule.senderName)}
                            </div>
                            <div className="settings-rule-email">{rule.senderEmail}</div>
                          </div>

                          <div className="settings-rule-threshold">
                            <span className="settings-rule-threshold-label">Keep last</span>
                            <select
                              className="settings-rule-select"
                              value={rule.keepDays}
                              onChange={(event) => {
                                const newDays = Number(event.target.value) as
                                  | 1
                                  | 7
                                  | 30
                                  | 60
                                  | 90;
                                const updatedFilters = autoFilters.map((entry) =>
                                    (rule.senderEmail
                                      ? entry.senderEmail === rule.senderEmail
                                      : entry.senderName === rule.senderName)
                                      ? { ...entry, keepDays: newDays }
                                      : entry
                                  );
                                setAutoFilters(updatedFilters);
                                if (activeAccountId) {
                                  syncServerPreferences(activeAccountId, {
                                    autoFilters: updatedFilters
                                  });
                                }
                              }}
                            >
                              <option value={1}>1 day</option>
                              <option value={7}>7 days</option>
                              <option value={30}>30 days</option>
                              <option value={60}>60 days</option>
                              <option value={90}>90 days</option>
                            </select>
                          </div>

                          <div className="settings-rule-meta">
                            Since {formatSinceDate(rule.createdAt)}
                          </div>

                          <button
                            className="settings-rule-remove"
                            title="Remove rule"
                            onClick={() => {
                              const updatedFilters = autoFilters.filter(
                                  (entry) =>
                                    rule.senderEmail
                                      ? entry.senderEmail !== rule.senderEmail
                                      : entry.senderName !== rule.senderName
                                );
                              setAutoFilters(updatedFilters);
                              if (activeAccountId) {
                                syncServerPreferences(activeAccountId, {
                                  autoFilters: updatedFilters
                                });
                              }
                            }}
                          >
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                            >
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="settings-body">
                <div className="settings-section">
                  <div className="settings-section-label">Blocked Senders</div>
                  <div className="settings-blocked-panel">
                    <div className="settings-blocked-header">
                      <div>
                        <div className="settings-blocked-title">Manage blocked senders</div>
                        <div className="settings-blocked-subtitle">
                          Search, select, and unblock people you want to hear from again.
                        </div>
                      </div>
                      <div className="settings-blocked-count">
                        {blockedSenderList.length} blocked
                      </div>
                    </div>
                    <div className="settings-blocked-tools">
                      <div className="settings-blocked-search-wrap">
                        <svg
                          className="settings-blocked-search-icon"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="11" cy="11" r="7" />
                          <path d="m20 20-3.5-3.5" />
                        </svg>
                        <input
                          className="settings-blocked-search"
                          type="search"
                          value={blockedSearch}
                          onChange={(event) => setBlockedSearch(event.target.value)}
                          placeholder="Search blocked senders"
                        />
                      </div>
                    </div>
                    <div
                      className="settings-blocked-list"
                      role="listbox"
                      aria-multiselectable="true"
                    >
                      {filteredBlockedSenders.length > 0 ? (
                        filteredBlockedSenders.map((sender) => {
                          const isSelected = selectedBlockedSenders.has(sender);

                          return (
                            <button
                              key={sender}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              className={`settings-blocked-row ${isSelected ? "selected" : ""}`}
                              onClick={(event) => handleBlockedSenderSelection(sender, event)}
                            >
                              <span className="settings-blocked-row-check">
                                {isSelected ? "✓" : ""}
                              </span>
                              <span className="settings-blocked-row-content">
                                <span className="settings-blocked-row-email">{sender}</span>
                                <span className="settings-blocked-row-meta">Blocked sender</span>
                              </span>
                            </button>
                          );
                        })
                      ) : (
                        <div className="settings-blocked-empty">
                          {blockedSenderList.length === 0
                            ? "No senders are currently blocked."
                            : "No blocked senders match your search."}
                        </div>
                      )}
                    </div>
                    <div className="settings-blocked-footer">
                      <div className="settings-blocked-selection">
                        {visibleSelectedBlockedCount > 0
                          ? `${visibleSelectedBlockedCount} selected`
                          : blockedSearch
                            ? "Selection follows the current search results."
                            : "Click to select. Shift-click selects a range."}
                      </div>
                      <button
                        className="modal-btn-confirm settings-blocked-unblock"
                        type="button"
                        disabled={visibleSelectedBlockedCount === 0}
                        onClick={handleUnblockSelectedSenders}
                      >
                        Unblock Selected
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {composeDraft && !composeOpen
        ? (() => {
            const draft = composeDraft;
            const savedAt = draft.savedAt
              ? new Date(draft.savedAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit"
                })
              : "";

            return (
              <div className="draft-restore-bar">
                <span className="draft-restore-icon">📝</span>
                <span className="draft-restore-text">
                  Unsent draft from {savedAt}
                  {draft.subject ? ` — "${draft.subject}"` : ""}
                </span>
                <button
                  className="draft-restore-btn"
                  onClick={() => {
                    const restoredIdentity = restoreDraftIdentity(
                      accounts,
                      draft.draftIdentitySnapshot ?? {
                        ownerAccountId: draft.composeSessionContext?.ownerAccountId ?? draft.accountId,
                        senderId: draft.composeIdentity?.sender?.id ?? null,
                        replyTo: draft.composeIdentity?.replyTo ?? draft.replyTo ?? "",
                        ownerLocked:
                          draft.composeSessionContext?.ownerLocked ??
                          draft.composeIdentity?.ownerLocked ??
                          true
                      },
                      {
                        sessionId: draft.composeSessionContext?.sessionId ?? draft.draftId,
                        sourceAccountId:
                          draft.composeSessionContext?.sourceAccountId ??
                          draft.sourceMessageMeta?.accountId ??
                          null,
                        sourceMessageId:
                          draft.composeSessionContext?.sourceMessageId ??
                          draft.sourceMessageMeta?.messageId ??
                          null,
                        sourceMessageUid:
                          draft.composeSessionContext?.sourceMessageUid ??
                          draft.sourceMessageMeta?.uid ??
                          null
                      }
                    );
                    const identity = resolveComposeIdentityState({
                      accounts,
                      preferredAccountId: restoredIdentity.context.ownerAccountId,
                      ownerAccountId: restoredIdentity.context.ownerAccountId,
                      ownerLocked: restoredIdentity.context.ownerLocked,
                      persistedIdentity: draft.composeIdentity ?? null,
                      persistedReplyTo:
                        draft.composeIdentity?.replyTo ??
                        draft.draftIdentitySnapshot?.replyTo ??
                        draft.replyTo
                    });
                    const session = createDraftResumeComposeSession({
                      ...draft,
                      composeSessionContext: restoredIdentity.context,
                      composeIdentity: identity
                    });
                    const restoredFiles = draft.attachments.map((attachment) => {
                      const file = dataUrlToFile(attachment);
                      composeAttachmentIdsRef.current.set(file, attachment.attachmentId);
                      return file;
                    });
                    applyComposeSession(session, {
                      restoredDraft: draft,
                      restoredFiles,
                      savedAt: draft.savedAt ?? draft.updatedAt,
                      localRevision: draft.localRevision,
                      lastSavedRevision: draft.lastSavedRevision
                    });
                    if (restoredIdentity.blockedReason) {
                      setStatus(restoredIdentity.blockedReason);
                    } else if (identity.senderStatus === "missing_sender") {
                      setStatus("This draft's selected sender is no longer available.");
                    }
                  }}
                >
                  Resume
                </button>
                <button
                  className="draft-discard-btn"
                  onClick={() => {
                    void clearPersistedComposeDraft();
                  }}
                >
                  Discard
                </button>
              </div>
            );
          })()
        : null}

      {composeOpen ? (
        (() => {
          const isMobile = typeof window !== "undefined" && window.innerWidth <= 600;
          const composeWindowWidth = composeMinimized ? 260 : composeWidth;
          const composeWindowHeight = composeMinimized ? 44 : composeHeight;
          const pos = composePos ?? getDefaultComposePos(composeWindowHeight, composeWindowWidth);
          const clampedX =
            typeof window === "undefined"
              ? pos.x
              : isMobile
                ? 0
                : Math.max(
                    0,
                    Math.min(pos.x, window.innerWidth - composeWindowWidth)
                  );
          const clampedY =
            typeof window === "undefined"
              ? pos.y
              : isMobile
                ? Math.max(80, window.innerHeight - composeWindowHeight)
                : Math.max(
                    80,
                    Math.min(pos.y, window.innerHeight - composeWindowHeight)
                  );
          const composeDockThreshold = 4;
          const composeCanResize =
            !composeMinimized &&
            !isMobile &&
            Boolean(composePos) &&
            typeof window !== "undefined" &&
            clampedX > composeDockThreshold &&
            clampedY > 80 + composeDockThreshold &&
            clampedX + composeWindowWidth < window.innerWidth - composeDockThreshold &&
            clampedY + composeWindowHeight < window.innerHeight - composeDockThreshold;
          const startComposeResize = (
            event: React.MouseEvent<HTMLDivElement>,
            edge: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"
          ) => {
            if (!composeCanResize) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            composeResizeRef.current = {
              edge,
              startX: event.clientX,
              startY: event.clientY,
              originX: clampedX,
              originY: clampedY,
              startW: composeWindowWidth,
              startH: composeWindowHeight
            };

            const onMove = (moveEvent: MouseEvent) => {
              const state = composeResizeRef.current;
              if (!state) {
                return;
              }

              const dx = moveEvent.clientX - state.startX;
              const dy = moveEvent.clientY - state.startY;
              const minWidth = getComposeMinWidth();
              const maxWidth = Math.min(getComposeMaxWidth(), window.innerWidth);
              const minHeight = 300;
              const maxHeight = window.innerHeight - 80;
              let nextX = state.originX;
              let nextY = state.originY;
              let nextWidth = state.startW;
              let nextHeight = state.startH;

              if (state.edge.includes("e")) {
                nextWidth = Math.max(
                  minWidth,
                  Math.min(maxWidth, state.startW + dx, window.innerWidth - state.originX)
                );
              }

              if (state.edge.includes("s")) {
                nextHeight = Math.max(
                  minHeight,
                  Math.min(maxHeight, state.startH + dy, window.innerHeight - state.originY)
                );
              }

              if (state.edge.includes("w")) {
                const minLeft = Math.max(0, state.originX + state.startW - maxWidth);
                const maxLeft = state.originX + state.startW - minWidth;
                nextX = Math.max(minLeft, Math.min(state.originX + dx, maxLeft));
                nextWidth = state.startW + (state.originX - nextX);
              }

              if (state.edge.includes("n")) {
                const minTop = Math.max(80, state.originY + state.startH - maxHeight);
                const maxTop = state.originY + state.startH - minHeight;
                nextY = Math.max(minTop, Math.min(state.originY + dy, maxTop));
                nextHeight = state.startH + (state.originY - nextY);
              }

              setComposePos({ x: nextX, y: nextY });
              setComposeWidth(nextWidth);
              setComposeHeight(nextHeight);
            };

            const onUp = () => {
              composeResizeRef.current = null;
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);
            };

            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
          };
          const composeResizeEdges: Array<{
            edge: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
            className: string;
          }> = [
            { edge: "n", className: "compose-edge-handle compose-edge-handle-n" },
            { edge: "s", className: "compose-edge-handle compose-edge-handle-s" },
            { edge: "e", className: "compose-edge-handle compose-edge-handle-e" },
            { edge: "w", className: "compose-edge-handle compose-edge-handle-w" },
            { edge: "ne", className: "compose-edge-handle compose-edge-handle-ne" },
            { edge: "nw", className: "compose-edge-handle compose-edge-handle-nw" },
            { edge: "se", className: "compose-edge-handle compose-edge-handle-se" },
            { edge: "sw", className: "compose-edge-handle compose-edge-handle-sw" }
          ];

          return (
        <div
          className={`compose-window ${composeMinimized ? "compose-minimized" : ""} ${
            composePos ? "compose-floating" : ""
          }`}
          style={{
            "--compose-window-width": `${composeWindowWidth}px`,
            position: "fixed",
            left: clampedX,
            top: clampedY,
            width: composeWindowWidth,
            height: composeMinimized ? "auto" : composeWindowHeight,
            bottom: "auto",
            right: "auto"
          } as React.CSSProperties}
        >
          {composeCanResize
            ? composeResizeEdges.map((handle) => (
                <div
                  key={handle.edge}
                  className={handle.className}
                  onMouseDown={(event) => startComposeResize(event, handle.edge)}
                />
              ))
            : null}
          <div
            className={`modal compose-modal ${composeMinimized ? "minimized" : ""}`}
            style={{ height: composeMinimized ? "auto" : composeWindowHeight }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="compose-header"
              onClick={() => {
                if (composeMinimized) {
                  setComposeMinimized(false);
                }
              }}
              onMouseDown={(event) => {
                if ((event.target as HTMLElement).closest("button")) {
                  return;
                }

                composeDragRef.current = true;
                composeDragStartX.current = event.clientX;
                composeDragStartY.current = event.clientY;
                composeDragOriginX.current = clampedX;
                composeDragOriginY.current = clampedY;

                const onMove = (moveEvent: MouseEvent) => {
                  if (!composeDragRef.current) {
                    return;
                  }

                  const dx = moveEvent.clientX - composeDragStartX.current;
                  const dy = moveEvent.clientY - composeDragStartY.current;
                  const width = composeWindowWidth;
                  const height = composeWindowHeight;
                  const newX = Math.max(
                    0,
                    Math.min(composeDragOriginX.current + dx, window.innerWidth - width)
                  );
                  const newY = Math.max(
                    80,
                    Math.min(composeDragOriginY.current + dy, window.innerHeight - height)
                  );
                  setComposePos({ x: newX, y: newY });
                };

                const onUp = () => {
                  composeDragRef.current = false;
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                };

                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              }}
            >
              <span className="compose-title">{composeSubject || "New Message"}</span>
              <div className="compose-header-actions">
                {composePos ? (
                  <button
                    type="button"
                    className="compose-header-btn"
                    title="Re-center"
                    onClick={(event) => {
                      event.stopPropagation();
                      setComposePos(null);
                    }}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="3" />
                      <line x1="12" y1="2" x2="12" y2="6" />
                      <line x1="12" y1="18" x2="12" y2="22" />
                      <line x1="2" y1="12" x2="6" y2="12" />
                      <line x1="18" y1="12" x2="22" y2="12" />
                    </svg>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="compose-header-btn"
                  title={composeMinimized ? "Expand" : "Minimize"}
                  onClick={() => {
                    setComposeToolbarMenuOpen(false);
                    setComposeToolbarMenuPosition(null);
                    setComposeMinimized((current) => !current);
                  }}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    {composeMinimized ? (
                      <polyline points="18 15 12 9 6 15" />
                    ) : (
                      <polyline points="6 9 12 15 18 9" />
                    )}
                  </svg>
                </button>
                <button
                  type="button"
                  className="compose-header-btn"
                  title="Close"
                  onClick={() => closeComposeDraft()}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {!composeMinimized ? (
              <>
            <div className="compose-fields">
              <RecipientField
                label="To:"
                recipients={composeToList}
                onChange={(values) => updateComposeRecipientBucket("to", values)}
                suggestions={senderSuggestions}
                comparisonRecipients={composeAllRecipients}
                contactsEnabled={contactsPickerSupported}
                onImportContacts={() => {
                  void importSystemContactsForBucket("to");
                }}
                trailing={
                  <div className="compose-row-expanders">
                    <button
                      type="button"
                      className={`recipient-toggle-btn ${showCc ? "active" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setShowCc((current) => !current)}
                    >
                      Cc <span className="recipient-toggle-chevron">{showCc ? "▾" : "▸"}</span>
                    </button>
                    <button
                      type="button"
                      className={`recipient-toggle-btn ${showBcc ? "active" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setShowBcc((current) => !current)}
                    >
                      Bcc <span className="recipient-toggle-chevron">{showBcc ? "▾" : "▸"}</span>
                    </button>
                    <button
                      type="button"
                      className={`recipient-toggle-btn ${showReplyTo ? "active" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setShowReplyTo((current) => !current)}
                    >
                      Reply-To{" "}
                      <span className="recipient-toggle-chevron">
                        {showReplyTo ? "▾" : "▸"}
                      </span>
                    </button>
                  </div>
                }
              />

              {showCc ? (
                <RecipientField
                  label="Cc:"
                  recipients={composeCcList}
                  onChange={(values) => updateComposeRecipientBucket("cc", values)}
                  suggestions={senderSuggestions}
                  comparisonRecipients={composeAllRecipients}
                  contactsEnabled={contactsPickerSupported}
                  onImportContacts={() => {
                    void importSystemContactsForBucket("cc");
                  }}
                />
              ) : null}

              {showBcc ? (
                <RecipientField
                  label="Bcc:"
                  recipients={composeBccList}
                  onChange={(values) => updateComposeRecipientBucket("bcc", values)}
                  suggestions={senderSuggestions}
                  comparisonRecipients={composeAllRecipients}
                  contactsEnabled={contactsPickerSupported}
                  onImportContacts={() => {
                    void importSystemContactsForBucket("bcc");
                  }}
                />
              ) : null}

              {showReplyTo ? (
                <div className="compose-row">
                  <span className="compose-row-label">Reply-To:</span>
                  <input
                    className="compose-row-input"
                    type="text"
                    value={composeReplyTo}
                    onChange={(event) => updateComposeReplyToValue(event.target.value)}
                    placeholder="reply-to@example.com"
                  />
                </div>
              ) : null}

              <div className="compose-row">
                <span className="compose-row-label">Subject:</span>
                <input
                  ref={composeSubjectInputRef}
                  className="compose-row-input"
                  type="text"
                  value={composeSubject}
                  onChange={(event) => setComposeSubject(event.target.value)}
                  placeholder="Subject"
                />
                {composeSubject.length > 70 ? (
                  <span
                    className={`subject-length-warning ${
                      composeSubject.length > 90 ? "danger" : ""
                    }`}
                  >
                    {composeSubject.length}
                  </span>
                ) : null}
              </div>

              <div className="compose-row compose-row-meta">
                <span className="compose-row-label">From:</span>
                {composeIdentity && composeIdentity.capabilityFlags.canChooseSender ? (
                  <select
                    className="compose-from-select"
                    value={composeIdentity.sender?.id ?? ""}
                    onChange={(event) => switchComposeSenderIdentity(event.target.value)}
                  >
                    {composeIdentity.availableSenders.map((sender) => (
                      <option key={sender.id} value={sender.id}>
                        {sender.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="compose-from-val">{composeSessionFromLabel}</span>
                )}
              </div>
            </div>

            <div
              className={`compose-fmt-bar ${
                composeToolbarPreferences.mode === "compact"
                  ? "compose-fmt-bar-compact"
                  : "compose-fmt-bar-expanded"
              }`}
            >
              <div className="compose-fmt-row compose-fmt-row-primary">
                {primaryToolbarCommands.map((command, index) =>
                  renderComposeToolbarCommand(command, index, primaryToolbarCommands)
                )}
                <div className="compose-toolbar-spacer" />
                <div className="compose-toolbar-customize" ref={composeQuickInsertRef}>
                  <button
                    type="button"
                    className={`fmt-btn ${composeQuickInsertOpen ? "fmt-btn-active" : ""}`}
                    title="Quick insert"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setComposeToolbarMenuOpen(false);
                      setComposeToolbarOverflowOpen(false);
                      setComposeQuickInsertOpen((current) => !current);
                    }}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 3v18" />
                      <path d="M3 12h18" />
                    </svg>
                  </button>
                {composeQuickInsertOpen ? (
                  <div
                    ref={composeQuickInsertPopoverRef}
                    className="compose-toolbar-menu compose-quick-insert-menu"
                  >
                    <div className="compose-toolbar-menu-header">
                      <span>Quick Insert</span>
                    </div>
                    <div className="compose-toolbar-menu-list">
                      <button
                        type="button"
                        className="compose-quick-insert-item"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          setComposeQuickInsertOpen(false);
                          setComposeQuickInsertPosition(null);
                          insertSignatureIntoCompose();
                        }}
                      >
                        <span className="compose-quick-insert-item-icon">
                          <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M3 21h6" />
                            <path d="M12 3a6 6 0 0 1 6 6c0 5-6 5-6 10" />
                            <path d="M9 21h12" />
                          </svg>
                        </span>
                        <span className="compose-quick-insert-item-label">
                          Insert signature
                        </span>
                      </button>
                      {composerCommandMap.get("quote") ? (
                        <button
                          type="button"
                          className="compose-quick-insert-item"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setComposeQuickInsertOpen(false);
                            setComposeQuickInsertPosition(null);
                            const quoteCommand = composerCommandMap.get("quote");
                            if (quoteCommand) {
                              void runComposerCommand(quoteCommand);
                            }
                          }}
                        >
                          <span className="compose-quick-insert-item-icon">
                            {renderComposerCommandIcon(composerCommandMap.get("quote")!)}
                          </span>
                          <span className="compose-quick-insert-item-label">Quote</span>
                        </button>
                      ) : null}
                      {quickInsertPresets.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className="compose-quick-insert-item"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setComposeQuickInsertOpen(false);
                            setComposeQuickInsertPosition(null);
                            insertComposePresetById(preset.id);
                          }}
                        >
                          <span className="compose-quick-insert-item-label">
                            {preset.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                </div>
                <button
                  type="button"
                  className={`fmt-btn toolbar-expand-btn ${
                    composeToolbarPreferences.mode === "expanded" ? "fmt-btn-active" : ""
                  }`}
                  title={
                    composeToolbarPreferences.mode === "expanded"
                      ? "Collapse toolbar"
                      : "Expand toolbar"
                  }
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setComposeToolbarOverflowOpen(false);
                    setComposeToolbarOverflowPosition(null);
                    handleComposeToolbarModeChange(
                      composeToolbarPreferences.mode === "expanded"
                        ? "compact"
                        : "expanded"
                    );
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline
                      points={
                        composeToolbarPreferences.mode === "expanded"
                          ? "6 15 12 9 18 15"
                          : "6 9 12 15 18 9"
                      }
                    />
                  </svg>
                </button>
              </div>
              {composeToolbarPreferences.mode === "expanded" &&
              secondaryToolbarCommands.length > 0 ? (
                <div className="compose-fmt-row compose-fmt-row-secondary">
                  {secondaryToolbarCommands.map((command, index) =>
                    renderComposeToolbarCommand(command, index, secondaryToolbarCommands)
                  )}
                </div>
              ) : null}
              {composeToolbarCustomizationEnabled ? (
                <div className="compose-toolbar-customize" ref={composeToolbarMenuRef}>
                  <button
                    ref={composeToolbarTriggerRef}
                    type="button"
                    className={`fmt-btn ${composeToolbarMenuOpen ? "fmt-btn-active" : ""}`}
                    title="Customize toolbar"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setComposeToolbarMenuOpen((v) => !v);
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="4" y1="21" x2="4" y2="14" />
                      <line x1="4" y1="10" x2="4" y2="3" />
                      <line x1="12" y1="21" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12" y2="3" />
                      <line x1="20" y1="21" x2="20" y2="16" />
                      <line x1="20" y1="12" x2="20" y2="3" />
                      <line x1="1" y1="14" x2="7" y2="14" />
                      <line x1="9" y1="8" x2="15" y2="8" />
                      <line x1="17" y1="16" x2="23" y2="16" />
                    </svg>
                  </button>
                </div>
              ) : null}
            </div>

            {/* Toolbar customization panel — inline, full width, below toolbar */}
            {composeToolbarCustomizationEnabled && composeToolbarMenuOpen ? (
                <div
                  ref={composeToolbarPopoverRef}
                  className="compose-toolbar-inline-panel"
                >
                      <div className="compose-toolbar-menu-header">
                        <span>Customize Toolbar</span>
                        <button
                          type="button"
                          className="compose-toolbar-reset"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            resetComposerToolbar();
                          }}
                          >
                            Reset
                          </button>
                        </div>
                      <div className="compose-toolbar-layout-toggle">
                        <button
                          type="button"
                          className={`compose-toolbar-layout-btn ${
                            composeToolbarPreferences.mode === "expanded"
                              ? "active"
                              : ""
                          }`}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            handleComposeToolbarModeChange("expanded");
                          }}
                        >
                          Expanded
                        </button>
                        <button
                          type="button"
                          className={`compose-toolbar-layout-btn ${
                            composeToolbarPreferences.mode === "compact" ? "active" : ""
                          }`}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            handleComposeToolbarModeChange("compact");
                          }}
                        >
                          Compact
                        </button>
                      </div>
                      <div className="compose-toolbar-menu-list">
                        {(composerToolbarCustomizationCommands.length > 0
                          ? composerToolbarCustomizationCommands
                          : COMPOSER_COMMANDS
                        ).map((command, commandIndex) => {
                          const isHidden = hiddenToolbarCommandIds.has(command.id);

                          return (
                            <div key={command.id} className="compose-toolbar-menu-row">
                              <label className="compose-toolbar-menu-toggle">
                                <input
                                  type="checkbox"
                                  checked={!isHidden}
                                  onChange={() =>
                                    handleComposerToolbarVisibilityToggle(command.id)
                                  }
                                />
                                <span>{command.label}</span>
                              </label>
                              <div className="compose-toolbar-menu-actions">
                                <button
                                  type="button"
                                  className="compose-toolbar-order-btn"
                                  disabled={commandIndex === 0}
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    handleComposerToolbarMove(command.id, "up");
                                  }}
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  className="compose-toolbar-order-btn"
                                  disabled={
                                    commandIndex ===
                                    (composerToolbarCustomizationCommands.length > 0
                                      ? composerToolbarCustomizationCommands.length
                                      : COMPOSER_COMMANDS.length) - 1
                                  }
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    handleComposerToolbarMove(command.id, "down");
                                  }}
                                >
                                  ↓
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
            ) : null}
            <input
              ref={attachInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={async (event) => {
                await handleComposeSelectedFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={async (event) => {
                await handleComposeSelectedFiles(
                  Array.from(event.target.files ?? []),
                  "images-only"
                );
                event.target.value = "";
              }}
            />

            {fileAttachments.length > 0 ? (
              <div className="compose-attachments">
                {composeAttachments.map((file, index) =>
                  file.type.startsWith("image/") ? null : (
                    <div key={`${file.name}-${file.size}-${index}`} className="compose-attach-pill">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <span className="compose-attach-name">{file.name}</span>
                    <span className="compose-attach-size">
                      {file.size < 1024 * 1024
                        ? `${Math.round(file.size / 1024)}KB`
                        : `${(file.size / 1024 / 1024).toFixed(1)}MB`}
                    </span>
                    <button
                      type="button"
                      className="compose-attach-remove"
                      title="Remove attachment"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        void composeAttachmentService.removeAttachment({
                          file,
                          index
                        });
                      }}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      >
                        <path d="M6 6l12 12" />
                        <path d="M18 6l-12 12" />
                      </svg>
                    </button>
                    </div>
                  )
                )}
              </div>
            ) : null}

            {composePlainText ? (
              <textarea
                ref={composePlainTextRef}
                className="compose-body-plain"
                value={composeBody}
                onChange={(event) => {
                  setComposeBody(event.target.value);
                  updateComposeCounts(event.target.value);
                }}
                onKeyDown={(event) => {
                  void handleComposeShortcutKeyDown(event);
                }}
                onSelect={() => {
                  const textarea = composePlainTextRef.current;
                  if (!textarea) {
                    return;
                  }

                  const start = textarea.selectionStart ?? 0;
                  const end = textarea.selectionEnd ?? start;
                  const selectedText = textarea.value.slice(start, end);
                  setComposeSelectionState({
                    hasSelection: selectedText.length > 0,
                    text: selectedText,
                    isCollapsed: start === end
                  });
                }}
                placeholder="Write your message..."
              />
            ) : (
              <div
                ref={composeEditorRef}
                className={`compose-body-editor ${composeDragOver ? "drag-over" : ""}`}
                contentEditable
                suppressContentEditableWarning
                onKeyDown={(event) => {
                  void handleComposeShortcutKeyDown(event);
                }}
                onPaste={async (event) => {
                  const items = Array.from(event.clipboardData?.items ?? []);
                  const imageItems = items.filter((item) => item.type.startsWith("image/"));

                  if (imageItems.length === 0) {
                    return;
                  }

                  event.preventDefault();
                  const files = imageItems
                    .map((item) => item.getAsFile())
                    .filter((file): file is File => Boolean(file));

                  await composePhotoService.attachPhotos({
                    files,
                    source: "paste",
                    altResolver: () => "pasted image"
                  });
                }}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setComposeDragOver(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDragLeave={(event) => {
                  const relatedTarget = event.relatedTarget as Node | null;

                  if (!relatedTarget || !event.currentTarget.contains(relatedTarget)) {
                    setComposeDragOver(false);
                  }
                }}
                onDrop={async (event) => {
                  event.preventDefault();
                  setComposeDragOver(false);

                  const files = Array.from(event.dataTransfer.files);
                  const images: File[] = [];
                  const others: File[] = [];

                  for (const file of files) {
                    if (file.type.startsWith("image/")) {
                      images.push(file);
                    } else {
                      others.push(file);
                    }
                  }

                  if (others.length > 0) {
                    await composeAttachmentService.attachFiles({
                      files: others,
                      source: "drop"
                    });
                  }

                  const docWithCaret = document as Document & {
                    caretRangeFromPoint?: (x: number, y: number) => Range | null;
                  };
                  const range = docWithCaret.caretRangeFromPoint
                    ? docWithCaret.caretRangeFromPoint(event.clientX, event.clientY)
                    : null;

                  await composePhotoService.attachPhotos({
                    files: images,
                    source: "drop",
                    range
                  });
                }}
                onInput={(event) => {
                  const text = (event.target as HTMLDivElement).innerText ?? "";
                  setComposeBody(text);
                  updateComposeCounts(text);
                }}
                onClick={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.tagName === "IMG") {
                    const image = target as HTMLImageElement;
                    setSelectedImg(image);
                    setImgRect(image.getBoundingClientRect());
                  } else {
                    setSelectedImg(null);
                    setImgRect(null);
                  }
                }}
              />
            )}

            <div className="compose-footer">
              <div className="compose-footer-meta">
                <div className="compose-counts">
                  <span>
                    {composeWordCount.words} word{composeWordCount.words !== 1 ? "s" : ""}
                  </span>
                  <span className="compose-counts-sep">·</span>
                  <span>
                    {composeWordCount.chars} char{composeWordCount.chars !== 1 ? "s" : ""}
                  </span>
                  {composeDraftStatusLabel ? (
                    <>
                      <span className="compose-counts-sep">·</span>
                      <span
                        className={`compose-save-status compose-save-status-${composeDraftStatus}`}
                      >
                        {composeDraftStatusLabel}
                      </span>
                    </>
                  ) : null}
                </div>
                {composeHelperHints.length > 0 ? (
                  <div className="compose-helper-hints">
                    {composeHelperHints.map((hint) => (
                      <button
                        key={hint.id}
                        type="button"
                        className="compose-helper-chip"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          hint.onAction();
                        }}
                      >
                        <span className="compose-helper-chip-label">{hint.label}</span>
                        <span className="compose-helper-chip-action">{hint.actionLabel}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="compose-footer-actions">
                <button
                  className="modal-btn-cancel"
                  onClick={() => closeComposeDraft()}
                >
                  Discard
                </button>
                <button className="modal-btn-confirm" onClick={handleSend} disabled={isBusy}>
                  Send
                </button>
              </div>
            </div>
            {composeOpen &&
            !composePlainText &&
            composeSelectionToolbarPos &&
            selectionToolbarCommands.length > 0
              ? createPortal(
                  <div className="compose-selection-toolbar-layer">
                    <div
                      className="compose-selection-toolbar"
                      style={{
                        top: composeSelectionToolbarPos.top,
                        left: composeSelectionToolbarPos.left
                      }}
                    >
                      {selectionToolbarCommands.map((command) => {
                        const isEnabled = command.isEnabled
                          ? command.isEnabled(composeCommandContext)
                          : true;
                        const isActive = command.isActive
                          ? command.isActive(composeCommandContext)
                          : false;

                        return (
                          <button
                            key={command.id}
                            type="button"
                            className={`compose-selection-toolbar-btn ${
                              isActive ? "active" : ""
                            }`}
                            disabled={!isEnabled}
                            title={command.label}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              void runComposerCommand(command);
                            }}
                          >
                            {renderComposerCommandIcon(command)}
                          </button>
                        );
                      })}
                    </div>
                  </div>,
                  document.body
                )
              : null}
              </>
            ) : null}
          </div>
        </div>
          );
        })()
      ) : null}

      {printModalOpen ? (
        <div
          className="modal-overlay print-modal-overlay"
          onClick={() => setPrintModalOpen(false)}
        >
          <div className="modal print-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header print-modal-header">
              <div className="modal-title">Print Options</div>
              <button className="modal-close" onClick={() => setPrintModalOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body print-modal-body">
              {printThreadAvailable ? (
                <div>
                  <div className="settings-section-label">Scope</div>
                  <div className="print-scope-toggle">
                    <button
                      type="button"
                      className={`print-scope-option ${
                        printScope === "message" ? "active" : ""
                      }`}
                      onClick={() => setPrintScope("message")}
                    >
                      This message
                    </button>
                    <button
                      type="button"
                      className={`print-scope-option ${
                        printScope === "thread" ? "active" : ""
                      }`}
                      onClick={() => setPrintScope("thread")}
                    >
                      Full thread
                    </button>
                  </div>
                </div>
              ) : null}

              <div>
                <div className="settings-section-label">Format</div>
                <div className="print-scope-toggle">
                  <button
                    type="button"
                    className={`print-scope-option ${
                      printFormat === "print" ? "active" : ""
                    }`}
                    onClick={() => setPrintFormat("print")}
                  >
                    Print
                  </button>
                  <button
                    type="button"
                    className={`print-scope-option ${
                      printFormat === "pdf" ? "active" : ""
                    }`}
                    onClick={() => setPrintFormat("pdf")}
                  >
                    Save as PDF
                  </button>
                </div>
              </div>

              <label className="print-checkbox-row">
                <input
                  type="checkbox"
                  checked={printIncludeHeaders}
                  onChange={(event) => setPrintIncludeHeaders(event.target.checked)}
                />
                <span>Include email headers</span>
              </label>

              <label className="print-checkbox-row">
                <input
                  type="checkbox"
                  checked={printIncludeQuoted}
                  onChange={(event) => setPrintIncludeQuoted(event.target.checked)}
                />
                <span>Include quoted replies</span>
              </label>
            </div>
            <div className="modal-footer print-modal-footer">
              <button className="modal-btn-cancel" onClick={() => setPrintModalOpen(false)}>
                Cancel
              </button>
              <button className="modal-btn-confirm" onClick={() => void handlePrintAction()}>
                {printFormat === "pdf" ? "Save as PDF" : "Print"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {discardConfirmOpen ? (
        <div className="modal-overlay" onClick={() => setDiscardConfirmOpen(false)}>
          <div className="modal discard-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Discard Draft?</div>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: "13px", color: "var(--text2)", margin: 0, lineHeight: 1.6 }}>
                This message has not been sent. Discarding it will permanently delete the draft.
              </p>
            </div>
            <div className="modal-footer">
              <button
                className="modal-btn-cancel"
                onClick={() => setDiscardConfirmOpen(false)}
              >
                Keep Editing
              </button>
              <button
                className="modal-btn-delete"
                onClick={() => closeComposeDraft(true)}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {linkDialogOpen ? (
        <div
          className="modal-overlay link-dialog-overlay"
          onClick={() => setLinkDialogOpen(false)}
        >
          <div className="modal link-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Insert Link</div>
              <button className="modal-close" onClick={() => setLinkDialogOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="link-field">
                <label>Text</label>
                <input
                  type="text"
                  value={linkText}
                  onChange={(event) => setLinkText(event.target.value)}
                  placeholder="Link text"
                  autoFocus
                />
              </div>
              <div className="link-field">
                <label>URL</label>
                <input
                  type="url"
                  value={linkUrl}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  placeholder="https://"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget
                        .closest(".modal")
                        ?.querySelector<HTMLButtonElement>(".modal-btn-confirm")
                        ?.click();
                    }
                  }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="modal-btn-cancel" onClick={() => setLinkDialogOpen(false)}>
                Cancel
              </button>
              <button
                className="modal-btn-confirm"
                onClick={() => {
                  if (!linkUrl) {
                    return;
                  }

                  const editor = composeEditorRef.current;

                  if (!editor) {
                    return;
                  }

                  editor.focus();
                  const selection = window.getSelection();

                  if (selection && savedRangeRef.current) {
                    selection.removeAllRanges();
                    selection.addRange(savedRangeRef.current);
                  }

                  insertLinkAtSelection(linkUrl, linkText);
                  setLinkDialogOpen(false);
                  setLinkUrl("");
                  setLinkText("");
                }}
              >
                Insert Link
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {typeof document !== "undefined" && lightboxOpen && currentLightboxImage
        ? createPortal(
            <div className="lightbox-backdrop" onClick={closeLightbox}>
              <div className="lightbox-toolbar" onClick={(event) => event.stopPropagation()}>
                <div className="lightbox-toolbar-left">
                  {lightboxImages.length > 1 ? (
                    <>
                      <button
                        type="button"
                        className="lightbox-btn"
                        title="Previous image"
                        onClick={goToPreviousLightboxImage}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="15 18 9 12 15 6" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="lightbox-btn"
                        title="Next image"
                        onClick={goToNextLightboxImage}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                    </>
                  ) : null}
                  <span className="lightbox-caption">
                    image {lightboxIndex + 1} of {lightboxImages.length}
                  </span>
                </div>

                <div className="lightbox-toolbar-center">
                  {getLightboxImageLabel(currentLightboxImage)}
                </div>

                <div className="lightbox-toolbar-right">
                  <button
                    type="button"
                    className="lightbox-btn"
                    title="Rotate"
                    onClick={() => {
                      setLightboxRotation((current) => (current + 90) % 360);
                      setLightboxOffset({ x: 0, y: 0 });
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="lightbox-btn"
                    title="Zoom out"
                    onClick={() => applyLightboxZoom(lightboxZoom - 0.25)}
                  >
                    −
                  </button>
                  <span className="lightbox-zoom-label">
                    {Math.round(lightboxZoom * 100)}%
                  </span>
                  <button
                    type="button"
                    className="lightbox-btn"
                    title="Zoom in"
                    onClick={() => applyLightboxZoom(lightboxZoom + 0.25)}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="lightbox-btn lightbox-btn-labeled"
                    title="Save to Files"
                    onClick={() =>
                      void handleLightboxSaveToFiles(
                        currentLightboxImage.saveSrc,
                        currentLightboxImage.alt || getLightboxImageLabel(currentLightboxImage)
                      )
                    }
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3v12" />
                      <path d="m7 10 5 5 5-5" />
                      <path d="M5 21h14" />
                    </svg>
                    <span className="lightbox-btn-text">Files</span>
                  </button>
                  <button
                    type="button"
                    className="lightbox-btn lightbox-btn-labeled"
                    title="Save to Photos"
                    onClick={() =>
                      void handleLightboxSaveToPhotos(
                        currentLightboxImage.saveSrc,
                        currentLightboxImage.alt || getLightboxImageLabel(currentLightboxImage)
                      )
                    }
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
                      <circle cx="9" cy="10" r="1.4" />
                      <path d="m6.5 16 4.2-4.1a1.5 1.5 0 0 1 2.08-.03L17.5 16" />
                    </svg>
                    <span className="lightbox-btn-text">Photos</span>
                  </button>
                  <button
                    type="button"
                    className="lightbox-btn"
                    title="Close"
                    onClick={closeLightbox}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {lightboxImages.length > 1 ? (
                <>
                  <button
                    type="button"
                    className="lightbox-nav-arrow prev"
                    onClick={(event) => {
                      event.stopPropagation();
                      goToPreviousLightboxImage();
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="lightbox-nav-arrow next"
                    onClick={(event) => {
                      event.stopPropagation();
                      goToNextLightboxImage();
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </>
              ) : null}

              <div
                ref={lightboxAreaRef}
                className="lightbox-image-area"
                style={{ touchAction: "none" }}
                onClick={(event) => event.stopPropagation()}
                onWheel={(event) => {
                  event.preventDefault();
                  const nextZoom = Math.min(
                    4,
                    Math.max(
                      0.5,
                      lightboxZoom - event.deltaY * 0.001 * lightboxZoom
                    )
                  );
                  applyLightboxZoom(nextZoom, event.clientX, event.clientY);
                }}
                onPointerDown={(event) => {
                  lightboxPointersRef.current.set(event.pointerId, {
                    x: event.clientX,
                    y: event.clientY
                  });
                  event.currentTarget.setPointerCapture(event.pointerId);

                  if (lightboxPointersRef.current.size === 1 && lightboxZoom > 1) {
                    lightboxPanRef.current = {
                      pointerId: event.pointerId,
                      startX: event.clientX,
                      startY: event.clientY,
                      originX: lightboxOffset.x,
                      originY: lightboxOffset.y
                    };
                    setLightboxDragging(true);
                  }

                  if (lightboxPointersRef.current.size === 2) {
                    const [first, second] = Array.from(lightboxPointersRef.current.values());
                    lightboxPinchRef.current = {
                      distance: Math.hypot(second.x - first.x, second.y - first.y),
                      zoom: lightboxZoom
                    };
                    lightboxPanRef.current = null;
                    setLightboxDragging(false);
                  }
                }}
                onPointerMove={(event) => {
                  if (!lightboxPointersRef.current.has(event.pointerId)) {
                    return;
                  }

                  lightboxPointersRef.current.set(event.pointerId, {
                    x: event.clientX,
                    y: event.clientY
                  });

                  if (lightboxPointersRef.current.size === 2 && lightboxPinchRef.current) {
                    event.preventDefault();
                    const [first, second] = Array.from(lightboxPointersRef.current.values());
                    const distance = Math.hypot(second.x - first.x, second.y - first.y);
                    const nextZoom = Math.min(
                      4,
                      Math.max(
                        0.5,
                        lightboxPinchRef.current.zoom *
                          (distance / Math.max(lightboxPinchRef.current.distance, 1))
                      )
                    );

                    setLightboxZoom(nextZoom);
                    setLightboxOffset((current) =>
                      nextZoom <= 1
                        ? { x: 0, y: 0 }
                        : clampLightboxOffset(current, nextZoom, lightboxRotation)
                    );
                    return;
                  }

                  if (
                    lightboxPanRef.current &&
                    lightboxPanRef.current.pointerId === event.pointerId &&
                    lightboxZoom > 1
                  ) {
                    event.preventDefault();
                    const deltaX =
                      (event.clientX - lightboxPanRef.current.startX) / lightboxZoom;
                    const deltaY =
                      (event.clientY - lightboxPanRef.current.startY) / lightboxZoom;
                    setLightboxOffset(
                      clampLightboxOffset(
                        {
                          x: lightboxPanRef.current.originX + deltaX,
                          y: lightboxPanRef.current.originY + deltaY
                        },
                        lightboxZoom,
                        lightboxRotation
                      )
                    );
                  }
                }}
                onPointerUp={(event) => {
                  lightboxPointersRef.current.delete(event.pointerId);
                  lightboxPanRef.current =
                    lightboxPanRef.current?.pointerId === event.pointerId
                      ? null
                      : lightboxPanRef.current;
                  if (lightboxPointersRef.current.size < 2) {
                    lightboxPinchRef.current = null;
                  }
                  if (lightboxPointersRef.current.size === 0) {
                    setLightboxDragging(false);
                  }
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={(event) => {
                  lightboxPointersRef.current.delete(event.pointerId);
                  lightboxPanRef.current = null;
                  lightboxPinchRef.current = null;
                  setLightboxDragging(false);
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }}
              >
                <img
                  ref={lightboxImageRef}
                  src={currentLightboxImage.src}
                  alt={currentLightboxImage.alt}
                  className={`lightbox-img ${lightboxZoom > 1 ? "zoomed" : ""} ${
                    lightboxDragging ? "dragging" : ""
                  }`}
                  style={{
                    transform: `rotate(${lightboxRotation}deg) scale(${lightboxZoom}) translate(${lightboxOffset.x}px, ${lightboxOffset.y}px)`,
                    transition: lightboxDragging ? "none" : "transform 0.15s ease",
                    cursor:
                      lightboxZoom > 1
                        ? lightboxDragging
                          ? "grabbing"
                          : "grab"
                        : "zoom-in",
                    userSelect: "none",
                    maxWidth: lightboxZoom > 1 ? "none" : undefined,
                    maxHeight: lightboxZoom > 1 ? "none" : undefined,
                    touchAction: "none"
                  }}
                  draggable={false}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (lightboxZoom > 1) {
                      resetLightboxView();
                    } else {
                      applyLightboxZoom(2, event.clientX, event.clientY);
                    }
                  }}
                />
              </div>
            </div>,
            document.body
          )
        : null}

      {typeof document !== "undefined" && cropModalOpen && cropSourceImg
        ? createPortal(
            <div className="crop-modal-overlay" onClick={() => closeCropModal()}>
              <div className="crop-modal" onClick={(event) => event.stopPropagation()}>
                <div className="crop-modal-header">
                  <div className="crop-modal-title">Crop Image</div>
                  <button
                    type="button"
                    className="modal-close"
                    onClick={() => closeCropModal()}
                  >
                    ✕
                  </button>
                </div>
                <div className="crop-modal-body">
                  <div className="crop-canvas-wrap">
                    <canvas
                      ref={cropCanvasRef}
                      className="crop-canvas"
                      width={cropCanvasSize.width || undefined}
                      height={cropCanvasSize.height || undefined}
                    />
                    {cropRect ? (
                      <div className="crop-overlay">
                        <div
                          className="crop-mask"
                          style={{ left: 0, top: 0, width: "100%", height: cropRect.y }}
                        />
                        <div
                          className="crop-mask"
                          style={{
                            left: 0,
                            top: cropRect.y,
                            width: cropRect.x,
                            height: cropRect.h
                          }}
                        />
                        <div
                          className="crop-mask"
                          style={{
                            left: cropRect.x + cropRect.w,
                            top: cropRect.y,
                            width: Math.max(
                              0,
                              cropCanvasSize.width - (cropRect.x + cropRect.w)
                            ),
                            height: cropRect.h
                          }}
                        />
                        <div
                          className="crop-mask"
                          style={{
                            left: 0,
                            top: cropRect.y + cropRect.h,
                            width: "100%",
                            height: Math.max(
                              0,
                              cropCanvasSize.height - (cropRect.y + cropRect.h)
                            )
                          }}
                        />
                        <div
                          className="crop-selection-box"
                          style={{
                            left: cropRect.x,
                            top: cropRect.y,
                            width: cropRect.w,
                            height: cropRect.h
                          }}
                          onPointerDown={(event) => beginCropInteraction("move", event)}
                        >
                          <div
                            className="crop-grid-line vertical"
                            style={{ left: `${100 / 3}%` }}
                          />
                          <div
                            className="crop-grid-line vertical"
                            style={{ left: `${(100 / 3) * 2}%` }}
                          />
                          <div
                            className="crop-grid-line horizontal"
                            style={{ top: `${100 / 3}%` }}
                          />
                          <div
                            className="crop-grid-line horizontal"
                            style={{ top: `${(100 / 3) * 2}%` }}
                          />
                        </div>
                        {(
                          [
                            ["nw", cropRect.x, cropRect.y],
                            ["n", cropRect.x + cropRect.w / 2, cropRect.y],
                            ["ne", cropRect.x + cropRect.w, cropRect.y],
                            ["e", cropRect.x + cropRect.w, cropRect.y + cropRect.h / 2],
                            ["se", cropRect.x + cropRect.w, cropRect.y + cropRect.h],
                            ["s", cropRect.x + cropRect.w / 2, cropRect.y + cropRect.h],
                            ["sw", cropRect.x, cropRect.y + cropRect.h],
                            ["w", cropRect.x, cropRect.y + cropRect.h / 2]
                          ] as const
                        ).map(([handle, left, top]) => (
                          <div
                            key={handle}
                            className={`crop-handle crop-handle-${handle}`}
                            style={{ left, top }}
                            onPointerDown={(event) => beginCropInteraction(handle, event)}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="crop-modal-footer">
                  <div className="crop-dimensions">
                    {cropNaturalWidth} × {cropNaturalHeight}
                  </div>
                  <div>
                    <button
                      type="button"
                      className="crop-btn-cancel"
                      onClick={() => closeCropModal()}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="crop-btn-apply"
                      onClick={() => void applyCropToSelectedImage()}
                    >
                      Apply Crop
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {typeof document !== "undefined" && selectedImg && imgRect
        ? createPortal(
            <>
              <div
                className="img-resize-overlay"
                style={{
                  left: imgRect.left - 2,
                  top: imgRect.top - 2,
                  width: imgRect.width + 4,
                  height: imgRect.height + 4
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="img-resize-border" />

                <div className="img-edit-toolbar">
                  <button
                    type="button"
                    className="img-edit-btn"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void rotateSelectedImage(90);
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                    </svg>
                    Rotate
                  </button>
                  <button
                    type="button"
                    className="img-edit-btn"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openCropModal();
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
                      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
                    </svg>
                    Crop
                  </button>
                </div>

                {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                  <div
                    key={corner}
                    className={`img-resize-handle img-resize-${corner}`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();

                      if (!selectedImg) {
                        return;
                      }

                      resizingRef.current = {
                        corner,
                        startX: event.clientX,
                        startY: event.clientY,
                        startW: selectedImg.offsetWidth,
                        startH: selectedImg.offsetHeight,
                        aspectRatio: selectedImg.offsetWidth / selectedImg.offsetHeight
                      };
                      setImgRect(selectedImg.getBoundingClientRect());

                      const onMove = (moveEvent: MouseEvent) => {
                        if (!resizingRef.current || !selectedImg) {
                          return;
                        }

                        const {
                          corner: activeCorner,
                          startX,
                          startY,
                          startW,
                          startH,
                          aspectRatio
                        } = resizingRef.current;

                        const dx = moveEvent.clientX - startX;
                        const dy = moveEvent.clientY - startY;

                        let newWidth = startW;
                        let newHeight = startH;

                        if (activeCorner === "se" || activeCorner === "ne") {
                          newWidth = Math.max(40, startW + dx);
                        } else {
                          newWidth = Math.max(40, startW - dx);
                        }

                        if (!moveEvent.shiftKey) {
                          newHeight = newWidth / aspectRatio;
                        } else if (activeCorner === "se" || activeCorner === "ne") {
                          newHeight = Math.max(40, startH + dy);
                        } else {
                          newHeight = Math.max(40, startH - dy);
                        }

                        selectedImg.style.width = `${Math.round(newWidth)}px`;
                        selectedImg.style.height = `${Math.round(newHeight)}px`;
                        selectedImg.style.maxWidth = "none";
                        setImgRect(selectedImg.getBoundingClientRect());
                      };

                      const onUp = () => {
                        resizingRef.current = null;
                        document.removeEventListener("mousemove", onMove);
                        document.removeEventListener("mouseup", onUp);

                        if (selectedImg) {
                          setImgRect(selectedImg.getBoundingClientRect());
                          const editorText = composeEditorRef.current?.innerText ?? composeBody;
                          setComposeBody(editorText);
                          updateComposeCounts(editorText);
                        }
                      };

                      document.addEventListener("mousemove", onMove);
                      document.addEventListener("mouseup", onUp);
                    }}
                  />
                ))}

                {resizingRef.current ? (
                  <div className="img-resize-badge">
                    {selectedImg.offsetWidth} × {selectedImg.offsetHeight}
                  </div>
                ) : null}
              </div>

              <div
                className="img-action-popover"
                style={{
                  left: imgRect.left + imgRect.width / 2,
                  top: imgRect.bottom + 10
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="img-action-bar">
                  <button
                    type="button"
                    className="img-action-btn"
                    title="Float left"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      if (selectedImg) {
                        selectedImg.style.display = "block";
                        selectedImg.style.marginLeft = "0";
                        selectedImg.style.marginRight = "auto";
                        setImgRect(selectedImg.getBoundingClientRect());
                      }
                    }}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <line x1="3" y1="6" x2="21" y2="6" />
                      <line x1="3" y1="12" x2="15" y2="12" />
                      <line x1="3" y1="18" x2="18" y2="18" />
                    </svg>
                    Left
                  </button>
                  <button
                    type="button"
                    className="img-action-btn"
                    title="Float right"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      if (selectedImg) {
                        selectedImg.style.display = "block";
                        selectedImg.style.marginLeft = "auto";
                        selectedImg.style.marginRight = "0";
                        setImgRect(selectedImg.getBoundingClientRect());
                      }
                    }}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <line x1="3" y1="6" x2="21" y2="6" />
                      <line x1="9" y1="12" x2="21" y2="12" />
                      <line x1="6" y1="18" x2="21" y2="18" />
                    </svg>
                    Right
                  </button>
                  <button
                    type="button"
                    className="img-action-btn img-action-danger"
                    title="Remove image"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      if (selectedImg) {
                        void composeAttachmentService.removeAttachment({
                          attachmentId: selectedImg.dataset.attachmentId,
                          filename: selectedImg.dataset.filename,
                          removeInlineElement: true
                        });
                      }
                    }}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                    Remove
                  </button>
                </div>
              </div>
            </>,
            document.body
          )
        : null}

      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <span className="toast-icon">
              {toast.type === "success" ? "✓" : toast.type === "error" ? "✕" : "ℹ"}
            </span>
            <span className="toast-message">{toast.message}</span>
            <button
              className="toast-close"
              onClick={() =>
                setToasts((current) => current.filter((entry) => entry.id !== toast.id))
              }
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
