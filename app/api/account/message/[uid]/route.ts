import { NextResponse } from "next/server";

import { getMessageDetail, updateMessage } from "@/lib/mail-client";
import type { MailConnectionPayload, MailUpdatePayload } from "@/lib/mail-types";

type RouteContext = {
  params: Promise<{
    uid: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const payload = (await request.json()) as MailConnectionPayload;
    const { uid } = await context.params;
    const message = await getMessageDetail(payload, Number(uid));

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
    const payload = (await request.json()) as MailUpdatePayload;
    const { uid } = await context.params;
    const result = await updateMessage(payload, Number(uid));
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update message.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
