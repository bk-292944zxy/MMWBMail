import { NextResponse } from "next/server";

import { listFolders } from "@/lib/mail-client";
import type { MailConnectionPayload } from "@/lib/mail-types";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as MailConnectionPayload;
    const folders = await listFolders(payload);
    return NextResponse.json({ folders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load folders.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
