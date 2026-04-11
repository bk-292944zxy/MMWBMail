import "dotenv/config";

import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";

import { getDatabaseUrl } from "@/lib/env";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};
const require = createRequire(import.meta.url);
const { PrismaPg } = require("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg");

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
