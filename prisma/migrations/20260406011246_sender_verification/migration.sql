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

-- CreateIndex
CREATE UNIQUE INDEX "DomainVerificationCache_domain_key" ON "DomainVerificationCache"("domain");

-- CreateIndex
CREATE INDEX "DomainVerificationCache_domain_idx" ON "DomainVerificationCache"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "BrandDomain_brand_domain_key" ON "BrandDomain"("brand", "domain");
