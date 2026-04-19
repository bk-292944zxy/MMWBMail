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

function normalizePreviewForComparison(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeHeaderPreview(value: string) {
  const normalized = normalizePreviewForComparison(value);
  if (!normalized) {
    return true;
  }

  if (
    normalized.startsWith("return-path:") ||
    normalized.startsWith("delivered-to:") ||
    normalized.startsWith("received:") ||
    normalized.startsWith("authentication-results:") ||
    normalized.startsWith("dkim-signature:") ||
    /^x-[a-z0-9-]+:/.test(normalized)
  ) {
    return true;
  }

  if (normalized.includes("return-path:") && normalized.includes("delivered-to:")) {
    return true;
  }

  // MIME boundary fragment followed by content-type header
  if (/content-type:\s*(text\/|multipart\/)/.test(normalized)) {
    return true;
  }

  // Long token with no vowel clusters — looks like a boundary ID or message ID
  const noSpaces = normalized.replace(/\s+/g, "");
  if (
    noSpaces.length > 30 &&
    /^[a-z0-9._\-=+/]+$/.test(noSpaces) &&
    !/[aeiou]{2}/.test(noSpaces.slice(0, 20))
  ) {
    return true;
  }

  // Base64 blob — long, no spaces, only base64 chars
  if (
    noSpaces.length > 40 &&
    /^[a-z0-9+/]+=*$/.test(noSpaces) &&
    (normalized.match(/\s/g) ?? []).length < normalized.length * 0.05
  ) {
    return true;
  }

  // High ratio of non-printable characters
  const nonPrintable = (value.match(/[^\x20-\x7E\s]/g) ?? []).length;
  if (nonPrintable > 0 && nonPrintable / value.length > 0.25) {
    return true;
  }

  return false;
}

function isLikelyMimeNoiseLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }

  if (/^--[-_A-Za-z0-9=.:/]+$/.test(trimmed)) {
    return true;
  }

  if (
    /^(content-type|content-transfer-encoding|content-disposition|content-id|content-location|mime-version):/i.test(
      trimmed
    )
  ) {
    return true;
  }

  if (/^charset=/i.test(trimmed) || /^boundary=/i.test(trimmed)) {
    return true;
  }

  if (/^[-_=]{3,}/.test(trimmed)) {
    return true;
  }

  return false;
}

function looksLikeQuotedPrintable(text: string) {
  return /=\r?\n/.test(text) || /=[A-Fa-f0-9]{2}/.test(text);
}

function stripMarkdownNoise(text: string) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^[|*\-#>]+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeBodySnippetCandidate(raw: string) {
  if (!raw) {
    return "";
  }

  const decoded = looksLikeQuotedPrintable(raw)
    ? decodeQuotedPrintable(raw)
    : raw;

  const noStyleScript = decoded
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ");

  const plain = decodeHtmlEntities(noStyleScript).replace(/<[^>]+>/g, " ");
  const stripped = stripMarkdownNoise(plain);

  const cleanedLines = stripped
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !isLikelyMimeNoiseLine(line));

  return extractTextPreview(cleanedLines.join(" "));
}

function decodeQuotedPrintable(value: string) {
  const collapsed = value.replace(/=\r?\n/g, "");
  return collapsed.replace(/((?:=[A-Fa-f0-9]{2})+)/g, (run) => {
    const bytes = run.match(/=[A-Fa-f0-9]{2}/g) ?? [];
    const buf = Buffer.from(bytes.map((b) => parseInt(b.slice(1), 16)));
    try {
      return buf.toString("utf8");
    } catch {
      return bytes.map((b) => String.fromCharCode(parseInt(b.slice(1), 16))).join("");
    }
  });
}

function decodeTransferEncoding(value: string, encoding: string | null) {
  if (!encoding) {
    return value;
  }

  const normalizedEncoding = encoding.toLowerCase();
  if (normalizedEncoding.includes("quoted-printable")) {
    return decodeQuotedPrintable(value);
  }

  if (normalizedEncoding.includes("base64")) {
    const compact = value.replace(/\s+/g, "");
    if (!compact) {
      return "";
    }
    try {
      return Buffer.from(compact, "base64").toString("utf8");
    } catch {
      return value;
    }
  }

  return value;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, codepoint: string) =>
      String.fromCharCode(Number.parseInt(codepoint, 10))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, codepoint: string) =>
      String.fromCharCode(Number.parseInt(codepoint, 16))
    );
}

