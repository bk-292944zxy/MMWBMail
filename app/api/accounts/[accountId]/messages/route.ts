import { NextResponse } from "next/server";

import { listAccountMessagesService } from "@/lib/services/account-mail-service";
import {
  getServiceErrorMessage,
  getServiceErrorStatus
} from "@/lib/services/service-error";

type RouteContext = {
  params: Promise<{
    accountId: string;
  }>;
};

export const runtime = "nodejs";

export async function GET(request: Request, context: RouteContext) {
  try {
    const { accountId } = await context.params;

    const { searchParams } = new URL(request.url);
    const folderPath = searchParams.get("folder")?.trim();
    const query = searchParams.get("q")?.trim() ?? "";
    const mailboxType = searchParams.get("mailboxType")?.trim();
    const sourceKind = searchParams.get("sourceKind")?.trim();
    const systemKey = searchParams.get("systemKey")?.trim();
    const shouldSync = searchParams.get("sync") === "true";

    const messages = await listAccountMessagesService({
      accountId,
      folderPath,
      query,
      mailboxType,
      sourceKind,
      mailboxSystemKey: systemKey,
      shouldSync
    });
    return NextResponse.json({ messages });
  } catch (error) {
    return NextResponse.json(
      { error: getServiceErrorMessage(error, "Unable to load messages.") },
      { status: getServiceErrorStatus(error) }
    );
  }
}
