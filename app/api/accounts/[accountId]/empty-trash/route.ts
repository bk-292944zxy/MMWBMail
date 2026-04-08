import { NextResponse } from "next/server";

import {
  emptyTrashForAccount,
  recordAccountEvent
} from "@/lib/mail-account-actions";

type RouteContext = {
  params: Promise<{
    accountId: string;
  }>;
};

type EmptyTrashPayload = {
  folder: string;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { accountId } = await context.params;
    const payload = (await request.json()) as EmptyTrashPayload;
    const result = await emptyTrashForAccount(accountId, payload.folder);

    await recordAccountEvent(accountId, {
      type: "mailbox.emptied",
      folderPath: payload.folder,
      payloadJson: JSON.stringify({
        deletedCount: result.deletedCount
      })
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to empty trash.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
