import { NextResponse } from "next/server";

import { loadAccountFoldersService } from "@/lib/services/account-mail-service";
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
    const shouldSync = searchParams.get("sync") === "true";
    const folderPaths = searchParams
      .getAll("folder")
      .map((value) => value.trim())
      .filter(Boolean);

    const folders = await loadAccountFoldersService({
      accountId,
      shouldSync,
      folderPaths
    });
    return NextResponse.json({ folders });
  } catch (error) {
    return NextResponse.json(
      { error: getServiceErrorMessage(error, "Unable to load folders.") },
      { status: getServiceErrorStatus(error) }
    );
  }
}
