-- CreateTable
CREATE TABLE "ComposeDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "composeSessionId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "dataJson" TEXT NOT NULL,
    "localRevision" INTEGER NOT NULL DEFAULT 0,
    "lastSavedRevision" INTEGER NOT NULL DEFAULT 0,
    "savedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ComposeDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ComposeDraft_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ComposeDraft_userId_draftId_key" ON "ComposeDraft"("userId", "draftId");

-- CreateIndex
CREATE UNIQUE INDEX "ComposeDraft_userId_composeSessionId_key" ON "ComposeDraft"("userId", "composeSessionId");

-- CreateIndex
CREATE INDEX "ComposeDraft_userId_updatedAt_idx" ON "ComposeDraft"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ComposeDraft_userId_accountId_updatedAt_idx" ON "ComposeDraft"("userId", "accountId", "updatedAt");
