import { MailAccountProvider, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getMailAccountProviderInfo } from "@/lib/mail-provider-metadata";
import { normalizeMailConnectionWithProviderDefaults } from "@/lib/mail-provider-profiles";
import { mailSecretStore } from "@/lib/mail-secret-store";
import { getLocalOwnerId } from "@/lib/local-owner";
import { decryptStoredSecret } from "@/lib/secret-crypto";
import type { MailAccountSummary, MailConnectionPayload } from "@/lib/mail-types";

type PersistedMailAccountRecord = Awaited<ReturnType<typeof prisma.mailAccount.findFirst>>;
const EXTERNAL_MAIL_SECRET_MARKER = "__external_mail_secret__";

export type CreateMailAccountInput = {
  label?: string;
  provider?: string | null;
} & MailConnectionPayload;

function isMissingMailAccountUpdate(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  );
}

function toSummary(account: NonNullable<PersistedMailAccountRecord>): MailAccountSummary {
  const provider = getMailAccountProviderInfo({
    provider: account.provider,
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
  const userId = await getLocalOwnerId();
  const accounts = await prisma.mailAccount.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
  });

  return accounts.map(toSummary);
}

export async function listActiveMailAccounts() {
  const userId = await getLocalOwnerId();
  const accounts = await prisma.mailAccount.findMany({
    where: { userId, isActive: true },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
  });

  return accounts.map(toSummary);
}

export async function createMailAccount(input: CreateMailAccountInput) {
  const userId = await getLocalOwnerId();
  const accountCount = await prisma.mailAccount.count({
    where: { userId }
  });
  const normalizedInput = normalizeMailConnectionWithProviderDefaults(input);
  const normalizedEmail = normalizedInput.connection.email;
  const normalizedImapHost = normalizedInput.connection.imapHost;
  const normalizedSmtpHost = normalizedInput.connection.smtpHost;
  const trimmedPassword = normalizedInput.connection.password.trim();
  const persistedProvider = normalizedInput.persistedProvider as MailAccountProvider;
  const targetFolder = normalizedInput.connection.folder?.trim() || "INBOX";
  const existing = await prisma.mailAccount.findFirst({
    where: {
      userId,
      email: normalizedEmail,
      imapHost: normalizedImapHost,
      imapPort: normalizedInput.connection.imapPort,
      smtpHost: normalizedSmtpHost,
      smtpPort: normalizedInput.connection.smtpPort
    }
  });

  if (!existing && !trimmedPassword) {
    throw new Error("Password is required when adding a new account.");
  }

  let account;

  if (existing) {
    try {
      if (trimmedPassword) {
        await mailSecretStore.setPassword(existing.id, trimmedPassword);
      }

      account = await prisma.mailAccount.update({
        where: { id: existing.id },
        data: {
          label: input.label?.trim() || input.email,
          email: normalizedEmail,
          imapHost: normalizedImapHost,
          imapPort: normalizedInput.connection.imapPort,
          imapSecure: normalizedInput.connection.imapSecure,
          smtpHost: normalizedSmtpHost,
          smtpPort: normalizedInput.connection.smtpPort,
          smtpSecure: normalizedInput.connection.smtpSecure,
          provider: persistedProvider,
          encryptedPassword: trimmedPassword
            ? EXTERNAL_MAIL_SECRET_MARKER
            : existing.encryptedPassword,
          defaultFolder: targetFolder || existing.defaultFolder || "INBOX",
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
          userId,
          provider: persistedProvider,
          email: normalizedEmail,
          imapHost: normalizedImapHost,
          imapPort: normalizedInput.connection.imapPort,
          imapSecure: normalizedInput.connection.imapSecure,
          smtpHost: normalizedSmtpHost,
          smtpPort: normalizedInput.connection.smtpPort,
          smtpSecure: normalizedInput.connection.smtpSecure,
          encryptedPassword: EXTERNAL_MAIL_SECRET_MARKER,
          defaultFolder: targetFolder,
          isActive: true,
          isDefault: accountCount === 0
        }
      });

  if (!existing) {
    try {
      await mailSecretStore.setPassword(account.id, trimmedPassword);
    } catch (error) {
      await prisma.mailAccount.deleteMany({
        where: {
          id: account.id,
          userId
        }
      });
      throw error;
    }
  }

  return toSummary(account);
}

export async function getMailAccount(accountId: string) {
  const userId = await getLocalOwnerId();
  const account = await prisma.mailAccount.findFirst({
    where: { id: accountId, userId }
  });

  return account ? toSummary(account) : null;
}

export async function setDefaultMailAccount(accountId: string) {
  const userId = await getLocalOwnerId();
  const target = await prisma.mailAccount.findFirst({
    where: { id: accountId, userId },
    select: { id: true }
  });

  if (!target) {
    throw new Error("Mail account not found.");
  }

  await prisma.$transaction([
    prisma.mailAccount.updateMany({
      data: { isDefault: false },
      where: { userId }
    }),
    prisma.mailAccount.updateMany({
      where: { id: accountId, userId },
      data: { isDefault: true }
    })
  ]);
}

export async function deleteMailAccount(accountId: string) {
  const userId = await getLocalOwnerId();
  const account = await prisma.mailAccount.findFirst({
    where: { id: accountId, userId }
  });

  if (!account) {
    return { deletedAccountId: accountId, nextAccountId: null };
  }

  const remainingCandidates = await prisma.mailAccount.findMany({
    where: {
      userId,
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
        where: { userId }
      });
      await tx.mailAccount.update({
        where: { id: nextAccount.id },
        data: { isDefault: true }
      });
    }
  });

  await mailSecretStore.deletePassword(accountId);

  return {
    deletedAccountId: accountId,
    nextAccountId: nextAccount?.id ?? null
  };
}

export async function requireMailAccountConnection(accountId: string, folder?: string) {
  const userId = await getLocalOwnerId();
  const account = await prisma.mailAccount.findFirst({
    where: { id: accountId, userId }
  });

  if (!account) {
    throw new Error("Mail account not found.");
  }

  let password = await mailSecretStore.getPassword(account.id);

  if (!password && account.encryptedPassword && account.encryptedPassword !== EXTERNAL_MAIL_SECRET_MARKER) {
    try {
      password = decryptStoredSecret(account.encryptedPassword);
    } catch {
      password = null;
    }
    if (password) {
      await Promise.all([
        mailSecretStore.setPassword(account.id, password),
        prisma.mailAccount.updateMany({
          where: { id: account.id, userId },
          data: {
            encryptedPassword: EXTERNAL_MAIL_SECRET_MARKER
          }
        })
      ]);
    }
  }

  if (!password) {
    throw new Error("Mail account credential is unavailable. Update the account password and try again.");
  }

  return {
    account,
    connection: {
      email: account.email,
      password,
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
  const userId = await getLocalOwnerId();
  await prisma.mailAccount.updateMany({
    where: { id: accountId, userId },
    data: {
      lastSyncedAt: input.lastSyncedAt,
      lastError: input.lastError ?? null
    }
  });
}
