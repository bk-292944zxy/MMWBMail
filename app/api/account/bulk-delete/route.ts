import { NextResponse } from "next/server";

import { getOwnedAccount } from "@/lib/account-ownership";
import { bulkDeleteAccountMessages } from "@/lib/mail-account-actions";
import { bulkDeleteMessages } from "@/lib/mail-client";
import type { BulkDeletePayload } from "@/lib/mail-types";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as BulkDeletePayload & { accountId?: string };

    if (payload.accountId?.trim()) {
      const account = await getOwnedAccount(payload.accountId);
      if (!account) {
        return NextResponse.json({ error: "Account not found." }, { status: 404 });
      }

      const result = await bulkDeleteAccountMessages(payload.accountId, {
        folder: payload.folder,
        uids: payload.uids,
        moveToTrash: payload.moveToTrash
      });
      return NextResponse.json(result);
    }

    const result = await bulkDeleteMessages(payload);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to delete selected messages.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
