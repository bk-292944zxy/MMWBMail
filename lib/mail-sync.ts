import { prisma } from "@/lib/prisma";
import { requireMailAccountConnection, setMailAccountSyncStatus } from "@/lib/mail-accounts";
import {
  getAccountMessageViaProvider,
  listAccountMailboxesViaProvider,
  syncAccountMailboxViaProvider
} from "@/lib/mail-provider";
import type { MailDetail, MailFolder, MailSummary, ReceivedMessageMedia } from "@/lib/mail-types";

type SyncMailAccountOptions = {
  folderPaths?: string[];
  includeBodies?: boolean;
};

const MEDIA_FETCH_TIMEOUT_MS = 2500;
const MESSAGE_MEDIA_CACHE_TTL_MS = 5 * 60 * 1000;
const messageMediaCache = new Map<
  string,
  {
    media: ReceivedMessageMedia[];
    fetchedAt: number;
  }
>();
const messageMediaInflight = new Map<string, Promise<ReceivedMessageMedia[] | null>>();

export type MailSyncResult = {
  accountId: string;
  syncedAt: string;
  foldersSynced: number;
  messagesUpserted: number;
  messagesDeleted: number;
  bodiesFetched: number;
};

function serializeRecipients(recipients: string[]) {
  return JSON.stringify(recipients);
}

