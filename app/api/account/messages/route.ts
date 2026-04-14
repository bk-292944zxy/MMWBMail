import { NextResponse } from "next/server";

import { getOwnedAccount } from "@/lib/account-ownership";
import { listMessages } from "@/lib/mail-client";
import { listSyncedMessages } from "@/lib/mail-sync";
import type { MailConnectionPayload } from "@/lib/mail-types";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as MailConnectionPayload & {
      accountId?: string;
      folder?: string;
    };

    if (payload.accountId?.trim() && payload.folder?.trim()) {
      const account = await getOwnedAccount(payload.accountId);
      if (!account) {
        return NextResponse.json({ error: "Account not found." }, { status: 404 });
      }

      const messages = await listSyncedMessages(payload.accountId, payload.folder);
      return NextResponse.json({ messages });
    }

    const messages = await listMessages(payload);
    return NextResponse.json({ messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load messages.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
