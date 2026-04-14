import { prisma } from "@/lib/prisma";
import { getRuntimeUserId } from "@/lib/runtime-user";

export type CurrentAiOwner = {
  scope: string;
  type: "mail_account_owner" | "single_owner_placeholder";
  label: string;
};

export const AI_OWNER_LEGACY_SCOPE = "local-owner";

export async function resolveCurrentAiOwner(): Promise<CurrentAiOwner> {
  const userId = await getRuntimeUserId();
  const primaryAccount = await prisma.mailAccount.findFirst({
    where: { userId },
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true,
      label: true,
      email: true
    }
  });

  if (primaryAccount) {
    const label = primaryAccount.label.trim() || primaryAccount.email.trim() || "Current owner";
    return {
      scope: `mail-account-owner:${primaryAccount.id}`,
      type: "mail_account_owner",
      label
    };
  }

  return {
    scope: AI_OWNER_LEGACY_SCOPE,
    type: "single_owner_placeholder",
    label: "Current owner"
  };
}
