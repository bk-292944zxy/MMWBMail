import { NextResponse } from "next/server";

import { deleteMessagesFromSender } from "@/lib/mail-client";
import type { DeleteSenderPayload } from "@/lib/mail-types";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as DeleteSenderPayload;
    const result = await deleteMessagesFromSender(payload, payload.senderEmail);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to delete sender messages.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
