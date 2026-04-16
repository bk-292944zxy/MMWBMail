import { NextResponse } from "next/server";

import { deleteMailboxService } from "@/lib/services/account-mail-service";
import { getServiceErrorMessage, getServiceErrorStatus } from "@/lib/services/service-error";

type RouteContext = { params: Promise<{ accountId: string }> };

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext) {
  try {
    const { accountId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { folderPath?: unknown };
    const folderPath = body.folderPath;
    if (typeof folderPath !== "string" || folderPath.trim().length === 0) {
      return NextResponse.json({ error: "folderPath is required." }, { status: 400 });
    }

    await deleteMailboxService({ accountId, folderPath });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: getServiceErrorMessage(error, "Unable to delete folder.") },
      { status: getServiceErrorStatus(error) }
    );
  }
}
