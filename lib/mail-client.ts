import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";

import { inferMailProviderKind } from "@/lib/mail-provider-metadata";
import type {
  BulkDeletePayload,
  MailComposePayload,
  MailConnectionPayload,
  DeleteSenderPayload,
  MailDetail,
  MailFlagPayload,
  MailFolder,
  MailSummary,
  MailUpdatePayload
} from "@/lib/mail-types";
import { normalizeReceivedMessageMedia } from "@/lib/received-message-media";

function createImapClient(connection: MailConnectionPayload) {
  return new ImapFlow({
    host: connection.imapHost,
    port: connection.imapPort,
    secure: connection.imapSecure,
    auth: {
      user: connection.email,
      pass: connection.password
    }
  });
}

function fallbackAddress(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function serializeEnvelopeAddress(input: { name?: string | null; address?: string | null }) {
  const address = input.address?.trim() ?? "";
  const name = input.name?.trim() ?? "";

  if (!address) {
    return name || null;
  }

  if (name && name.toLowerCase() !== address.toLowerCase()) {
    return `${name} <${address}>`;
  }

  return address;
}

function serializeEnvelopeAddresses(
  entries:
    | Array<{
        name?: string | null;
        address?: string | null;
      }>
    | undefined
) {
  return entries
    ?.map((entry) => serializeEnvelopeAddress(entry))
    .filter((entry): entry is string => Boolean(entry)) ?? [];
}

function extractTextPreview(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

function parseListUnsubscribeHeader(headerValue: string | undefined) {
  if (!headerValue) {
    return { listUnsubscribeUrl: undefined, listUnsubscribeEmail: undefined };
  }

  const bracketMatches = Array.from(headerValue.matchAll(/<([^>]+)>/g)).map((match) =>
    match[1].trim()
  );
  const listUnsubscribeUrl = bracketMatches.find((value) => /^https?:\/\//i.test(value));
  const mailtoValue = bracketMatches.find((value) => /^mailto:/i.test(value));
  const listUnsubscribeEmail = mailtoValue
    ? mailtoValue.replace(/^mailto:/i, "").split("?")[0].trim() || undefined
    : undefined;

  return { listUnsubscribeUrl, listUnsubscribeEmail };
}

type ParsedAuthResults = {
  authResultsDmarc?: "pass" | "fail" | "none";
  authResultsSpf?: "pass" | "fail" | "softfail" | "none";
  authResultsDkim?: "pass" | "fail" | "none";
};

function normalizeAuthResult(
  value: string | undefined,
  allowed: readonly string[]
) {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  if (allowed.includes(normalized)) {
    return normalized;
  }

  if (normalized === "neutral" || normalized === "temperror" || normalized === "permerror") {
    return "fail";
  }

  return undefined;
}

function parseAuthenticationResultsHeader(headerValue: string | undefined): ParsedAuthResults {
  if (!headerValue) {
    return {};
  }

  return {
    authResultsDmarc: normalizeAuthResult(
      headerValue.match(/\bdmarc=(pass|fail|none|temperror|permerror)\b/i)?.[1],
      ["pass", "fail", "none"]
    ) as ParsedAuthResults["authResultsDmarc"],
    authResultsSpf: normalizeAuthResult(
      headerValue.match(/\bspf=(pass|fail|softfail|none|neutral|temperror|permerror)\b/i)?.[1],
      ["pass", "fail", "softfail", "none"]
    ) as ParsedAuthResults["authResultsSpf"],
    authResultsDkim: normalizeAuthResult(
      headerValue.match(/\bdkim=(pass|fail|none|temperror|permerror)\b/i)?.[1],
      ["pass", "fail", "none"]
    ) as ParsedAuthResults["authResultsDkim"]
  };
}

async function parseMessageSource(source: Buffer | undefined) {
  if (!source) {
    return {
      text: "",
      html: "",
      media: [],
      cc: "",
      inReplyTo: "",
      references: "",
      authResultsDmarc: undefined,
      authResultsSpf: undefined,
      authResultsDkim: undefined,
      listUnsubscribeUrl: undefined,
      listUnsubscribeEmail: undefined
    };
  }

  const parsed = await simpleParser(source);
  const headerLines = (
    parsed as unknown as {
      headerLines?: ReadonlyArray<{ key?: string; line?: string }>;
    }
  ).headerLines;
  const authenticationResultsHeaderLine = headerLines?.find(
    (headerLine) => headerLine.key?.toLowerCase() === "authentication-results"
  )?.line;
  const authenticationResultsHeader = authenticationResultsHeaderLine
    ?.replace(/^authentication-results:\s*/i, "")
    .trim();
  const authResults = parseAuthenticationResultsHeader(authenticationResultsHeader);
  const listUnsubscribe = parseListUnsubscribeHeader(
    parsed.headers.get("list-unsubscribe")?.toString()
  );
  const media = normalizeReceivedMessageMedia(parsed.attachments ?? []);

  return {
    text: parsed.text?.trim() ?? "",
    html: typeof parsed.html === "string" ? parsed.html : "",
    media,
    cc: parsed.headers.get("cc")?.toString() ?? "",
    inReplyTo: parsed.headers.get("in-reply-to")?.toString().trim() ?? "",
    references: parsed.headers.get("references")?.toString().trim() ?? "",
    authResultsDmarc: authResults.authResultsDmarc,
    authResultsSpf: authResults.authResultsSpf,
    authResultsDkim: authResults.authResultsDkim,
    listUnsubscribeUrl: listUnsubscribe.listUnsubscribeUrl,
    listUnsubscribeEmail: listUnsubscribe.listUnsubscribeEmail
  };
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildEmailBody(html: string, text: string) {
  const bodyContent = html.trim()
    ? html
    : escapeHtml(text).replace(/\r?\n/g, "<br>");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light dark; }
      html {
        background: #ffffff;
      }
      body {
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.5;
        color: #111827;
        background: #ffffff;
        word-break: break-word;
      }
      img, table { max-width: 100%; }
      pre { white-space: pre-wrap; }
      a { color: #0a84ff; }
    </style>
  </head>
  <body>${bodyContent || "<p>No message body available.</p>"}</body>
</html>`;
}

function mapFlags(flags: Set<string> | undefined) {
  const currentFlags = flags ?? new Set<string>();

  return {
    seen: currentFlags.has("\\Seen"),
    flagged: currentFlags.has("\\Flagged"),
    answered: currentFlags.has("\\Answered")
  };
}

function normalizeDate(value: Date | string | undefined) {
  if (!value) {
    return new Date().toISOString();
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function hasAttachments(
  bodyStructure:
    | {
        childNodes?: Array<{
          disposition?: string;
        }>;
      }
    | undefined
) {
  return Boolean(
    bodyStructure?.childNodes?.some((node) => node.disposition === "attachment")
  );
}

async function withMailbox<T>(
  connection: MailConnectionPayload,
  folder: string,
  callback: (client: ImapFlow) => Promise<T>
) {
  const client = createImapClient(connection);

  try {
    await client.connect();
    await client.mailboxOpen(folder);
    return await callback(client);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function listFolders(connection: MailConnectionPayload): Promise<MailFolder[]> {
  const client = createImapClient(connection);

  try {
    await client.connect();
    let folders;

    try {
      folders = await client.list({
        statusQuery: {
          messages: true,
          unseen: true
        }
      });
    } catch {
      // Some IMAP providers reject LIST+STATUS requests; fall back to a plain folder list.
      folders = await client.list();
    }

    const mappedFolders = await Promise.all(
      folders.map(async (folder) => {
        let count =
          typeof folder.status?.messages === "number" ? folder.status.messages : null;
        let unread = typeof folder.status?.unseen === "number" ? folder.status.unseen : null;

        if (count === null || unread === null) {
          try {
            const status = await client.status(folder.path, {
              messages: true,
              unseen: true
            });
            count = typeof status.messages === "number" ? status.messages : count;
            unread = typeof status.unseen === "number" ? status.unseen : unread;
          } catch {
            // Some providers reject STATUS on certain folders; leave missing counts as null.
          }
        }

        return {
          path: folder.path,
          name: folder.name,
          specialUse: folder.specialUse ?? null,
          count,
          unread
        };
      })
    );

    return mappedFolders.sort((left, right) => left.name.localeCompare(right.name));
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function listMessages(connection: MailConnectionPayload): Promise<MailSummary[]> {
  const folder = connection.folder || "INBOX";

  return withMailbox(connection, folder, async (client) => {
    if (!client.mailbox || !client.mailbox.exists) {
      return [];
    }

    const messages: MailSummary[] = [];

    for await (const message of client.fetch("1:*", {
      uid: true,
      envelope: true,
      flags: true,
      bodyStructure: true,
      internalDate: true
    })) {
      const { seen, flagged, answered } = mapFlags(message.flags);

      const fromEntry = message.envelope?.from?.[0];
      const fromName = fallbackAddress(fromEntry?.name, fromEntry?.address ?? "Unknown sender");
      const fromAddress = fallbackAddress(fromEntry?.address, "unknown@example.com");
      const toList = serializeEnvelopeAddresses(message.envelope?.to);
      const ccList = serializeEnvelopeAddresses(message.envelope?.cc);

      messages.push({
        uid: message.uid,
        messageId: message.envelope?.messageId || `${message.uid}`,
        inReplyTo: message.envelope?.inReplyTo || undefined,
        references: undefined,
        threadId: message.envelope?.messageId || `${message.uid}`,
        authResultsDmarc: undefined,
        authResultsSpf: undefined,
        authResultsDkim: undefined,
        listUnsubscribeUrl: undefined,
        listUnsubscribeEmail: undefined,
        from: fromName,
        fromAddress,
        cc: ccList.length > 0 ? ccList.join(", ") : undefined,
        to: toList,
        subject: message.envelope?.subject || "(No subject)",
        preview: extractTextPreview(message.envelope?.subject || ""),
        date: normalizeDate(message.internalDate ?? message.envelope?.date),
        seen,
        flagged,
        answered,
        hasAttachments: hasAttachments(message.bodyStructure)
      });
    }

    return messages.sort(
      (left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()
    );
  });
}

export async function getMessageDetail(
  connection: MailConnectionPayload,
  uid: number
): Promise<MailDetail | null> {
  const folder = connection.folder || "INBOX";

  return withMailbox(connection, folder, async (client) => {
    const message = await client.fetchOne(
      uid,
      {
        uid: true,
        envelope: true,
        flags: true,
        source: true,
        bodyStructure: true,
        internalDate: true
      },
      {
        uid: true
      }
    );

    if (!message) {
      return null;
    }

    const parsed = await parseMessageSource(message.source);
    const { seen, flagged, answered } = mapFlags(message.flags);
    const fromEntry = message.envelope?.from?.[0];

    return {
      uid: message.uid,
      messageId: message.envelope?.messageId || `${message.uid}`,
      inReplyTo: parsed.inReplyTo || undefined,
      references: parsed.references || undefined,
      threadId:
        parsed.inReplyTo ||
        parsed.references?.split(/\s+/)[0] ||
        message.envelope?.messageId ||
        `${message.uid}`,
      authResultsDmarc: parsed.authResultsDmarc,
      authResultsSpf: parsed.authResultsSpf,
      authResultsDkim: parsed.authResultsDkim,
      listUnsubscribeUrl: parsed.listUnsubscribeUrl,
      listUnsubscribeEmail: parsed.listUnsubscribeEmail,
      from: fallbackAddress(fromEntry?.name, fromEntry?.address ?? "Unknown sender"),
      fromAddress: fallbackAddress(fromEntry?.address, "unknown@example.com"),
      cc:
        serializeEnvelopeAddresses(message.envelope?.cc).join(", ") ||
        parsed.cc ||
        undefined,
      to: serializeEnvelopeAddresses(message.envelope?.to),
      subject: message.envelope?.subject || "(No subject)",
      preview: extractTextPreview(parsed.text || message.envelope?.subject || ""),
      date: normalizeDate(message.internalDate ?? message.envelope?.date),
      seen,
      flagged,
      answered,
      hasAttachments: hasAttachments(message.bodyStructure),
      text: parsed.text,
      html: parsed.html,
      emailBody: buildEmailBody(parsed.html, parsed.text),
      media: parsed.media
    };
  });
}

export async function updateMessage(
  payload: MailUpdatePayload,
  uid: number
): Promise<{ success: true }> {
  return withMailbox(payload, payload.folder, async (client) => {
    if (payload.action === "toggleSeen") {
      if (payload.seen) {
        await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      } else {
        await client.messageFlagsRemove(uid, ["\\Seen"], { uid: true });
      }
    }

    if (payload.action === "move") {
      if (!payload.destinationFolder) {
        throw new Error("Destination folder is required.");
      }

      const listedFolders = flattenFolders(await client.list());
      const resolvedFolder = await ensureTargetFolder(
        client,
        listedFolders,
        payload.destinationFolder
      );
      await client.messageMove(uid, resolvedFolder, { uid: true });
    }

    if (payload.action === "delete") {
      const listedFolders = flattenFolders(await client.list());
      const trashFolder = findTrashFolder(listedFolders);

      if (trashFolder && payload.folder !== trashFolder) {
        await client.messageMove(uid, trashFolder, { uid: true });
      } else if (isTrashFolderPath(payload.folder, listedFolders)) {
        await client.messageDelete(uid, { uid: true });
      } else {
        throw new Error("Trash folder not found. Refusing to permanently delete message.");
      }
    }

    return { success: true };
  });
}

function flattenFolders(
  folders: Array<{
    path: string;
    name: string;
    specialUse?: string;
  }>
) {
  return folders.map((folder) => ({
    path: folder.path,
    name: folder.name,
    specialUse: folder.specialUse
  }));
}

function findTargetFolder(
  folders: Array<{
    path: string;
    name: string;
    specialUse?: string;
  }>,
  target: string
) {
  const candidates: Record<string, string[]> = {
    Archive: ["Archive", "Archives", "[Gmail]/All Mail", "INBOX.Archive"],
    Spam: ["Spam", "Junk", "Junk Mail", "[Gmail]/Spam", "INBOX.Junk"],
    Trash: ["Trash", "Deleted Messages", "Deleted Items", "[Gmail]/Trash", "INBOX.Trash"]
  };

  const targetCandidates = candidates[target] ?? [target];

  return (
    folders.find(
      (folder) =>
        targetCandidates.includes(folder.path) || targetCandidates.includes(folder.name)
    )?.path ?? target
  );
}

async function ensureTargetFolder(
  client: ReturnType<typeof createImapClient>,
  folders: Array<{
    path: string;
    name: string;
    specialUse?: string;
  }>,
  target: string
) {
  const existingFolder = folders.find(
    (folder) => folder.path === target || folder.name === target
  );

  if (existingFolder) {
    return existingFolder.path;
  }

  try {
    await client.mailboxCreate(target);
  } catch {
    // If the mailbox was created concurrently, the refreshed listing below will resolve it.
  }

  const refreshedFolders = flattenFolders(await client.list());
  return findTargetFolder(refreshedFolders, target);
}

function findTrashFolder(
  folders: Array<{
    path: string;
    name: string;
    specialUse?: string;
  }>
) {
  const bySpecialUse = folders.find((folder) => folder.specialUse === "\\Trash");

  if (bySpecialUse) {
    return bySpecialUse.path;
  }

  const directMatch = findTargetFolder(folders, "Trash");

  if (directMatch && directMatch !== "Trash") {
    return directMatch;
  }

  const fuzzyMatch = folders.find((folder) => {
    const path = folder.path.toLowerCase();
    const name = folder.name.toLowerCase();

    return (
      path.includes("trash") ||
      name.includes("trash") ||
      path.includes("deleted") ||
      name.includes("deleted")
    );
  });

  return fuzzyMatch?.path ?? null;
}

function isTrashFolderPath(
  folderPath: string,
  folders: Array<{
    path: string;
    name: string;
    specialUse?: string;
  }>
) {
  const matchedFolder = folders.find((folder) => folder.path === folderPath);
  const normalizedPath = folderPath.toLowerCase();
  const normalizedName = matchedFolder?.name.toLowerCase() ?? "";

  return (
    matchedFolder?.specialUse === "\\Trash" ||
    normalizedPath.includes("trash") ||
    normalizedPath.includes("deleted") ||
    normalizedName.includes("trash") ||
    normalizedName.includes("deleted")
  );
}

export async function deleteMessagesFromSender(
  connection: DeleteSenderPayload,
  senderEmail: string
): Promise<{ success: true; deletedCount: number; movedToTrash: boolean }> {
  const client = createImapClient(connection);

  try {
    await client.connect();
    const listedFolders = flattenFolders(await client.list());
    const trashFolder = findTrashFolder(listedFolders);
    let deletedCount = 0;

    for (const folder of listedFolders) {
      await client.mailboxOpen(folder.path);

      if (!client.mailbox || !client.mailbox.exists) {
        continue;
      }

      const matchedUids: number[] = [];

      for await (const message of client.fetch("1:*", {
        uid: true,
        envelope: true
      })) {
        const fromAddress = message.envelope?.from?.[0]?.address?.toLowerCase() ?? "";

        if (fromAddress === senderEmail.toLowerCase()) {
          matchedUids.push(message.uid);
        }
      }

      if (matchedUids.length === 0) {
        continue;
      }

      deletedCount += matchedUids.length;

      if (trashFolder && folder.path !== trashFolder) {
        await client.messageMove(matchedUids, trashFolder, { uid: true });
        continue;
      }

      if (isTrashFolderPath(folder.path, listedFolders)) {
        await client.messageDelete(matchedUids, { uid: true });
        continue;
      }

      throw new Error("Trash folder not found. Refusing to permanently delete messages.");
    }

    return {
      success: true,
      deletedCount,
      movedToTrash: Boolean(trashFolder)
    };
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function bulkDeleteMessages(
  payload: BulkDeletePayload
): Promise<{ success: true; deletedCount: number; movedToTrash: boolean }> {
  if (payload.uids.length === 0) {
    return { success: true, deletedCount: 0, movedToTrash: false };
  }

  const client = createImapClient(payload);

  try {
    await client.connect();
    await client.mailboxOpen(payload.folder);

    const listedFolders = flattenFolders(await client.list());
    const trashFolder = payload.moveToTrash ? findTrashFolder(listedFolders) : null;

    if (trashFolder && payload.folder !== trashFolder) {
      await client.messageMove(payload.uids, trashFolder, { uid: true });
      return {
        success: true,
        deletedCount: payload.uids.length,
        movedToTrash: true
      };
    }

    if (isTrashFolderPath(payload.folder, listedFolders)) {
      await client.messageDelete(payload.uids, { uid: true });

      return {
        success: true,
        deletedCount: payload.uids.length,
        movedToTrash: false
      };
    }

    throw new Error("Trash folder not found. Refusing to permanently delete messages.");
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function emptyTrashFolder(
  connection: MailConnectionPayload
): Promise<{ success: true; deletedCount: number }> {
  const client = createImapClient(connection);

  try {
    await client.connect();
    const listedFolders = flattenFolders(await client.list());

    if (!isTrashFolderPath(connection.folder || "", listedFolders)) {
      throw new Error("Trash folder not found. Refusing to empty a non-trash mailbox.");
    }

    await client.mailboxOpen(connection.folder || "INBOX");

    if (!client.mailbox || !client.mailbox.exists) {
      return { success: true, deletedCount: 0 };
    }

    const uids: number[] = [];

    for await (const message of client.fetch("1:*", { uid: true })) {
      uids.push(message.uid);
    }

    if (uids.length === 0) {
      return { success: true, deletedCount: 0 };
    }

    await client.messageDelete(uids, { uid: true });
    return { success: true, deletedCount: uids.length };
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function updateMessageFlags(
  payload: MailFlagPayload
): Promise<{ success: true }> {
  if (payload.uids.length === 0) {
    return { success: true };
  }

  return withMailbox(payload, payload.folder, async (client) => {
    if (payload.action === "add") {
      await client.messageFlagsAdd(payload.uids, [payload.flag], { uid: true });
    } else {
      await client.messageFlagsRemove(payload.uids, [payload.flag], { uid: true });
    }

    return { success: true };
  });
}

function normalizeMailboxValue(value: string) {
  return value.trim().toLowerCase();
}

function findPreferredSentFolder(folders: MailFolder[]) {
  const exactNamePriority = ["sent messages", "sent items", "sent mail", "sent"];

  for (const candidate of exactNamePriority) {
    const byName = folders.find((folder) => normalizeMailboxValue(folder.name) === candidate);
    if (byName) {
      return byName.path;
    }

    const byPath = folders.find((folder) => normalizeMailboxValue(folder.path) === candidate);
    if (byPath) {
      return byPath.path;
    }
  }

  const fuzzyPriority = ["sent messages", "sent items", "sent mail", "sent"];

  for (const candidate of fuzzyPriority) {
    const byPath = folders.find((folder) => normalizeMailboxValue(folder.path).includes(candidate));
    if (byPath) {
      return byPath.path;
    }

    const byName = folders.find((folder) => normalizeMailboxValue(folder.name).includes(candidate));
    if (byName) {
      return byName.path;
    }
  }

  return null;
}

async function resolveSentFolder(connection: MailConnectionPayload): Promise<string> {
  try {
    const folders = await listFolders(connection);

    const bySpecialUse = folders.find(
      (folder) => folder.specialUse === "\\Sent" || folder.specialUse === "\\\\Sent"
    );
    if (bySpecialUse) {
      return bySpecialUse.path;
    }

    const preferredFolder = findPreferredSentFolder(folders);
    if (preferredFolder) {
      return preferredFolder;
    }

    return inferMailProviderKind(connection) === "gmail" ? "[Gmail]/Sent Mail" : "Sent Messages";
  } catch {
    return inferMailProviderKind(connection) === "gmail" ? "[Gmail]/Sent Mail" : "Sent Messages";
  }
}

async function appendToFolder(
  connection: MailConnectionPayload,
  folderPath: string,
  rawMessage: string
): Promise<void> {
  const client = createImapClient(connection);

  try {
    await client.connect();

    try {
      await client.mailboxOpen(folderPath);
    } catch {
      try {
        await client.mailboxCreate(folderPath);
        await client.mailboxOpen(folderPath);
      } catch {
        return;
      }
    }

    await client.append(folderPath, rawMessage, ["\\Seen"]);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function sendMessage(payload: MailComposePayload): Promise<{ success: true }> {
  const transporter = nodemailer.createTransport({
    host: payload.smtpHost,
    port: payload.smtpPort,
    secure: payload.smtpSecure,
    auth: {
      user: payload.email,
      pass: payload.password
    }
  });

  const normalizedFromAddress = payload.fromAddress?.trim() || payload.email;
  const normalizedFromName = payload.fromName?.trim() || "";
  const formattedFrom = normalizedFromName
    ? `"${normalizedFromName.replace(/"/g, '\\"')}" <${normalizedFromAddress}>`
    : normalizedFromAddress;

  const mailOptions = {
    from: formattedFrom,
    to: payload.to,
    cc: payload.cc || undefined,
    bcc: payload.bcc || undefined,
    replyTo: payload.replyTo || undefined,
    subject: payload.subject,
    text: payload.text,
    html: payload.html || payload.text.replace(/\n/g, "<br/>"),
    attachments: payload.attachments,
    headers: {
      "X-No-Archive": "Yes"
    }
  };

  await transporter.sendMail(mailOptions);

  void (async () => {
    try {
      const compileTransport = nodemailer.createTransport({
        streamTransport: true,
        newline: "unix"
      });
      const info = await compileTransport.sendMail(mailOptions);
      const rawMessage = await new Promise<string>((resolve, reject) => {
        const message = info.message as NodeJS.ReadableStream | Buffer | string;

        if (typeof message === "string") {
          resolve(message);
          return;
        }

        if (Buffer.isBuffer(message)) {
          resolve(message.toString("utf-8"));
          return;
        }

        const chunks: Buffer[] = [];

        message.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        message.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        message.on("error", reject);
      });
      const sentFolder = await resolveSentFolder(payload);
      await appendToFolder(payload, sentFolder, rawMessage);
    } catch (appendError) {
      console.warn("mmwbmail: failed to append sent message to IMAP:", appendError);
    }
  })();

  return { success: true };
}
