import { listActiveMailAccounts } from "@/lib/mail-accounts";
import { syncMailAccount } from "@/lib/mail-sync";

export async function syncAccountOnDemand(
  accountId: string,
  input?: {
    folderPaths?: string[];
    includeBodies?: boolean;
  }
) {
  return syncMailAccount(accountId, input);
}

export async function syncAllActiveAccounts() {
  const accounts = await listActiveMailAccounts();

  const results = await Promise.allSettled(
    accounts.map((account) => syncMailAccount(account.id))
  );

  return {
    attempted: accounts.length,
    succeeded: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
    results
  };
}
