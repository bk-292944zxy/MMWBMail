import { NextResponse } from "next/server";

import {
  bulkDeleteAccountMessagesService,
  type BulkDeletePayload
} from "@/lib/services/account-mail-service";
import {
  getServiceErrorMessage,
  getServiceErrorStatus
} from "@/lib/services/service-error";

type RouteContext = {
  params: Promise<{
    accountId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { accountId } = await context.params;
    const payload = (await request.json()) as BulkDeletePayload;
    const result = await bulkDeleteAccountMessagesService(accountId, payload);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: getServiceErrorMessage(error, "Unable to delete selected messages.") },
      { status: getServiceErrorStatus(error) }
    );
  }
}
