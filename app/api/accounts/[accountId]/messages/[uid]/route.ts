import { NextResponse } from "next/server";

import { recordAccountEvent, updateAccountMessage } from "@/lib/mail-account-actions";
import { getSyncedMessageDetail } from "@/lib/mail-sync";
import type { MailUpdatePayload } from "@/lib/mail-types";

type RouteContext = {
  params: Promise<{
    accountId: string;
    uid: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { accountId, uid } = await context.params;
    const { searchParams } = new URL(request.url);
    const folderPath = searchParams.get("folder")?.trim();

    if (!folderPath) {
      return NextResponse.json({ error: "Missing folder query parameter." }, { status: 400 });
    }

    const parsedUid = Number(uid);
    if (!Number.isFinite(parsedUid)) {
      return NextResponse.json({ error: "Invalid message uid." }, { status: 400 });
    }

    const message = await getSyncedMessageDetail(accountId, folderPath, parsedUid);

    if (!message) {
      return NextResponse.json({ error: "Message not found." }, { status: 404 });
    }

    return NextResponse.json({ message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load message.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type AccountMessagePatchPayload = Pick<
  MailUpdatePayload,
  "folder" | "action" | "seen" | "destinationFolder"
>;

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { accountId, uid } = await context.params;
    const payload = (await request.json()) as AccountMessagePatchPayload;
    const parsedUid = Number(uid);

    if (!payload.folder?.trim()) {
      return NextResponse.json({ error: "Missing folder." }, { status: 400 });
    }

    if (!Number.isFinite(parsedUid)) {
      return NextResponse.json({ error: "Invalid message uid." }, { status: 400 });
    }

    const result = await updateAccountMessage(accountId, payload, parsedUid);
    await recordAccountEvent(accountId, {
      type: payload.action === "delete" ? "message.deleted" : "message.updated",
      folderPath: payload.folder,
      messageUid: parsedUid,
      payloadJson: JSON.stringify({
        action: payload.action,
        destinationFolder: payload.destinationFolder ?? null,
        seen: payload.seen ?? null
      })
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update message.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
