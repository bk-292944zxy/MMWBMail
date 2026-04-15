import { NextResponse } from "next/server";

import { syncAccountService } from "@/lib/services/account-mail-service";
import {
  getServiceErrorMessage,
  getServiceErrorStatus
} from "@/lib/services/service-error";

type RouteContext = {
  params: Promise<{
    accountId: string;
  }>;
};

type SyncPayload = {
  folderPaths?: string[];
  includeBodies?: boolean;
};

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext) {
  try {
    const payload = (await request.json().catch(() => ({}))) as SyncPayload;
    const { accountId } = await context.params;
    const result = await syncAccountService({
      accountId,
      folderPaths: Array.isArray(payload.folderPaths) ? payload.folderPaths : undefined,
      includeBodies: payload.includeBodies === true
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: getServiceErrorMessage(error, "Unable to sync account.") },
      { status: getServiceErrorStatus(error) }
    );
  }
}
