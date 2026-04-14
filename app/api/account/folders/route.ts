import { NextResponse } from "next/server";

import { getOwnedAccount } from "@/lib/account-ownership";
import { verifyMailAccountConnection } from "@/lib/mail-account-verify";
import { listSyncedFolders } from "@/lib/mail-sync";
import type { MailConnectionPayload } from "@/lib/mail-types";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as MailConnectionPayload & { accountId?: string };

    if (payload.accountId?.trim()) {
      const account = await getOwnedAccount(payload.accountId);
      if (!account) {
        return NextResponse.json({ error: "Account not found." }, { status: 404 });
      }

      const folders = await listSyncedFolders(payload.accountId);
      return NextResponse.json({ folders });
    }

    const result = await verifyMailAccountConnection(payload);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load folders.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
