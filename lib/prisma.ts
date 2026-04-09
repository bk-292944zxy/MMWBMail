import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { getDatabaseUrl } from "@/lib/env";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function getPrismaClient() {
  const databaseUrl = getDatabaseUrl();
  const adapter = new PrismaPg(databaseUrl);

  return new PrismaClient({ adapter });
}

export const prisma =
  globalForPrisma.prisma ??
  getPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
