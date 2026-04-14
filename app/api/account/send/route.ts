import { NextResponse } from "next/server";

import { getOwnedAccount } from "@/lib/account-ownership";
import { sendAccountMessage } from "@/lib/mail-account-actions";
import { sendMessage } from "@/lib/mail-client";
import type { MailComposePayload } from "@/lib/mail-types";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let payload: MailComposePayload & { accountId?: string };

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
        accountId: String(formData.get("accountId") || "") || undefined,
        email: String(formData.get("email") || ""),
        password: String(formData.get("password") || ""),
        imapHost: String(formData.get("imapHost") || ""),
        imapPort: Number(formData.get("imapPort") || 993),
        imapSecure: String(formData.get("imapSecure") || "true") === "true",
        smtpHost: String(formData.get("smtpHost") || ""),
        smtpPort: Number(formData.get("smtpPort") || 465),
        smtpSecure: String(formData.get("smtpSecure") || "true") === "true",
        folder: String(formData.get("folder") || "INBOX"),
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
      payload = (await request.json()) as MailComposePayload & { accountId?: string };
    }

    if (payload.accountId?.trim()) {
      const account = await getOwnedAccount(payload.accountId);
      if (!account) {
        return NextResponse.json({ error: "Account not found." }, { status: 404 });
      }

      const result = await sendAccountMessage(payload.accountId, {
        folder: payload.folder,
        fromAddress: payload.fromAddress,
        fromName: payload.fromName,
        to: payload.to,
        cc: payload.cc,
        bcc: payload.bcc,
        replyTo: payload.replyTo,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
        attachments: payload.attachments
      });
      return NextResponse.json(result);
    }

    const result = await sendMessage(payload);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send email.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
