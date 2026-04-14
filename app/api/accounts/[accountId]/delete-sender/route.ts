import { NextResponse } from "next/server";

import { getOwnedAccount } from "@/lib/account-ownership";
import {
  deleteSenderMessagesForAccount,
  recordAccountEvent
} from "@/lib/mail-account-actions";

type RouteContext = {
  params: Promise<{
    accountId: string;
  }>;
};

type DeleteSenderPayload = {
  senderEmail: string;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { accountId } = await context.params;
    const account = await getOwnedAccount(accountId);
    if (!account) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    const payload = (await request.json()) as DeleteSenderPayload;
    const result = await deleteSenderMessagesForAccount(accountId, payload.senderEmail);

    await recordAccountEvent(accountId, {
      type: "sender.deleted",
      payloadJson: JSON.stringify({
        senderEmail: payload.senderEmail,
        deletedCount: result.deletedCount
      })
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to delete sender messages.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
