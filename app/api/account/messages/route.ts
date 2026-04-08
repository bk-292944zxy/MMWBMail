import { NextResponse } from "next/server";

import { listMessages } from "@/lib/mail-client";
import type { MailConnectionPayload } from "@/lib/mail-types";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as MailConnectionPayload;
    const messages = await listMessages(payload);
    return NextResponse.json({ messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load messages.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
