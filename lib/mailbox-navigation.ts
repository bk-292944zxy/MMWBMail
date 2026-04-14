import type { MailFolder, MailProviderKind, ProviderCapabilities } from "@/lib/mail-types";

export type MailboxType = "system" | "folder" | "label";
export type MailboxSourceKind = "folder" | "label";
export type MailboxSystemKey =
  | "inbox"
  | "sent"
  | "drafts"
  | "trash"
  | "spam"
  | "archive"
  | "important"
  | "starred";

export type MailboxIdentity = {
  id: string;
  accountId: string;
  providerKind: MailProviderKind;
  providerPath: string;
  sourceKind: MailboxSourceKind;
};

export type MailboxCapabilities = {
  canContainMessages: boolean;
  canHaveChildren: boolean;
  supportsMove: boolean;
  supportsLabeling: boolean;
};

export type MailboxNode = {
  identity: MailboxIdentity;
  type: MailboxType;
  name: string;
  specialUse: string | null;
  systemKey: MailboxSystemKey | null;
  count: number | null;
  unread: number | null;
  parentId: string | null;
  childIds: string[];
  depth: number;
  capabilities: MailboxCapabilities;
};

const SPECIAL_USE_TO_SYSTEM_KEY: Record<string, MailboxSystemKey> = {
  "\\Inbox": "inbox",
  "\\\\Inbox": "inbox",
  "\\Sent": "sent",
  "\\\\Sent": "sent",
  "\\Drafts": "drafts",
  "\\\\Drafts": "drafts",
  "\\Trash": "trash",
  "\\\\Trash": "trash",
  "\\Junk": "spam",
  "\\\\Junk": "spam",
  "\\Archive": "archive",
  "\\\\Archive": "archive",
  "\\Important": "important",
  "\\\\Important": "important",
  "\\Flagged": "starred",
  "\\\\Flagged": "starred"
};

const SYSTEM_MAILBOX_NAME_TO_KEY: Record<string, MailboxSystemKey> = {
  inbox: "inbox",
  sent: "sent",
  "sent items": "sent",
  "sent mail": "sent",
  "sent messages": "sent",
  drafts: "drafts",
  trash: "trash",
  spam: "spam",
  junk: "spam",
  archive: "archive",
  important: "important",
  starred: "starred",
  "all mail": "archive",
  "[gmail]/all mail": "archive",
  "[googlemail]/all mail": "archive"
};

export function resolveMailboxSystemKey(
  folder: MailFolder,
  _providerKind?: MailProviderKind
): MailboxSystemKey | null {
  const specialUseMatch = folder.specialUse
    ? SPECIAL_USE_TO_SYSTEM_KEY[folder.specialUse] ?? null
    : null;
  if (specialUseMatch) {
    return specialUseMatch;
  }

  const normalizedName = folder.name.trim().toLowerCase();
  const normalizedPath = folder.path.trim().toLowerCase();

  return (
    SYSTEM_MAILBOX_NAME_TO_KEY[normalizedName] ??
    SYSTEM_MAILBOX_NAME_TO_KEY[normalizedPath] ??
    null
  );
}

function inferMailboxType(input: {
  folder: MailFolder;
  providerKind?: MailProviderKind;
  providerCapabilities?: ProviderCapabilities;
}): MailboxType {
  const systemKey = resolveMailboxSystemKey(input.folder, input.providerKind);

  if (systemKey) {
    return "system";
  }

  return input.providerCapabilities?.supportsLabels ? "label" : "folder";
}

function inferMailboxSourceKind(providerCapabilities?: ProviderCapabilities): MailboxSourceKind {
  if (providerCapabilities?.supportsLabels) {
    return "label";
  }

  return "folder";
}

