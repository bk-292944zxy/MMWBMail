import { NextResponse } from "next/server";

import { listSyncedMessages, syncMailAccount } from "@/lib/mail-sync";
import { searchAccountMessagesViaProvider } from "@/lib/mail-provider";
import { ensureMailSyncRuntimeStarted } from "@/lib/mail-sync-runtime";

type RouteContext = {
  params: Promise<{
    accountId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureMailSyncRuntimeStarted();
    const { accountId } = await context.params;
    const { searchParams } = new URL(request.url);
    const folderPath = searchParams.get("folder")?.trim();
    const query = searchParams.get("q")?.trim() ?? "";
    const mailboxType = searchParams.get("mailboxType")?.trim();
    const sourceKind = searchParams.get("sourceKind")?.trim();
    const systemKey = searchParams.get("systemKey")?.trim();
    const shouldSync = searchParams.get("sync") === "true";

    if (!folderPath) {
      return NextResponse.json({ error: "Missing folder query parameter." }, { status: 400 });
    }

    if (shouldSync) {
      await syncMailAccount(accountId, {
        folderPaths: [folderPath]
      });
    }

    if (query) {
      const result = await searchAccountMessagesViaProvider({
        accountId,
        folderPath,
        mailboxType:
          mailboxType === "system" || mailboxType === "folder" || mailboxType === "label"
            ? mailboxType
            : undefined,
        sourceKind: sourceKind === "folder" || sourceKind === "label" ? sourceKind : undefined,
        mailboxSystemKey: systemKey || undefined,
        query
      });
      return NextResponse.json({ messages: result.messages });
    }

    const messages = await listSyncedMessages(accountId, folderPath);
    return NextResponse.json({ messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load messages.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
