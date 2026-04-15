import { prisma } from "@/lib/prisma";
import { getLocalOwnerId } from "@/lib/local-owner";

export async function getOwnedAccount(accountId: string) {
  const userId = await getLocalOwnerId();
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
