import type {
  AccountCreateRequestBody,
  AccountSendFormPayload,
  ElectronLoadMessageDetailInput,
  ElectronLoadMessagesInput,
  ElectronLoadFoldersInput,
  ElectronMailBridge,
  ElectronSendAttachmentInput,
  ElectronSendMessageInput
} from "@/lib/electron/ipc-contract";
import type {
  MailAccountSummary,
  MailConnectionPayload,
  MailDetail,
  MailFolder,
  MailSummary
} from "@/lib/mail-types";

function getDesktopBridge(): ElectronMailBridge | null {
  if (typeof window === "undefined") {
    return null;
  }

  const bridge = window.maximailDesktop;
  if (!bridge || bridge.isElectron !== true || bridge.version !== 2) {
    return null;
  }

  return bridge;
}

async function parseJsonResponse<T>(response: Response): Promise<T & { error?: string }> {
  try {
    return (await response.json()) as T & { error?: string };
  } catch {
    const fallbackBody = await response.text().catch(() => "");
    const fallbackMessage =
      fallbackBody.trim() ||
      response.statusText ||
      `Request failed with status ${response.status}`;

    return {
      error: fallbackMessage
    } as T & { error?: string };
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await parseJsonResponse<T>(response);

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

function normalizeIpcError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return new Error(error.message);
  }

  return new Error(fallback);
}

export async function listAccountsClient() {
  const bridge = getDesktopBridge();
  if (!bridge) {
    return requestJson<{ accounts: MailAccountSummary[] }>("/api/accounts", {
      method: "GET"
    });
  }

  try {
    return await bridge.listAccounts();
  } catch (error) {
    throw normalizeIpcError(error, "Unable to load accounts.");
  }
}

export async function createAccountClient(payload: AccountCreateRequestBody) {
  const bridge = getDesktopBridge();
  if (!bridge) {
    return requestJson<{ account: MailAccountSummary }>("/api/accounts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  }

  try {
    return await bridge.createAccount(payload);
  } catch (error) {
    throw normalizeIpcError(error, "Unable to create account.");
  }
}

export async function verifyAccountClient(payload: AccountCreateRequestBody) {
  const bridge = getDesktopBridge();
  if (!bridge) {
    return requestJson<{
      folders: MailFolder[];
      connection?: Partial<MailConnectionPayload>;
    }>("/api/accounts/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  }

  try {
    return await bridge.verifyAccount(payload);
  } catch (error) {
    throw normalizeIpcError(error, "Unable to verify account.");
  }
}

export async function loadFoldersClient(input: ElectronLoadFoldersInput) {
  const bridge = getDesktopBridge();
  if (!bridge) {
    const params = new URLSearchParams();
    if (input.sync) {
      params.set("sync", "true");
    }
    for (const folderPath of input.folderPaths ?? []) {
      if (folderPath.trim()) {
        params.append("folder", folderPath.trim());
      }
    }
    const query = params.toString();
    return requestJson<{ folders: MailFolder[] }>(
      `/api/accounts/${input.accountId}/folders${query ? `?${query}` : ""}`,
      { method: "GET" }
    );
  }

  try {
    return await bridge.loadFolders(input);
  } catch (error) {
    throw normalizeIpcError(error, "Unable to load folders.");
  }
}

export async function loadMessagesClient(input: ElectronLoadMessagesInput) {
  const bridge = getDesktopBridge();
  if (!bridge) {
    const params = new URLSearchParams({
      folder: input.folderPath
    });
    if (input.shouldSync) {
      params.set("sync", "true");
    }
    if (input.query?.trim()) {
      params.set("q", input.query.trim());
    }
    if (input.mailboxType?.trim()) {
      params.set("mailboxType", input.mailboxType.trim());
    }
    if (input.sourceKind?.trim()) {
      params.set("sourceKind", input.sourceKind.trim());
    }
    if (input.mailboxSystemKey?.trim()) {
      params.set("systemKey", input.mailboxSystemKey.trim());
    }

    return requestJson<{ messages: MailSummary[] }>(
      `/api/accounts/${input.accountId}/messages?${params.toString()}`,
      {
        method: "GET"
      }
    );
  }

  try {
    return await bridge.loadMessages(input);
  } catch (error) {
    throw normalizeIpcError(error, "Unable to load messages.");
  }
}

export async function loadMessageDetailClient(input: ElectronLoadMessageDetailInput) {
  const bridge = getDesktopBridge();
  if (!bridge) {
    return requestJson<{ message: MailDetail }>(
      `/api/accounts/${input.accountId}/messages/${input.uid}?folder=${encodeURIComponent(
        input.folderPath
      )}`,
      { method: "GET" }
    );
  }

  try {
    return await bridge.loadMessageDetail(input);
  } catch (error) {
    throw normalizeIpcError(error, "Unable to load message.");
  }
}

async function convertFormDataAttachments(
  formData: FormData
): Promise<ElectronSendAttachmentInput[]> {
  const attachments: ElectronSendAttachmentInput[] = [];

  const toBase64 = (arrayBuffer: ArrayBuffer) => {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return globalThis.btoa(binary);
  };

  const files = formData.getAll("attachments");
  for (const entry of files) {
    if (!(entry instanceof File)) {
      continue;
    }

    const contentBase64 = toBase64(await entry.arrayBuffer());
    attachments.push({
      filename: entry.name,
      contentType: entry.type || "application/octet-stream",
      contentBase64
    });
  }

  const inlineCount = Number(formData.get("inline_count") || 0);
  for (let index = 0; index < inlineCount; index += 1) {
    const file = formData.get(`inline_${index}`);
    if (!(file instanceof File)) {
      continue;
    }

    const contentBase64 = toBase64(await file.arrayBuffer());
    attachments.push({
      filename: String(formData.get(`inline_name_${index}`) || file.name),
      contentType: file.type || "application/octet-stream",
      cid: `inline-image-${index}@mmwbmail`,
      contentDisposition: "inline",
      contentBase64
    });
  }

  return attachments;
}

export async function sendMessageClient(accountId: string, formData: FormData) {
  const bridge = getDesktopBridge();
  if (!bridge) {
    const response = await fetch(`/api/accounts/${accountId}/send`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error || "Unable to send message.");
    }

    return response.json().catch(() => ({ success: true }));
  }

  let html = String(formData.get("htmlBody") || "");
  const inlineCount = Number(formData.get("inline_count") || 0);
  for (let index = 0; index < inlineCount; index += 1) {
    html = html.replace(/src="data:[^"]*"/, `src="cid:inline-image-${index}@mmwbmail"`);
  }

  const attachments = await convertFormDataAttachments(formData);
  const payload: AccountSendFormPayload = {
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
    attachments: undefined
  };

  const ipcPayload: ElectronSendMessageInput = {
    accountId,
    payload: {
      ...payload,
      attachments
    }
  };

  try {
    return await bridge.sendMessage(ipcPayload);
  } catch (error) {
    throw normalizeIpcError(error, "Unable to send message.");
  }
}