function parseRecipients(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function escapeFallbackHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildStoredBodyFallback(subject: string, preview: string) {
  const normalizedPreview = preview.trim();
  const normalizedSubject = subject.trim();
  const previewMatchesSubject =
    normalizedPreview.length > 0 &&
    normalizedSubject.length > 0 &&
    normalizedPreview.localeCompare(normalizedSubject, undefined, {
      sensitivity: "accent"
    }) === 0;
  const text =
    normalizedPreview && !previewMatchesSubject
      ? normalizedPreview
      : "Loading message body...";
  return {
    text,
    html: `<p>${escapeFallbackHtml(text)}</p>`,
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
    </style>
  </head>
  <body><p>${escapeFallbackHtml(text)}</p></body>
</html>`
  };
}

function mapStoredFolder(folder: {
  path: string;
  name: string;
  specialUse: string | null;
  messageCount: number | null;
  unreadCount: number | null;
}): MailFolder {
  return {
    path: folder.path,
    name: folder.name,
    specialUse: folder.specialUse,
    count: folder.messageCount,
    unread: folder.unreadCount
  };
}

function mapStoredSummary(message: {
  uid: number;
  messageId: string;
  inReplyTo: string | null;
  references: string | null;
  threadId: string | null;
  authResultsDmarc: string | null;
  authResultsSpf: string | null;
  authResultsDkim: string | null;
  listUnsubscribeUrl: string | null;
  listUnsubscribeEmail: string | null;
  fromName: string;
  fromAddress: string;
  cc: string | null;
  toJson: string;
  subject: string;
  preview: string;
  date: Date;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  hasAttachments: boolean;
}): MailSummary {
  return {
    uid: message.uid,
    messageId: message.messageId,
    inReplyTo: message.inReplyTo ?? undefined,
    references: message.references ?? undefined,
    threadId: message.threadId ?? undefined,
    authResultsDmarc:
      (message.authResultsDmarc as MailSummary["authResultsDmarc"] | null) ?? undefined,
    authResultsSpf:
      (message.authResultsSpf as MailSummary["authResultsSpf"] | null) ?? undefined,
    authResultsDkim:
      (message.authResultsDkim as MailSummary["authResultsDkim"] | null) ?? undefined,
    listUnsubscribeUrl: message.listUnsubscribeUrl ?? undefined,
    listUnsubscribeEmail: message.listUnsubscribeEmail ?? undefined,
    from: message.fromName,
    fromAddress: message.fromAddress,
    cc: message.cc ?? undefined,
    to: parseRecipients(message.toJson),
    subject: message.subject,
    preview: message.preview,
    date: message.date.toISOString(),
    seen: message.seen,
    flagged: message.flagged,
    answered: message.answered,
    hasAttachments: message.hasAttachments
  };
}

function mapStoredDetail(message: {
  uid: number;
  messageId: string;
  inReplyTo: string | null;
  references: string | null;
  threadId: string | null;
  authResultsDmarc: string | null;
  authResultsSpf: string | null;
  authResultsDkim: string | null;
  listUnsubscribeUrl: string | null;
  listUnsubscribeEmail: string | null;
  fromName: string;
  fromAddress: string;
  cc: string | null;
  toJson: string;
  subject: string;
  preview: string;
  date: Date;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  hasAttachments: boolean;
  body: {
    text: string;
    html: string;
    emailBody: string;
  } | null;
}, input?: {
  media?: ReceivedMessageMedia[];
}): MailDetail {
  const fallbackBody = buildStoredBodyFallback(message.subject, message.preview);
  return {
    ...mapStoredSummary(message),
    text: message.body?.text ?? fallbackBody.text,
    html: message.body?.html ?? fallbackBody.html,
    emailBody: message.body?.emailBody ?? fallbackBody.emailBody,
    media: input?.media
  };
}

function buildMessageMediaCacheKey(accountId: string, folderPath: string, uid: number) {
  return `${accountId}:${folderPath}:${uid}`;
}

function readCachedMessageMedia(cacheKey: string) {
  const cached = messageMediaCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.fetchedAt > MESSAGE_MEDIA_CACHE_TTL_MS) {
    messageMediaCache.delete(cacheKey);
    return null;
  }

  return cached.media;
}

async function loadMessageMedia(
  accountId: string,
  folderPath: string,
  uid: number
): Promise<ReceivedMessageMedia[] | null> {
  const cacheKey = buildMessageMediaCacheKey(accountId, folderPath, uid);
  const cached = readCachedMessageMedia(cacheKey);
  if (cached) {
    return cached;
  }

  const existingInflight = messageMediaInflight.get(cacheKey);
  if (existingInflight) {
    return existingInflight;
  }

  const mediaPromise = (async () => {
    try {
      const providerDetail = (await Promise.race([
        getAccountMessageViaProvider(accountId, folderPath, uid),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), MEDIA_FETCH_TIMEOUT_MS);
        })
      ])) as Awaited<ReturnType<typeof getAccountMessageViaProvider>> | null;
      const media = Array.isArray(providerDetail?.media) ? providerDetail.media : [];
      if (media.length === 0) {
        return null;
      }
      messageMediaCache.set(cacheKey, {
        media,
        fetchedAt: Date.now()
      });
      return media;
    } catch {
      return null;
    } finally {
      messageMediaInflight.delete(cacheKey);
    }
  })();

  messageMediaInflight.set(cacheKey, mediaPromise);
  return mediaPromise;
}

async function upsertMessageBodyWithTimeout(
  accountId: string,
  folderPath: string,
  uid: number,
  timeoutMs = 4000
) {
  return Promise.race([
    upsertMessageBody(accountId, folderPath, uid),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    })
  ]);
}

async function upsertMessageBody(accountId: string, folderPath: string, uid: number) {
  const detail = await getAccountMessageViaProvider(accountId, folderPath, uid);

  if (!detail) {
    return null;
  }

  const storedMessage = await prisma.storedMessage.findFirst({
    where: {
      accountId,
      folder: { path: folderPath },
      uid
    },
    select: {
      id: true
    }
  });

  if (!storedMessage) {
    return null;
  }

  await prisma.storedMessageBody.upsert({
    where: { storedMessageId: storedMessage.id },
    create: {
      storedMessageId: storedMessage.id,
      text: detail.text,
      html: detail.html,
      emailBody: detail.emailBody,
      fetchedAt: new Date()
    },
    update: {
      text: detail.text,
      html: detail.html,
      emailBody: detail.emailBody,
      fetchedAt: new Date()
    }
  });

  return detail;
}

export async function syncMailAccount(
  accountId: string,
  options: SyncMailAccountOptions = {}
): Promise<MailSyncResult> {
  const { account, connection } = await requireMailAccountConnection(accountId);
  const now = new Date();
  let foldersSynced = 0;
  let messagesUpserted = 0;
  let messagesDeleted = 0;
  let bodiesFetched = 0;

  try {
    const remoteFolders = await listAccountMailboxesViaProvider(accountId);
    const targetPaths = new Set(options.folderPaths?.length ? options.folderPaths : remoteFolders.map((folder) => folder.path));
    const syncFolders = remoteFolders.filter((folder) => targetPaths.has(folder.path));

    for (const remoteFolder of syncFolders) {
      const folderRecord = await prisma.mailboxFolder.upsert({
        where: {
          accountId_path: {
            accountId,
            path: remoteFolder.path
          }
        },
        create: {
          accountId,
          path: remoteFolder.path,
          name: remoteFolder.name,
          specialUse: remoteFolder.specialUse,
          messageCount: remoteFolder.count,
          unreadCount: remoteFolder.unread,
          lastSyncedAt: now
        },
        update: {
          name: remoteFolder.name,
          specialUse: remoteFolder.specialUse,
          messageCount: remoteFolder.count,
          unreadCount: remoteFolder.unread,
          lastSyncedAt: now
        }
      });

      const remoteMessages = (
        await syncAccountMailboxViaProvider({
          accountId,
          folderPath: remoteFolder.path
        })
      ).messages;
      const remoteUidSet = new Set(remoteMessages.map((message) => message.uid));
      const existingMessages = await prisma.storedMessage.findMany({
        where: {
          accountId,
          folderId: folderRecord.id,
          remoteDeletedAt: null
        },
        select: {
          id: true,
          uid: true
        }
      });
      const existingByUid = new Map(existingMessages.map((message) => [message.uid, message.id]));

      for (const remoteMessage of remoteMessages) {
        const stored = await prisma.storedMessage.upsert({
          where: {
            accountId_folderId_uid: {
              accountId,
              folderId: folderRecord.id,
              uid: remoteMessage.uid
            }
          },
          create: {
            accountId,
            folderId: folderRecord.id,
            uid: remoteMessage.uid,
            messageId: remoteMessage.messageId,
            inReplyTo: remoteMessage.inReplyTo,
            references: remoteMessage.references,
            threadId: remoteMessage.threadId,
            authResultsDmarc: remoteMessage.authResultsDmarc,
            authResultsSpf: remoteMessage.authResultsSpf,
            authResultsDkim: remoteMessage.authResultsDkim,
            listUnsubscribeUrl: remoteMessage.listUnsubscribeUrl,
            listUnsubscribeEmail: remoteMessage.listUnsubscribeEmail,
            fromName: remoteMessage.from,
            fromAddress: remoteMessage.fromAddress,
            cc: remoteMessage.cc ?? null,
            toJson: serializeRecipients(remoteMessage.to),
            subject: remoteMessage.subject,
            preview: remoteMessage.preview,
            date: new Date(remoteMessage.date),
            seen: remoteMessage.seen,
            flagged: remoteMessage.flagged,
            answered: remoteMessage.answered,
            hasAttachments: remoteMessage.hasAttachments,
            remoteDeletedAt: null
          },
          update: {
            messageId: remoteMessage.messageId,
            inReplyTo: remoteMessage.inReplyTo,
            references: remoteMessage.references,
            threadId: remoteMessage.threadId,
            authResultsDmarc: remoteMessage.authResultsDmarc,
            authResultsSpf: remoteMessage.authResultsSpf,
            authResultsDkim: remoteMessage.authResultsDkim,
            listUnsubscribeUrl: remoteMessage.listUnsubscribeUrl,
            listUnsubscribeEmail: remoteMessage.listUnsubscribeEmail,
            fromName: remoteMessage.from,
            fromAddress: remoteMessage.fromAddress,
            cc: remoteMessage.cc ?? null,
            toJson: serializeRecipients(remoteMessage.to),
            subject: remoteMessage.subject,
            preview: remoteMessage.preview,
            date: new Date(remoteMessage.date),
            seen: remoteMessage.seen,
            flagged: remoteMessage.flagged,
            answered: remoteMessage.answered,
            hasAttachments: remoteMessage.hasAttachments,
            remoteDeletedAt: null
          }
        });

        messagesUpserted += 1;

        if (options.includeBodies) {
          const detail = await upsertMessageBody(accountId, remoteFolder.path, remoteMessage.uid);
          if (detail) {
            bodiesFetched += 1;
          }
        } else if (!existingByUid.has(remoteMessage.uid)) {
          await prisma.mailAccountEvent.create({
            data: {
              accountId,
              folderPath: remoteFolder.path,
              messageUid: remoteMessage.uid,
              type: "message.created"
            }
          });
        }

        existingByUid.set(remoteMessage.uid, stored.id);
      }

      const deletedUids = existingMessages
        .map((message) => message.uid)
        .filter((uid) => !remoteUidSet.has(uid));

      if (deletedUids.length > 0) {
        const deletedResult = await prisma.storedMessage.updateMany({
          where: {
            accountId,
            folderId: folderRecord.id,
            uid: {
              in: deletedUids
            },
            remoteDeletedAt: null
          },
          data: {
            remoteDeletedAt: now
          }
        });
        messagesDeleted += deletedResult.count;

        await prisma.mailAccountEvent.createMany({
          data: deletedUids.map((uid) => ({
            accountId,
            folderPath: remoteFolder.path,
            messageUid: uid,
            type: "message.deleted",
            createdAt: now
          }))
        });
      }

      await prisma.mailSyncState.upsert({
        where: {
          folderId: folderRecord.id
        },
        create: {
          accountId,
          folderId: folderRecord.id,
          lastSyncedAt: now,
          lastFullSyncAt: now,
          lastUid: remoteMessages.reduce((max, message) => Math.max(max, message.uid), 0),
          lastError: null
        },
        update: {
          lastSyncedAt: now,
          lastFullSyncAt: now,
          lastUid: remoteMessages.reduce((max, message) => Math.max(max, message.uid), 0),
          lastError: null
        }
      });

      foldersSynced += 1;
    }

    await setMailAccountSyncStatus(account.id, { lastSyncedAt: now, lastError: null });

    return {
      accountId,
      syncedAt: now.toISOString(),
      foldersSynced,
      messagesUpserted,
      messagesDeleted,
      bodiesFetched
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync mail account.";
    await setMailAccountSyncStatus(account.id, { lastError: message });
    throw error;
  }
}

export async function listSyncedFolders(accountId: string) {
  const folders = await prisma.mailboxFolder.findMany({
    where: { accountId },
    orderBy: [{ specialUse: "asc" }, { name: "asc" }]
  });

  return folders.map(mapStoredFolder);
}

export async function listSyncedMessages(accountId: string, folderPath: string) {
  const messages = await prisma.storedMessage.findMany({
    where: {
      accountId,
      folder: {
        path: folderPath
      },
      remoteDeletedAt: null
    },
    orderBy: {
      date: "desc"
    }
  });

  return messages.map(mapStoredSummary);
}

export async function getSyncedMessageDetail(accountId: string, folderPath: string, uid: number) {
  let message = await prisma.storedMessage.findFirst({
    where: {
      accountId,
      folder: { path: folderPath },
      uid,
      remoteDeletedAt: null
    },
    include: {
      body: true
    }
  });

  if (!message) {
    return null;
  }

  const mediaCacheKey = buildMessageMediaCacheKey(accountId, folderPath, uid);
  let detailMedia = readCachedMessageMedia(mediaCacheKey);

  if (!message.body) {
    try {
      const detail = await upsertMessageBodyWithTimeout(accountId, folderPath, uid, 1500);
      if (Array.isArray(detail?.media) && detail.media.length > 0) {
        detailMedia = detail.media;
        messageMediaCache.set(mediaCacheKey, {
          media: detail.media,
          fetchedAt: Date.now()
        });
      }
      if (!detail) {
        void upsertMessageBody(accountId, folderPath, uid).catch((error) => {
          console.error("mmwbmail: deferred message body fetch failed", {
            accountId,
            folderPath,
            uid,
            error
          });
        });
      }
      message = await prisma.storedMessage.findFirst({
        where: {
          accountId,
          folder: { path: folderPath },
          uid,
          remoteDeletedAt: null
        },
        include: {
          body: true
        }
      });
    } catch (error) {
      console.error("mmwbmail: message body fetch failed", {
        accountId,
        folderPath,
        uid,
        error
      });
    }
  }

  if (!message) {
    return null;
  }

  if (message.hasAttachments && (!detailMedia || detailMedia.length === 0)) {
    const loadedMedia = await loadMessageMedia(accountId, folderPath, uid);
    if (loadedMedia && loadedMedia.length > 0) {
      detailMedia = loadedMedia;
    }
  }

  return mapStoredDetail(message, {
    media: detailMedia ?? undefined
  });
}
