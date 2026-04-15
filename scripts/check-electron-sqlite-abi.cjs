require("tsx/cjs");

async function main() {
  console.log(
    JSON.stringify(
      {
        electron: process.versions.electron || null,
        node: process.versions.node,
        modules: process.versions.modules,
        napi: process.versions.napi
      },
      null,
      2
    )
  );

  try {
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    db.prepare("SELECT 1 as ok").get();
    db.close();
    console.log("better-sqlite3: load ok");
  } catch (error) {
    console.error("better-sqlite3: load failed");
    throw error;
  }

  const { prisma } = require("../lib/prisma.ts");
  try {
    await prisma.$queryRawUnsafe("SELECT 1 as ok");
    console.log("prisma-sqlite: query ok");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