function isHiddenGmailContainerFolder(folder: MailFolder, providerKind: MailProviderKind) {
  if (providerKind !== "gmail") {
    return false;
  }

  const normalizedName = folder.name.trim().toLowerCase();
  const normalizedPath = folder.path.trim().toLowerCase();
  return (
    normalizedName === "[gmail]" ||
    normalizedName === "[googlemail]" ||
    normalizedPath === "[gmail]" ||
    normalizedPath === "[googlemail]"
  );
}

export function createMailboxNode(input: {
  accountId: string;
  providerKind: MailProviderKind;
  folder: MailFolder;
  providerCapabilities?: ProviderCapabilities;
}): MailboxNode {
  const type = inferMailboxType({
    folder: input.folder,
    providerKind: input.providerKind,
    providerCapabilities: input.providerCapabilities
  });
  const sourceKind = inferMailboxSourceKind(input.providerCapabilities);
  const systemKey = resolveMailboxSystemKey(input.folder, input.providerKind);

  return {
    identity: {
      id: `${input.accountId}:${input.providerKind}:${sourceKind}:${input.folder.path}`,
      accountId: input.accountId,
      providerKind: input.providerKind,
      providerPath: input.folder.path,
      sourceKind
    },
    type,
    name: input.folder.name,
    specialUse: input.folder.specialUse,
    systemKey,
    count: input.folder.count,
    unread: input.folder.unread,
    parentId: null,
    childIds: [],
    depth: 0,
    capabilities: {
      canContainMessages: true,
      canHaveChildren: input.folder.path.includes("/"),
      supportsMove: sourceKind === "folder",
      supportsLabeling: Boolean(input.providerCapabilities?.supportsLabels)
    }
  };
}

function inferMailboxPathDelimiter(path: string) {
  if (path.includes("/")) {
    return "/";
  }

  if (path.includes(".")) {
    return ".";
  }

  return null;
}

function getParentProviderPath(path: string) {
  const delimiter = inferMailboxPathDelimiter(path);
  if (!delimiter) {
    return null;
  }

  const segments = path.split(delimiter).filter(Boolean);
  if (segments.length <= 1) {
    return null;
  }

  return segments.slice(0, -1).join(delimiter);
}

export function resolveMailboxNodes(
  folders: MailFolder[],
  input: {
    accountId: string;
    providerKind: MailProviderKind;
    providerCapabilities?: ProviderCapabilities;
  }
) {
  const baseNodes = folders
    .filter((folder) => !isHiddenGmailContainerFolder(folder, input.providerKind))
    .map((folder) =>
    createMailboxNode({
      accountId: input.accountId,
      providerKind: input.providerKind,
      folder,
      providerCapabilities: input.providerCapabilities
    })
  );

  const nodesByPath = new Map(baseNodes.map((node) => [node.identity.providerPath, node]));
  const childIdsByParentPath = new Map<string, string[]>();

  for (const node of baseNodes) {
    const parentPath = getParentProviderPath(node.identity.providerPath);
    if (!parentPath) {
      continue;
    }

    const current = childIdsByParentPath.get(parentPath) ?? [];
    current.push(node.identity.id);
    childIdsByParentPath.set(parentPath, current);
  }

  return baseNodes.map((node) => {
    const parentPath = getParentProviderPath(node.identity.providerPath);
    const parentNode = parentPath ? nodesByPath.get(parentPath) ?? null : null;
    const childIds = childIdsByParentPath.get(node.identity.providerPath) ?? [];
    const depth = (() => {
      const delimiter = inferMailboxPathDelimiter(node.identity.providerPath);
      return delimiter
        ? node.identity.providerPath.split(delimiter).filter(Boolean).length - 1
        : 0;
    })();

    return {
      ...node,
      parentId: parentNode?.identity.id ?? null,
      childIds,
      depth,
      capabilities: {
        ...node.capabilities,
        canHaveChildren: childIds.length > 0 || node.capabilities.canHaveChildren
      }
    };
  });
}

export function findMailboxNodeByPath(nodes: MailboxNode[], providerPath: string) {
  return nodes.find((node) => node.identity.providerPath === providerPath) ?? null;
}
