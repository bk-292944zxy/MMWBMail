import { NextResponse } from "next/server";

import {
  createAccountService,
  listAccountsService,
  type CreateMailAccountPayload
} from "@/lib/services/account-management-service";
import {
  getServiceErrorMessage,
  getServiceErrorStatus
} from "@/lib/services/service-error";

export async function GET() {
  try {
    const accounts = await listAccountsService();
    return NextResponse.json({ accounts });
  } catch (error) {
    return NextResponse.json(
      { error: getServiceErrorMessage(error, "Unable to load accounts.") },
      { status: getServiceErrorStatus(error) }
    );
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as CreateMailAccountPayload;
    const account = await createAccountService(payload);
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: getServiceErrorMessage(error, "Unable to create account.") },
      { status: getServiceErrorStatus(error) }
    );
  }
}
