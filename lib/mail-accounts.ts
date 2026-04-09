import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";

import { getMailAccountSecret } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getMailAccountProviderInfo } from "@/lib/mail-provider-metadata";
import type { MailAccountSummary, MailConnectionPayload } from "@/lib/mail-types";

type PersistedMailAccountRecord = Awaited<ReturnType<typeof prisma.mailAccount.findUnique>>;

export type CreateMailAccountInput = {
  label?: string;
} & MailConnectionPayload;

function isMissingMailAccountUpdate(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  );
}

function getEncryptionKey() {
  const seed = getMailAccountSecret();

  return createHash("sha256").update(seed).digest();
}

function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decryptSecret(value: string) {
  const decoded = Buffer.from(value, "base64");
  const iv = decoded.subarray(0, 12);
  const authTag = decoded.subarray(12, 28);
  const encrypted = decoded.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function toSummary(account: NonNullable<PersistedMailAccountRecord>): MailAccountSummary {
  const provider = getMailAccountProviderInfo({
    email: account.email,
    imapHost: account.imapHost,
    smtpHost: account.smtpHost
  });

  return {
    id: account.id,
    label: account.label,
    email: account.email,
    imapHost: account.imapHost,
    imapPort: account.imapPort,
    imapSecure: account.imapSecure,
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    smtpSecure: account.smtpSecure,
    defaultFolder: account.defaultFolder,
    isActive: account.isActive,
    isDefault: account.isDefault,
    lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
    lastError: account.lastError ?? null,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
    provider
  };
}

export async function listMailAccounts() {
  const accounts = await prisma.mailAccount.findMany({
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
  });

  return accounts.map(toSummary);
}

export async function listActiveMailAccounts() {
  const accounts = await prisma.mailAccount.findMany({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
  });

  return accounts.map(toSummary);
}

export async function createMailAccount(input: CreateMailAccountInput) {
  const accountCount = await prisma.mailAccount.count();
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedImapHost = input.imapHost.trim().toLowerCase();
  const normalizedSmtpHost = input.smtpHost.trim().toLowerCase();
  const trimmedPassword = input.password.trim();
  const existing = await prisma.mailAccount.findFirst({
    where: {
      email: normalizedEmail,
      imapHost: normalizedImapHost,
      imapPort: input.imapPort,
      smtpHost: normalizedSmtpHost,
      smtpPort: input.smtpPort
    }
  });

  if (!existing && !trimmedPassword) {
    throw new Error("Password is required when adding a new account.");
  }

  let account;

  if (existing) {
    try {
      account = await prisma.mailAccount.update({
        where: { id: existing.id },
        data: {
          label: input.label?.trim() || input.email,
          email: normalizedEmail,
          imapHost: normalizedImapHost,
          imapPort: input.imapPort,
          imapSecure: input.imapSecure,
          smtpHost: normalizedSmtpHost,
          smtpPort: input.smtpPort,
          smtpSecure: input.smtpSecure,
          encryptedPassword: trimmedPassword
            ? encryptSecret(trimmedPassword)
            : existing.encryptedPassword,
          defaultFolder: input.folder?.trim() || existing.defaultFolder || "INBOX",
          isActive: true
        }
      });
    } catch (error) {
      if (!isMissingMailAccountUpdate(error)) {
        throw error;
      }
    }
  }

  account ??= await prisma.mailAccount.create({
        data: {
          label: input.label?.trim() || input.email,
          email: normalizedEmail,
          imapHost: normalizedImapHost,
          imapPort: input.imapPort,
          imapSecure: input.imapSecure,
          smtpHost: normalizedSmtpHost,
          smtpPort: input.smtpPort,
          smtpSecure: input.smtpSecure,
          encryptedPassword: encryptSecret(trimmedPassword),
          defaultFolder: input.folder?.trim() || "INBOX",
          isActive: true,
          isDefault: accountCount === 0
        }
      });

  return toSummary(account);
}

export async function getMailAccount(accountId: string) {
  const account = await prisma.mailAccount.findUnique({
    where: { id: accountId }
  });

  return account ? toSummary(account) : null;
}

export async function setDefaultMailAccount(accountId: string) {
  await prisma.$transaction([
    prisma.mailAccount.updateMany({
      data: { isDefault: false },
      where: {}
    }),
    prisma.mailAccount.update({
      where: { id: accountId },
      data: { isDefault: true }
    })
  ]);
}

export async function deleteMailAccount(accountId: string) {
  const account = await prisma.mailAccount.findUnique({
    where: { id: accountId }
  });

  if (!account) {
    return { deletedAccountId: accountId, nextAccountId: null };
  }

  const remainingCandidates = await prisma.mailAccount.findMany({
    where: {
      NOT: { id: accountId }
    },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
  });

  const nextAccount = remainingCandidates[0] ?? null;

  await prisma.$transaction(async (tx) => {
    const folders = await tx.mailboxFolder.findMany({
      where: { accountId },
      select: { id: true }
    });
    const folderIds = folders.map((folder) => folder.id);

    if (folderIds.length > 0) {
      const messages = await tx.storedMessage.findMany({
        where: {
          accountId,
          folderId: {
            in: folderIds
          }
        },
        select: { id: true }
      });
      const messageIds = messages.map((message) => message.id);

      if (messageIds.length > 0) {
        await tx.storedMessageBody.deleteMany({
          where: {
            storedMessageId: {
              in: messageIds
            }
          }
        });
      }

      await tx.storedMessage.deleteMany({
        where: {
          accountId,
          folderId: {
            in: folderIds
          }
        }
      });

      await tx.mailSyncState.deleteMany({
        where: {
          accountId
        }
      });

      await tx.mailboxFolder.deleteMany({
        where: {
          accountId
        }
      });
    }

    await tx.mailAccountEvent.deleteMany({
      where: { accountId }
    });

    await tx.userPreferences.deleteMany({
      where: { accountId }
    });

    await tx.mailAccount.delete({
      where: { id: accountId }
    });

    if (account.isDefault && nextAccount) {
      await tx.mailAccount.updateMany({
        data: { isDefault: false },
        where: {}
      });
      await tx.mailAccount.update({
        where: { id: nextAccount.id },
        data: { isDefault: true }
      });
    }
  });

  return {
    deletedAccountId: accountId,
    nextAccountId: nextAccount?.id ?? null
  };
}

export async function requireMailAccountConnection(accountId: string, folder?: string) {
  const account = await prisma.mailAccount.findUnique({
    where: { id: accountId }
  });

  if (!account) {
    throw new Error("Mail account not found.");
  }

  return {
    account,
    connection: {
      email: account.email,
      password: decryptSecret(account.encryptedPassword),
      imapHost: account.imapHost,
      imapPort: account.imapPort,
      imapSecure: account.imapSecure,
      smtpHost: account.smtpHost,
      smtpPort: account.smtpPort,
      smtpSecure: account.smtpSecure,
      folder: folder || account.defaultFolder
    } satisfies MailConnectionPayload
  };
}

export async function setMailAccountSyncStatus(
  accountId: string,
  input: { lastSyncedAt?: Date | null; lastError?: string | null }
) {
  await prisma.mailAccount.update({
    where: { id: accountId },
    data: {
      lastSyncedAt: input.lastSyncedAt,
      lastError: input.lastError ?? null
    }
  });
}
