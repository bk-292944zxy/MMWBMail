import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function normalizeSqliteDatabaseUrl(url: string) {
  if (!url.startsWith("file:")) {
    return url;
  }

  // Better SQLite treats query params as part of the filename, so keep the
  // underlying file path clean and deterministic.
  return url.split("?")[0] || url;
}

function getPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const normalizedDatabaseUrl = normalizeSqliteDatabaseUrl(databaseUrl);

  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url: normalizedDatabaseUrl
    })
  });
}

export const prisma =
  globalForPrisma.prisma ??
  getPrismaClient();

void prisma.$executeRawUnsafe("PRAGMA journal_mode=WAL;").catch(() => undefined);
void prisma.$executeRawUnsafe("PRAGMA busy_timeout=5000;").catch(() => undefined);
void prisma.$executeRawUnsafe("PRAGMA synchronous=NORMAL;").catch(() => undefined);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
