import { NextResponse } from "next/server";

import { getOwnedAccount } from "@/lib/account-ownership";
import { updateAccountMessage } from "@/lib/mail-account-actions";
import { getMessageDetail, updateMessage } from "@/lib/mail-client";
import { getSyncedMessageDetail } from "@/lib/mail-sync";
import type { MailConnectionPayload, MailUpdatePayload } from "@/lib/mail-types";

type RouteContext = {
  params: Promise<{
    uid: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const payload = (await request.json()) as MailConnectionPayload & {
      accountId?: string;
      folder?: string;
    };
    const { uid } = await context.params;
    const parsedUid = Number(uid);

    if (payload.accountId?.trim() && payload.folder?.trim()) {
      const account = await getOwnedAccount(payload.accountId);
      if (!account) {
        return NextResponse.json({ error: "Account not found." }, { status: 404 });
      }

      const message = await getSyncedMessageDetail(payload.accountId, payload.folder, parsedUid);
      if (!message) {
        return NextResponse.json({ error: "Message not found." }, { status: 404 });
      }
      return NextResponse.json({ message });
    }

    const message = await getMessageDetail(payload, parsedUid);

    if (!message) {
      return NextResponse.json({ error: "Message not found." }, { status: 404 });
    }

    return NextResponse.json({ message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load message.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const payload = (await request.json()) as MailUpdatePayload & {
      accountId?: string;
    };
    const { uid } = await context.params;
    const parsedUid = Number(uid);

    if (payload.accountId?.trim()) {
      const account = await getOwnedAccount(payload.accountId);
      if (!account) {
        return NextResponse.json({ error: "Account not found." }, { status: 404 });
      }

      const result = await updateAccountMessage(
        payload.accountId,
        {
          folder: payload.folder,
          action: payload.action,
          seen: payload.seen,
          destinationFolder: payload.destinationFolder
        },
        parsedUid
      );
      return NextResponse.json(result);
    }

    const result = await updateMessage(payload, parsedUid);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update message.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
