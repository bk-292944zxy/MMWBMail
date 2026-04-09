CREATE TABLE "AiCredential" (
    "id" TEXT NOT NULL,
    "ownerScope" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastValidatedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiCredential_ownerScope_key" ON "AiCredential"("ownerScope");
CREATE INDEX "AiCredential_ownerType_provider_idx" ON "AiCredential"("ownerType", "provider");
