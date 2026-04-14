-- CreateEnum
CREATE TYPE "MailAccountProvider" AS ENUM ('GMAIL', 'ICLOUD', 'INMOTION_HOSTED', 'GENERIC_IMAP_SMTP');

-- CreateTable
CREATE TABLE "AppUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppUser_email_key" ON "AppUser"("email");

-- Seed runtime ownership bridge user
INSERT INTO "AppUser" ("id", "email", "displayName", "createdAt", "updatedAt")
VALUES (
  'runtime-user-default',
  'local@maximail.local',
  'Local Runtime User',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

-- AlterTable
ALTER TABLE "MailAccount"
  ADD COLUMN "provider" "MailAccountProvider" NOT NULL DEFAULT 'GENERIC_IMAP_SMTP',
  ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'runtime-user-default';

-- Backfill provider for existing records
UPDATE "MailAccount"
SET "provider" = CASE
  WHEN split_part(lower("email"), '@', 2) IN ('gmail.com', 'googlemail.com')
    OR lower("imapHost") LIKE '%gmail%'
    OR lower("smtpHost") LIKE '%gmail%'
  THEN 'GMAIL'::"MailAccountProvider"

  WHEN split_part(lower("email"), '@', 2) IN ('icloud.com', 'me.com', 'mac.com')
    OR lower("imapHost") LIKE '%icloud%'
    OR lower("imapHost") LIKE '%mail.me.com%'
    OR lower("smtpHost") LIKE '%icloud%'
    OR lower("smtpHost") LIKE '%mail.me.com%'
  THEN 'ICLOUD'::"MailAccountProvider"

  WHEN split_part(lower("email"), '@', 2) LIKE '%makingmyworldbetter%'
    OR split_part(lower("email"), '@', 2) LIKE '%mmwb%'
    OR split_part(lower("email"), '@', 2) LIKE '%imotion%'
    OR lower("imapHost") LIKE '%makingmyworldbetter%'
    OR lower("imapHost") LIKE '%mmwb%'
    OR lower("imapHost") LIKE '%imotion%'
    OR lower("smtpHost") LIKE '%makingmyworldbetter%'
    OR lower("smtpHost") LIKE '%mmwb%'
    OR lower("smtpHost") LIKE '%imotion%'
  THEN 'INMOTION_HOSTED'::"MailAccountProvider"

  ELSE 'GENERIC_IMAP_SMTP'::"MailAccountProvider"
END;

-- Remove transitional default now that runtime bridge/user exists
ALTER TABLE "MailAccount"
  ALTER COLUMN "userId" DROP DEFAULT;

-- Rework indexes for ownership-safe boundaries
DROP INDEX IF EXISTS "MailAccount_email_idx";
DROP INDEX IF EXISTS "MailAccount_isDefault_idx";

CREATE INDEX "MailAccount_userId_idx" ON "MailAccount"("userId");
CREATE INDEX "MailAccount_userId_isDefault_idx" ON "MailAccount"("userId", "isDefault");
CREATE INDEX "MailAccount_userId_email_idx" ON "MailAccount"("userId", "email");
CREATE UNIQUE INDEX "MailAccount_userId_connection_key"
  ON "MailAccount"("userId", "email", "imapHost", "imapPort", "smtpHost", "smtpPort");

-- AddForeignKey
ALTER TABLE "MailAccount"
  ADD CONSTRAINT "MailAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
