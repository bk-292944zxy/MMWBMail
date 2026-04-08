-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "DomainVerificationCache" (
    "id" SERIAL NOT NULL,
    "domain" TEXT NOT NULL,
    "dmarcPolicy" TEXT,
    "bimiVerified" BOOLEAN NOT NULL DEFAULT false,
    "bimiLogoUrl" TEXT,
    "spfPresent" BOOLEAN NOT NULL DEFAULT false,
    "trancoRank" INTEGER,
    "isEsp" BOOLEAN NOT NULL DEFAULT false,
    "cachedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainVerificationCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrancoSync" (
    "id" SERIAL NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "domainCount" INTEGER NOT NULL,

    CONSTRAINT "TrancoSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandDomain" (
    "id" SERIAL NOT NULL,
    "brand" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "BrandDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailAccount" (
    "id" TEXT NOT NULL,
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
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreferences" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "prioritizedSenders" TEXT NOT NULL DEFAULT '[]',
    "autoFilters" TEXT NOT NULL DEFAULT '[]',
    "blockedSenders" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxFolder" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialUse" TEXT,
    "messageCount" INTEGER,
    "unreadCount" INTEGER,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailboxFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredMessage" (
    "id" TEXT NOT NULL,
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
    "date" TIMESTAMP(3) NOT NULL,
    "seen" BOOLEAN NOT NULL DEFAULT false,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "answered" BOOLEAN NOT NULL DEFAULT false,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "remoteDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoredMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredMessageBody" (
    "id" TEXT NOT NULL,
    "storedMessageId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "emailBody" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoredMessageBody_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailSyncState" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastFullSyncAt" TIMESTAMP(3),
    "lastUid" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailAccountEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "folderPath" TEXT,
    "messageUid" INTEGER,
    "type" TEXT NOT NULL,
    "payloadJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailAccountEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DomainVerificationCache_domain_key" ON "DomainVerificationCache"("domain");

-- CreateIndex
CREATE INDEX "DomainVerificationCache_domain_idx" ON "DomainVerificationCache"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "BrandDomain_brand_domain_key" ON "BrandDomain"("brand", "domain");

-- CreateIndex
CREATE INDEX "MailAccount_email_idx" ON "MailAccount"("email");

-- CreateIndex
CREATE INDEX "MailAccount_isDefault_idx" ON "MailAccount"("isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreferences_accountId_key" ON "UserPreferences"("accountId");

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

-- AddForeignKey
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxFolder" ADD CONSTRAINT "MailboxFolder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredMessage" ADD CONSTRAINT "StoredMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredMessage" ADD CONSTRAINT "StoredMessage_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "MailboxFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredMessageBody" ADD CONSTRAINT "StoredMessageBody_storedMessageId_fkey" FOREIGN KEY ("storedMessageId") REFERENCES "StoredMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailSyncState" ADD CONSTRAINT "MailSyncState_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailSyncState" ADD CONSTRAINT "MailSyncState_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "MailboxFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailAccountEvent" ADD CONSTRAINT "MailAccountEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

