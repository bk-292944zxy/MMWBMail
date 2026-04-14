import { NextResponse } from "next/server";

import { getOwnedAccount } from "@/lib/account-ownership";
import { deleteSenderMessagesForAccount } from "@/lib/mail-account-actions";
import { deleteMessagesFromSender } from "@/lib/mail-client";
import type { DeleteSenderPayload } from "@/lib/mail-types";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as DeleteSenderPayload & { accountId?: string };

    if (payload.accountId?.trim()) {
      const account = await getOwnedAccount(payload.accountId);
      if (!account) {
        return NextResponse.json({ error: "Account not found." }, { status: 404 });
      }

      const result = await deleteSenderMessagesForAccount(payload.accountId, payload.senderEmail);
      return NextResponse.json(result);
    }

    const result = await deleteMessagesFromSender(payload, payload.senderEmail);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to delete sender messages.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
