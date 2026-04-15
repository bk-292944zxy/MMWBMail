import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { getDatabaseUrl } from "@/lib/env";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function getPrismaClient() {
  const databaseUrl = getDatabaseUrl();
  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });

  return new PrismaClient({ adapter });
}

export const prisma =
  globalForPrisma.prisma ??
  getPrismaClient();

const databaseUrl = getDatabaseUrl();
if (databaseUrl.startsWith("file:")) {
  // Keep local SQLite responsive under concurrent reads/writes during sync.
  void prisma.$executeRawUnsafe("PRAGMA journal_mode=WAL;");
  void prisma.$executeRawUnsafe("PRAGMA synchronous=NORMAL;");
  void prisma.$executeRawUnsafe("PRAGMA busy_timeout=5000;");
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
