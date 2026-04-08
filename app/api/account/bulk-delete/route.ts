import { NextResponse } from "next/server";

import { bulkDeleteMessages } from "@/lib/mail-client";
import type { BulkDeletePayload } from "@/lib/mail-types";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as BulkDeletePayload;
    const result = await bulkDeleteMessages(payload);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to delete selected messages.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