function extractMimeBodySection(
  source: string,
  type: "text/plain" | "text/html"
): { body: string; encoding: string | null } | null {
  const sectionPattern = new RegExp(
    `Content-Type:\\s*${type.replace("/", "\\/")}\\b[\\s\\S]*?(?=\\r?\\n--[^\\r\\n]+|$)`,
    "i"
  );
  const sectionMatch = source.match(sectionPattern);
  if (!sectionMatch) {
    return null;
  }

  const section = sectionMatch[0];
  const declaredEncoding =
    section.match(/Content-Transfer-Encoding:\s*([^\r\n;]+)/i)?.[1]?.trim() ?? null;
  const body = section.split(/\r?\n\r?\n/).slice(1).join("\n\n").trim();
  if (!body) {
    return null;
  }

  const looksLikeBase64Body =
    !declaredEncoding &&
    /^[A-Za-z0-9+/\r\n]+=*[\r\n]*$/.test(body.trim()) &&
    body.replace(/\s+/g, "").length > 40;

  const encoding = declaredEncoding ?? (looksLikeBase64Body ? "base64" : null);

  return { body, encoding };
}

function extractBodySnippetFromSourceChunk(
  source: Buffer | undefined,
  subject: string
) {
  if (!source || source.length === 0) {
    return "";
  }

  const raw = source.toString("utf8");
  const bodySeparator = raw.match(/\r?\n\r?\n/);
  if (!bodySeparator || bodySeparator.index === undefined) {
    return "";
  }

  const normalizedSubject = normalizePreviewForComparison(subject);
  const rootEncoding =
    raw.match(/Content-Transfer-Encoding:\s*([^\r\n;]+)/i)?.[1]?.trim() ?? null;
  const bodyChunk = raw
    .slice(bodySeparator.index + bodySeparator[0].length)
    .trim();
  if (!bodyChunk) {
    return "";
  }

  const plainSection = extractMimeBodySection(bodyChunk, "text/plain");
  const htmlSection = extractMimeBodySection(bodyChunk, "text/html");

  const plainCandidate = extractTextPreview(
    decodeTransferEncoding(plainSection?.body ?? "", plainSection?.encoding ?? rootEncoding)
  );
  const htmlCandidate = extractTextPreview(
    decodeHtmlEntities(
      decodeTransferEncoding(htmlSection?.body ?? "", htmlSection?.encoding ?? rootEncoding)
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    )
  );
  for (const candidate of [plainCandidate, htmlCandidate]) {
    if (!candidate) {
      continue;
    }

    if (looksLikeHeaderPreview(candidate)) {
      continue;
    }

    if (normalizePreviewForComparison(candidate) === normalizedSubject) {
      continue;
    }

    if (!/[a-zA-Z]{3}/.test(candidate)) {
      continue;
    }

    return candidate;
  }

  return "";
}

