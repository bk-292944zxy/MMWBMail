import { NextResponse } from "next/server";

import { getOwnedAccount } from "@/lib/account-ownership";
import {
  bulkDeleteAccountMessages,
  recordAccountEvents
} from "@/lib/mail-account-actions";

type RouteContext = {
  params: Promise<{
    accountId: string;
  }>;
};

type BulkDeletePayload = {
  folder: string;
  uids: number[];
  moveToTrash?: boolean;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { accountId } = await context.params;
    const account = await getOwnedAccount(accountId);
    if (!account) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    const payload = (await request.json()) as BulkDeletePayload;
    const result = await bulkDeleteAccountMessages(accountId, payload);

    await recordAccountEvents(
      accountId,
      payload.uids.map((uid) => ({
        type: "message.deleted",
        folderPath: payload.folder,
        messageUid: uid,
        payloadJson: JSON.stringify({
          moveToTrash: payload.moveToTrash === true
        })
      }))
    );

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to delete selected messages.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
