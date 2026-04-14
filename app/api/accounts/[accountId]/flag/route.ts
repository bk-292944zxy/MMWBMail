import { NextResponse } from "next/server";

import { getOwnedAccount } from "@/lib/account-ownership";
import {
  recordAccountEvents,
  updateAccountMessageFlags
} from "@/lib/mail-account-actions";
import type { MailFlagPayload } from "@/lib/mail-types";

type RouteContext = {
  params: Promise<{
    accountId: string;
  }>;
};

type AccountFlagPayload = Pick<MailFlagPayload, "folder" | "uids" | "flag" | "action">;

export async function POST(request: Request, context: RouteContext) {
  try {
    const { accountId } = await context.params;
    const account = await getOwnedAccount(accountId);
    if (!account) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    const payload = (await request.json()) as AccountFlagPayload;
    const result = await updateAccountMessageFlags(accountId, payload);

    await recordAccountEvents(
      accountId,
      payload.uids.map((uid) => ({
        type: "message.updated",
        folderPath: payload.folder,
        messageUid: uid,
        payloadJson: JSON.stringify({
          flag: payload.flag,
          action: payload.action
        })
      }))
    );

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update message flags.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
