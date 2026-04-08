import { NextResponse } from "next/server";

import { updateMessageFlags } from "@/lib/mail-client";
import type { MailFlagPayload } from "@/lib/mail-types";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as MailFlagPayload;
    const result = await updateMessageFlags(payload);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update message flags.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
