import { NextResponse } from "next/server";

import { verifyMailAccountConnection } from "@/lib/mail-account-verify";
import type { MailConnectionPayload } from "@/lib/mail-types";

type VerifyAccountPayload = MailConnectionPayload & {
  provider?: string | null;
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as VerifyAccountPayload;
    const result = await verifyMailAccountConnection(payload);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify account.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