function extractBodyFallbackFromSource(
  source: Buffer | undefined,
  subject: string
): { text: string; html: string } {
  if (!source || source.length === 0) {
    return { text: "", html: "" };
  }

  const raw = source.toString("utf8");
  const bodySeparator = raw.match(/\r?\n\r?\n/);
  if (!bodySeparator || bodySeparator.index === undefined) {
    return { text: "", html: "" };
  }

  const rootEncoding =
    raw.match(/Content-Transfer-Encoding:\s*([^\r\n;]+)/i)?.[1]?.trim() ?? null;
  const bodyChunk = raw
    .slice(bodySeparator.index + bodySeparator[0].length)
    .trim();

  if (!bodyChunk) {
    return { text: "", html: "" };
  }

  const plainSection = extractMimeBodySection(bodyChunk, "text/plain");
  const htmlSection = extractMimeBodySection(bodyChunk, "text/html");

  const decodedPlain = decodeTransferEncoding(
    plainSection?.body ?? "",
    plainSection?.encoding ?? rootEncoding
  ).trim();
  const decodedHtml = decodeTransferEncoding(
    htmlSection?.body ?? "",
    htmlSection?.encoding ?? rootEncoding
  ).trim();

  const textFromHtml = decodeHtmlEntities(
    decodedHtml
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();

  const preferredText = decodedPlain || textFromHtml;
  const fallbackSnippet = extractBodySnippetFromSourceChunk(source, subject);
  const text = preferredText || fallbackSnippet;
  const html = decodedHtml;

  return { text, html };
}

function buildMessageListPreview(
  input: {
    subject: string;
    source?: Buffer;
    existingPreview?: string | null;
  }
) {
  const normalizedSubject = normalizePreviewForComparison(input.subject);
  const preferredCandidates = [
    extractTextPreview(input.existingPreview ?? ""),
    extractBodySnippetFromSourceChunk(input.source, input.subject)
  ];

  for (const candidate of preferredCandidates) {
    if (!candidate) {
      continue;
    }

    if (looksLikeHeaderPreview(candidate)) {
      continue;
    }

    if (normalizePreviewForComparison(candidate) === normalizedSubject) {
      continue;
    }

    if (!/[a-zA-Z]{3}/.test(candidate)) {
      continue;
    }

    return candidate;
  }

  return extractTextPreview(input.subject);
}

function extractSnippetFromBodyParts(
  bodyParts: Map<string, Buffer> | undefined,
  subject: string
) {
  if (!bodyParts || bodyParts.size === 0) {
    return "";
  }

  const normalizedSubject = normalizePreviewForComparison(subject);

  for (const [, bodyPart] of bodyParts) {
    const candidate = sanitizeBodySnippetCandidate(bodyPart.toString("utf8"));
    if (!candidate || looksLikeHeaderPreview(candidate)) {
      continue;
    }
    if (normalizePreviewForComparison(candidate) === normalizedSubject) {
      continue;
    }
    return candidate;
  }

  return "";
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

function withOperationTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number | undefined,
  timeoutMessage: string
) {
  if (!timeoutMs || timeoutMs <= 0) {
    return operation;
  }

  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
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
  callback: (client: ImapFlow) => Promise<T>,
  options?: {
    connectTimeoutMs?: number;
    mailboxOpenTimeoutMs?: number;
    callbackTimeoutMs?: number;
  }
) {
  const client = createImapClient(connection);

  try {
    await withOperationTimeout(
      client.connect(),
      options?.connectTimeoutMs,
      "IMAP connection timed out."
    );
    await withOperationTimeout(
      client.mailboxOpen(folder),
      options?.mailboxOpenTimeoutMs,
      `IMAP mailbox open timed out for folder ${folder}.`
    );
    return await withOperationTimeout(
      callback(client),
      options?.callbackTimeoutMs,
      `IMAP mailbox operation timed out for folder ${folder}.`
    );
  } finally {
    await withOperationTimeout(
      client.logout().catch(() => undefined),
      3_000,
      "IMAP logout timed out."
    ).catch(() => undefined);
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

export async function deleteMailbox(
  connection: MailConnectionPayload,
  folderPath: string
): Promise<void> {
  const normalizedFolderPath = folderPath.trim();
  if (!normalizedFolderPath) {
    throw new Error("Folder path is required.");
  }

  const client = createImapClient(connection);

  try {
    await client.connect();
    await client.mailboxDelete(normalizedFolderPath);
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
      internalDate: true,
      bodyParts: [
        {
          key: "TEXT",
          maxLength: 2048
        }
      ]
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
        preview: buildMessageListPreview({
          subject: message.envelope?.subject || "(No subject)",
          existingPreview: extractSnippetFromBodyParts(
            message.bodyParts,
            message.envelope?.subject || "(No subject)"
          ),
          source: message.source
        }),
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

  try {
    return await withMailbox(
      connection,
      folder,
      async (client) => {
        const message = await withOperationTimeout(
          client.fetchOne(
            uid,
            {
              uid: true,
              envelope: true,
              flags: true,
              source: true,
              bodyParts: [
                {
                  key: "TEXT",
                  maxLength: 200000
                }
              ],
              bodyStructure: true,
              internalDate: true
            },
            {
              uid: true
            }
          ),
          12_000,
          `IMAP message fetch timed out for uid ${uid}.`
        );

        if (!message) {
          return null;
        }

        const subject = message.envelope?.subject || "(No subject)";
        let parsed: Awaited<ReturnType<typeof parseMessageSource>>;
        try {
          parsed = await withOperationTimeout(
            parseMessageSource(message.source),
            12_000,
            `Message parse timed out for uid ${uid}.`
          );
        } catch (parseError) {
          console.error("mmwbmail: message parse failed, using fallback body extraction", {
            email: connection.email,
            folder,
            uid,
            error: parseError instanceof Error ? parseError.message : String(parseError)
          });
          parsed = {
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

        if (!parsed.text.trim() && !parsed.html.trim()) {
          const sourceFallback = extractBodyFallbackFromSource(message.source, subject);
          const bodyPartFallback = extractSnippetFromBodyParts(message.bodyParts, subject);
          const fallbackText = sourceFallback.text || bodyPartFallback;

          parsed = {
            ...parsed,
            text: fallbackText,
            html: sourceFallback.html || parsed.html
          };
        }

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
          subject,
          preview: extractTextPreview(parsed.text || subject),
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
      },
      {
        connectTimeoutMs: 10_000,
        mailboxOpenTimeoutMs: 10_000,
        callbackTimeoutMs: 20_000
      }
    );
  } catch (error) {
    console.error("mmwbmail: message detail load failed", {
      email: connection.email,
      folder,
      uid,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
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

async function resolveSentFolder(connection: MailConnectionPayload): Promise<string | null> {
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

    return null;
  } catch {
    return null;
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
      return;
    }

    await client.append(folderPath, rawMessage, ["\\Seen"]);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

type SaveDraftMessageOptions = {
  previousProviderDraftId?: string | null;
};

function findPreferredDraftFolder(folders: MailFolder[]) {
  const exactNamePriority = ["drafts", "draft messages", "draft items", "draft mail"];

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

  const fuzzyPriority = ["drafts", "draft"];

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

async function resolveDraftFolder(connection: MailConnectionPayload): Promise<string | null> {
  try {
    const folders = await listFolders(connection);

    const bySpecialUse = folders.find(
      (folder) => folder.specialUse === "\\Drafts" || folder.specialUse === "\\\\Drafts"
    );
    if (bySpecialUse) {
      return bySpecialUse.path;
    }

    const preferredFolder = findPreferredDraftFolder(folders);
    if (preferredFolder) {
      return preferredFolder;
    }

    return null;
  } catch {
    return null;
  }
}

function parseProviderDraftLocator(value?: string | null) {
  if (!value || typeof value !== "string") {
    return null;
  }
  const [encodedFolderPath, uidValue] = value.split("::");
  const uid = Number(uidValue);
  if (!encodedFolderPath || !Number.isFinite(uid)) {
    return null;
  }
  return {
    folderPath: decodeURIComponent(encodedFolderPath),
    uid
  };
}

function buildProviderDraftLocator(folderPath: string, uid: number) {
  return `${encodeURIComponent(folderPath)}::${uid}`;
}

export async function saveDraftMessage(
  payload: MailComposePayload,
  options: SaveDraftMessageOptions = {}
): Promise<{ success: true; folderPath: string; providerDraftId: string | null }> {
  const draftFolder = await resolveDraftFolder(payload);
  if (!draftFolder) {
    throw new Error("Drafts mailbox not found on the mail server.");
  }

  const normalizedFromAddress = payload.fromAddress?.trim() || payload.email;
  const normalizedFromName = payload.fromName?.trim() || "";
  const formattedFrom = normalizedFromName
    ? `"${normalizedFromName.replace(/"/g, '\\"')}" <${normalizedFromAddress}>`
    : normalizedFromAddress;

  const mailOptions = {
    from: formattedFrom,
    to: payload.to || undefined,
    cc: payload.cc || undefined,
    bcc: payload.bcc || undefined,
    replyTo: payload.replyTo || undefined,
    subject: payload.subject,
    text: payload.text,
    html: payload.html || payload.text.replace(/\n/g, "<br/>"),
    attachments: payload.attachments,
    headers: {
      "X-Draft-Save": "Yes"
    }
  };

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

  const previousProviderDraft = parseProviderDraftLocator(options.previousProviderDraftId);
  const client = createImapClient(payload);

  try {
    await client.connect();
    await client.mailboxOpen(draftFolder);

    if (
      previousProviderDraft &&
      previousProviderDraft.folderPath === draftFolder
    ) {
      try {
        await client.messageDelete(previousProviderDraft.uid, { uid: true });
      } catch {
        // Ignore missing previous draft ids and continue append.
      }
    }

    const appendResult = await client.append(draftFolder, rawMessage, ["\\Seen", "\\Draft"]);
    const appendedUid =
      appendResult &&
      typeof appendResult === "object" &&
      typeof (appendResult as { uid?: unknown }).uid === "number"
        ? (appendResult as { uid: number }).uid
        : null;
    const providerDraftId =
      appendedUid && Number.isFinite(appendedUid)
        ? buildProviderDraftLocator(draftFolder, appendedUid)
        : null;

    return {
      success: true,
      folderPath: draftFolder,
      providerDraftId
    };
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
      if (sentFolder) {
        await appendToFolder(payload, sentFolder, rawMessage);
      } else {
        console.warn(
          "mmwbmail: no server Sent mailbox found; skipped IMAP sent append to avoid creating a custom folder."
        );
      }
    } catch (appendError) {
      console.warn("mmwbmail: failed to append sent message to IMAP:", appendError);
    }
  })();

  return { success: true };
}
