import { prisma } from "@/lib/prisma";

const RUNTIME_USER_ID = "runtime-user-default";
const RUNTIME_USER_EMAIL = (
  process.env.RUNTIME_USER_EMAIL?.trim().toLowerCase() || "local@maximail.local"
);
const RUNTIME_USER_NAME = process.env.RUNTIME_USER_NAME?.trim() || "Local Runtime User";

let runtimeUserIdPromise: Promise<string> | null = null;

async function ensureRuntimeUserRecord() {
  const appUserDelegate = (prisma as unknown as {
    appUser?: {
      upsert: (args: {
        where: { id: string };
        update: { email: string; displayName: string };
        create: { id: string; email: string; displayName: string };
        select: { id: true };
      }) => Promise<{ id: string }>;
    };
  }).appUser;

  if (appUserDelegate?.upsert) {
    return appUserDelegate.upsert({
      where: { id: RUNTIME_USER_ID },
      update: {
        email: RUNTIME_USER_EMAIL,
        displayName: RUNTIME_USER_NAME
      },
      create: {
        id: RUNTIME_USER_ID,
        email: RUNTIME_USER_EMAIL,
        displayName: RUNTIME_USER_NAME
      },
      select: { id: true }
    });
  }

  await prisma.$executeRaw`
    INSERT INTO "AppUser" ("id", "email", "displayName", "createdAt", "updatedAt")
    VALUES (${RUNTIME_USER_ID}, ${RUNTIME_USER_EMAIL}, ${RUNTIME_USER_NAME}, NOW(), NOW())
    ON CONFLICT ("id")
    DO UPDATE SET "email" = EXCLUDED."email", "displayName" = EXCLUDED."displayName", "updatedAt" = NOW()
  `;

  return { id: RUNTIME_USER_ID };
}

export async function getRuntimeUserId() {
  if (!runtimeUserIdPromise) {
    runtimeUserIdPromise = ensureRuntimeUserRecord()
      .then((user) => user.id)
      .catch((error) => {
        runtimeUserIdPromise = null;
        throw error;
      });
  }

  return runtimeUserIdPromise;
}
