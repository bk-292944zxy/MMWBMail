-- CreateTable
CREATE TABLE "AppUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DomainVerificationCache" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "domain" TEXT NOT NULL,
    "dmarcPolicy" TEXT,
    "bimiVerified" BOOLEAN NOT NULL DEFAULT false,
    "bimiLogoUrl" TEXT,
    "spfPresent" BOOLEAN NOT NULL DEFAULT false,
    "trancoRank" INTEGER,
    "isEsp" BOOLEAN NOT NULL DEFAULT false,
    "cachedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TrancoSync" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "syncedAt" DATETIME NOT NULL,
    "domainCount" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "BrandDomain" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "brand" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "source" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "MailAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'GENERIC_IMAP_SMTP',
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserPreferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "prioritizedSenders" TEXT NOT NULL DEFAULT '[]',
    "autoFilters" TEXT NOT NULL DEFAULT '[]',
    "blockedSenders" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserPreferences_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerScope" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastValidatedAt" DATETIME,
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
CREATE UNIQUE INDEX "AppUser_email_key" ON "AppUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DomainVerificationCache_domain_key" ON "DomainVerificationCache"("domain");

-- CreateIndex
CREATE INDEX "DomainVerificationCache_domain_idx" ON "DomainVerificationCache"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "BrandDomain_brand_domain_key" ON "BrandDomain"("brand", "domain");

-- CreateIndex
CREATE INDEX "MailAccount_userId_idx" ON "MailAccount"("userId");

-- CreateIndex
CREATE INDEX "MailAccount_userId_isDefault_idx" ON "MailAccount"("userId", "isDefault");

-- CreateIndex
CREATE INDEX "MailAccount_userId_email_idx" ON "MailAccount"("userId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "MailAccount_userId_connection_key" ON "MailAccount"("userId", "email", "imapHost", "imapPort", "smtpHost", "smtpPort");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreferences_accountId_key" ON "UserPreferences"("accountId");

-- CreateIndex
CREATE INDEX "AiCredential_ownerType_provider_idx" ON "AiCredential"("ownerType", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "AiCredential_ownerScope_provider_key" ON "AiCredential"("ownerScope", "provider");

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

-- Seed local owner bootstrap record.
INSERT OR IGNORE INTO "AppUser" ("id", "email", "displayName", "createdAt", "updatedAt")
VALUES ('local-owner-primary', 'local@maximail.local', 'Local Owner', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
