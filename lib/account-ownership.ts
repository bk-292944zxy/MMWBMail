import { prisma } from "@/lib/prisma";
import { getRuntimeUserId } from "@/lib/runtime-user";

export async function getOwnedAccount(accountId: string) {
  const userId = await getRuntimeUserId();
  return prisma.mailAccount.findFirst({
    where: {
      id: accountId,
      userId
    },
    select: {
      id: true,
      userId: true,
      email: true
    }
  });
}

