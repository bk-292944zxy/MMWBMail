import { NextResponse } from "next/server";

import { createMailAccount, listMailAccounts } from "@/lib/mail-accounts";
import type { MailConnectionPayload } from "@/lib/mail-types";

type CreateMailAccountPayload = MailConnectionPayload & {
  label?: string;
};

export async function GET() {
  try {
    const accounts = await listMailAccounts();
    return NextResponse.json({ accounts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load accounts.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as CreateMailAccountPayload;
    const account = await createMailAccount(payload);
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create account.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
