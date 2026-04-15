import { prisma } from "@/lib/prisma";

const LOCAL_OWNER_ID = process.env.LOCAL_OWNER_ID?.trim() || "local-owner-primary";
const LOCAL_OWNER_EMAIL = process.env.LOCAL_OWNER_EMAIL?.trim().toLowerCase() || "local@maximail.local";
const LOCAL_OWNER_NAME = process.env.LOCAL_OWNER_NAME?.trim() || "Local Owner";

type LocalOwnerRecord = {
  id: string;
  email: string;
  displayName: string | null;
};

let localOwnerPromise: Promise<LocalOwnerRecord> | null = null;

async function ensureLocalOwner(): Promise<LocalOwnerRecord> {
  const ownerById = await prisma.appUser.findUnique({
    where: { id: LOCAL_OWNER_ID },
    select: {
      id: true,
      email: true,
      displayName: true
    }
  });

  if (ownerById) {
    return prisma.appUser.update({
      where: { id: ownerById.id },
      data: {
        email: LOCAL_OWNER_EMAIL,
        displayName: LOCAL_OWNER_NAME
      },
      select: {
        id: true,
        email: true,
        displayName: true
      }
    });
  }

  const existingOwner = await prisma.appUser.findFirst({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      displayName: true
    }
  });

  if (existingOwner) {
    return prisma.appUser.update({
      where: { id: existingOwner.id },
      data: {
        email: LOCAL_OWNER_EMAIL,
        displayName: LOCAL_OWNER_NAME
      },
      select: {
        id: true,
        email: true,
        displayName: true
      }
    });
  }

  return prisma.appUser.create({
    data: {
      id: LOCAL_OWNER_ID,
      email: LOCAL_OWNER_EMAIL,
      displayName: LOCAL_OWNER_NAME
    },
    select: {
      id: true,
      email: true,
      displayName: true
    }
  });
}

export async function getLocalOwner() {
  if (!localOwnerPromise) {
    localOwnerPromise = ensureLocalOwner().catch((error) => {
      localOwnerPromise = null;
      throw error;
    });
  }

  return localOwnerPromise;
}

export async function getLocalOwnerId() {
  const owner = await getLocalOwner();
  return owner.id;
}
