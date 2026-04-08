import { NextResponse } from "next/server";

import { recordAccountEvent, sendAccountMessage } from "@/lib/mail-account-actions";
import type { MailComposePayload } from "@/lib/mail-types";

type RouteContext = {
  params: Promise<{
    accountId: string;
  }>;
};

type AccountComposePayload = Omit<
  MailComposePayload,
  | "email"
  | "password"
  | "imapHost"
  | "imapPort"
  | "imapSecure"
  | "smtpHost"
  | "smtpPort"
  | "smtpSecure"
>;

export async function POST(request: Request, context: RouteContext) {
  try {
    const { accountId } = await context.params;
    const contentType = request.headers.get("content-type") || "";
    let payload: AccountComposePayload;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const files = formData.getAll("attachments");
      const inlineCount = Number(formData.get("inline_count") || 0);
      let html = String(formData.get("htmlBody") || "");
      const attachments: NonNullable<MailComposePayload["attachments"]> = await Promise.all(
        files
          .filter((file): file is File => file instanceof File)
          .map(async (file) => ({
            filename: file.name,
            content: Buffer.from(await file.arrayBuffer()),
            contentType: file.type || "application/octet-stream"
          }))
      );

      for (let index = 0; index < inlineCount; index += 1) {
        const file = formData.get(`inline_${index}`);

        if (!(file instanceof File)) {
          continue;
        }

        const cid = `inline-image-${index}@mmwbmail`;
        attachments.push({
          filename: String(formData.get(`inline_name_${index}`) || file.name),
          content: Buffer.from(await file.arrayBuffer()),
          contentType: file.type || "application/octet-stream",
          cid,
          contentDisposition: "inline"
        });
        html = html.replace(/src="data:[^"]*"/, `src="cid:${cid}"`);
      }

      payload = {
        folder: String(formData.get("folder") || "INBOX"),
        fromAddress: String(formData.get("fromAddress") || ""),
        fromName: String(formData.get("fromName") || ""),
        to: String(formData.get("to") || ""),
        cc: String(formData.get("cc") || ""),
        bcc: String(formData.get("bcc") || ""),
        replyTo: String(formData.get("replyTo") || ""),
        subject: String(formData.get("subject") || ""),
        text: String(formData.get("body") || ""),
        html: html || undefined,
        attachments
      };
    } else {
      payload = (await request.json()) as AccountComposePayload;
    }

    const result = await sendAccountMessage(accountId, payload);
    await recordAccountEvent(accountId, {
      type: "message.sent",
      folderPath: payload.folder ?? "INBOX",
      payloadJson: JSON.stringify({
        to: payload.to,
        subject: payload.subject
      })
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send email.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
