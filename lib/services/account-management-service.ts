import {
  createMailAccount,
  deleteMailAccount,
  getMailAccount,
  listMailAccounts,
  setDefaultMailAccount
} from "@/lib/mail-accounts";
import { verifyMailAccountConnection } from "@/lib/mail-account-verify";
import type { MailConnectionPayload } from "@/lib/mail-types";
import { ServiceError } from "@/lib/services/service-error";

export type CreateMailAccountPayload = MailConnectionPayload & {
  label?: string;
  provider?: string | null;
};

export type UpdateMailAccountPayload = {
  makeDefault?: boolean;
};

export async function listAccountsService() {
  return listMailAccounts();
}

export async function createAccountService(payload: CreateMailAccountPayload) {
  return createMailAccount(payload);
}

export async function getAccountService(accountId: string) {
  const account = await getMailAccount(accountId);
  if (!account) {
    throw new ServiceError("Account not found.", 404);
  }

  return account;
}

export async function updateAccountService(
  accountId: string,
  payload: UpdateMailAccountPayload
) {
  await getAccountService(accountId);

  if (payload.makeDefault === true) {
    await setDefaultMailAccount(accountId);
  }

  return getAccountService(accountId);
}

export async function deleteAccountService(accountId: string) {
  return deleteMailAccount(accountId);
}

export async function verifyAccountService(payload: CreateMailAccountPayload) {
  return verifyMailAccountConnection(payload);
}
