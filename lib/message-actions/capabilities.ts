import type { MailActionCapabilityMap, MailActionContext } from "@/lib/message-actions/types";
import type { MailFolder } from "@/lib/mail-types";
import { findGmailSystemMailboxPath } from "@/lib/providers/gmail";

function matchesFolderName(pathOrName: string, variants: string[]) {
  const normalized = pathOrName.trim().toLowerCase();
  return variants.some(
    (variant) =>
      normalized === variant ||
      normalized.endsWith(`/${variant}`) ||
      normalized.endsWith(`.${variant}`)
  );
}

function findFolderPath(
  folders: MailFolder[],
  specialUseValues: string[],
  nameVariants: string[]
) {
  const bySpecialUse = folders.find((folder) =>
    specialUseValues.includes(folder.specialUse ?? "")
  );
  if (bySpecialUse) {
    return bySpecialUse.path;
  }

  const byName = folders.find(
    (folder) =>
      matchesFolderName(folder.name, nameVariants) ||
      matchesFolderName(folder.path, nameVariants)
  );
  return byName?.path;
}

export function resolveMailActionCapabilities(
  context: MailActionContext,
  folders: MailFolder[]
): MailActionCapabilityMap {
  const currentSystemKey = context.currentMailboxSystemKey ?? null;
  const archiveFolder =
    context.providerKind === "gmail"
      ? findGmailSystemMailboxPath(folders, "archive") ??
        findFolderPath(folders, ["\\Archive", "\\\\Archive"], ["archive", "all mail"])
      : findFolderPath(folders, ["\\Archive", "\\\\Archive"], ["archive"]);
  const spamFolder =
    context.providerKind === "gmail"
      ? findGmailSystemMailboxPath(folders, "spam") ??
        findFolderPath(folders, ["\\Junk", "\\\\Junk"], ["spam", "junk"])
      : findFolderPath(folders, ["\\Junk", "\\\\Junk"], ["spam", "junk"]);
  const inboxFolder =
    (context.providerKind === "gmail"
      ? findGmailSystemMailboxPath(folders, "inbox")
      : undefined) ??
    findFolderPath(folders, ["\\Inbox", "\\\\Inbox"], ["inbox"]) ??
    "INBOX";

  const moveSupported = folders.length > 0;
  const inSpamFolder =
    currentSystemKey === "spam" ||
    (spamFolder ? context.currentFolderPath === spamFolder : false);
  const inArchiveFolder =
    currentSystemKey === "archive" ||
    (archiveFolder ? context.currentFolderPath === archiveFolder : false);
  const inTrashFolder =
    currentSystemKey === "trash" ||
    matchesFolderName(context.currentFolderPath, ["trash", "deleted"]);

  return {
    archive: archiveFolder
      ? {
          supported: !inArchiveFolder,
          reason:
            inArchiveFolder
              ? "Already in Archive."
              : undefined,
          destinationFolder: archiveFolder
        }
      : { supported: false, reason: "Archive folder unavailable." },
    delete: { supported: true },
    mark_read: { supported: true },
    mark_unread: { supported: true },
    star: {
      supported: Boolean(context.providerCapabilities.usesSmtpSend)
    },
    unstar: {
      supported: Boolean(context.providerCapabilities.usesSmtpSend)
    },
    spam: spamFolder
      ? {
          supported: !inSpamFolder,
          reason: inSpamFolder ? "Already in Spam." : undefined,
          destinationFolder: spamFolder
        }
      : { supported: false, reason: "Spam folder unavailable." },
    not_spam: spamFolder
      ? {
          supported: inSpamFolder,
          reason: !inSpamFolder ? "Not in Spam." : undefined,
          destinationFolder: inboxFolder
        }
      : { supported: false, reason: "Spam folder unavailable." },
    move: moveSupported
      ? { supported: true }
      : { supported: false, reason: "No destination folders available." },
    restore:
      inSpamFolder || inArchiveFolder || inTrashFolder
        ? {
            supported: true,
            destinationFolder: inboxFolder
          }
        : { supported: false, reason: "Nothing to restore from this folder." }
  };
}
