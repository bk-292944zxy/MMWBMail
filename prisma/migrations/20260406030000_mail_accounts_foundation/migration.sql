-- CreateTable
CREATE TABLE "MailAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "imapHost" TEXT NOT NULL,
    "imapPort" INTEGER NOT NULL,
    "imapSecure" BOOLEAN NOT NULL DEFAULT true,
    "smtpHost" TEXT NOT NULL,
    "smtpPort" INTEGER NOT NULL,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
    "encryptedPassword" TEXT NOT NULL,
    "defaultFolder" TEXT NOT NULL DEFAULT 'INBOX',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MailboxFolder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialUse" TEXT,
    "messageCount" INTEGER,
    "unreadCount" INTEGER,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MailboxFolder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoredMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "uid" INTEGER NOT NULL,
    "messageId" TEXT NOT NULL,
    "inReplyTo" TEXT,
    "references" TEXT,
    "threadId" TEXT,
    "authResultsDmarc" TEXT,
    "authResultsSpf" TEXT,
    "authResultsDkim" TEXT,
    "listUnsubscribeUrl" TEXT,
    "listUnsubscribeEmail" TEXT,
    "fromName" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "cc" TEXT,
    "toJson" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "preview" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "seen" BOOLEAN NOT NULL DEFAULT false,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "answered" BOOLEAN NOT NULL DEFAULT false,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "remoteDeletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StoredMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoredMessage_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "MailboxFolder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoredMessageBody" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storedMessageId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "emailBody" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StoredMessageBody_storedMessageId_fkey" FOREIGN KEY ("storedMessageId") REFERENCES "StoredMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MailSyncState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "lastSyncedAt" DATETIME,
    "lastFullSyncAt" DATETIME,
    "lastUid" INTEGER,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MailSyncState_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MailSyncState_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "MailboxFolder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MailAccountEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "folderPath" TEXT,
    "messageUid" INTEGER,
    "type" TEXT NOT NULL,
    "payloadJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MailAccountEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MailAccount_email_idx" ON "MailAccount"("email");

-- CreateIndex
CREATE INDEX "MailAccount_isDefault_idx" ON "MailAccount"("isDefault");

-- CreateIndex
CREATE INDEX "MailboxFolder_accountId_idx" ON "MailboxFolder"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxFolder_accountId_path_key" ON "MailboxFolder"("accountId", "path");

-- CreateIndex
CREATE INDEX "StoredMessage_accountId_date_idx" ON "StoredMessage"("accountId", "date");

-- CreateIndex
CREATE INDEX "StoredMessage_folderId_date_idx" ON "StoredMessage"("folderId", "date");

-- CreateIndex
CREATE INDEX "StoredMessage_messageId_idx" ON "StoredMessage"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "StoredMessage_accountId_folderId_uid_key" ON "StoredMessage"("accountId", "folderId", "uid");

-- CreateIndex
CREATE UNIQUE INDEX "StoredMessageBody_storedMessageId_key" ON "StoredMessageBody"("storedMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "MailSyncState_folderId_key" ON "MailSyncState"("folderId");

-- CreateIndex
CREATE INDEX "MailSyncState_accountId_idx" ON "MailSyncState"("accountId");

-- CreateIndex
CREATE INDEX "MailAccountEvent_accountId_createdAt_idx" ON "MailAccountEvent"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "MailAccountEvent_accountId_folderPath_idx" ON "MailAccountEvent"("accountId", "folderPath");
