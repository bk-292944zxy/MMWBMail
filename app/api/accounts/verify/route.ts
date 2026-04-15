import { NextResponse } from "next/server";

import {
  verifyAccountService,
  type CreateMailAccountPayload as VerifyAccountPayload
} from "@/lib/services/account-management-service";
import {
  getServiceErrorMessage,
  getServiceErrorStatus
} from "@/lib/services/service-error";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as VerifyAccountPayload;
    const result = await verifyAccountService(payload);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: getServiceErrorMessage(error, "Unable to verify account.") },
      { status: getServiceErrorStatus(error) }
    );
  }
}
