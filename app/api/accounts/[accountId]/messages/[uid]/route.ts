import { NextResponse } from "next/server";

import {
  getAccountMessageDetailService,
  updateAccountMessageService
} from "@/lib/services/account-mail-service";
import type { MailUpdatePayload } from "@/lib/mail-types";
import {
  getServiceErrorMessage,
  getServiceErrorStatus
} from "@/lib/services/service-error";

type RouteContext = {
  params: Promise<{
    accountId: string;
    uid: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { accountId, uid } = await context.params;

    const { searchParams } = new URL(request.url);
    const folderPath = searchParams.get("folder")?.trim();

    const parsedUid = Number(uid);
    const message = await getAccountMessageDetailService({
      accountId,
      folderPath,
      uid: parsedUid
    });

    return NextResponse.json({ message });
  } catch (error) {
    return NextResponse.json(
      { error: getServiceErrorMessage(error, "Unable to load message.") },
      { status: getServiceErrorStatus(error) }
    );
  }
}

type AccountMessagePatchPayload = Pick<
  MailUpdatePayload,
  "folder" | "action" | "seen" | "destinationFolder"
>;

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { accountId, uid } = await context.params;
    const payload = (await request.json()) as AccountMessagePatchPayload;
    const parsedUid = Number(uid);
    const result = await updateAccountMessageService(accountId, payload, parsedUid);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: getServiceErrorMessage(error, "Unable to update message.") },
      { status: getServiceErrorStatus(error) }
    );
  }
}
