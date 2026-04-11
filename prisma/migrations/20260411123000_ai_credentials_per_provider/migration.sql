DROP INDEX IF EXISTS "AiCredential_ownerScope_key";
CREATE UNIQUE INDEX "AiCredential_ownerScope_provider_key" ON "AiCredential"("ownerScope", "provider");
