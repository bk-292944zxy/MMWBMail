import { listFolders } from "@/lib/mail-client";
import { getMailAccountProviderInfo } from "@/lib/mail-provider-metadata";
import { normalizeMailConnectionWithProviderDefaults } from "@/lib/mail-provider-profiles";
import type { MailConnectionPayload } from "@/lib/mail-types";

type VerifyAccountInput = MailConnectionPayload & {
  provider?: string | null;
};

export async function verifyMailAccountConnection(input: VerifyAccountInput) {
  const normalized = normalizeMailConnectionWithProviderDefaults(input);

  if (!normalized.connection.email) {
    throw new Error("Email is required.");
  }

  if (!normalized.connection.password) {
    throw new Error("Password is required.");
  }

  if (!normalized.connection.imapHost || !normalized.connection.smtpHost) {
    throw new Error("IMAP and SMTP hosts are required.");
  }

  const folders = await listFolders(normalized.connection);
  const provider = getMailAccountProviderInfo({
    provider: normalized.kind,
    email: normalized.connection.email,
    imapHost: normalized.connection.imapHost,
    smtpHost: normalized.connection.smtpHost
  });

  return {
    folders,
    provider,
    connection: {
      email: normalized.connection.email,
      imapHost: normalized.connection.imapHost,
      imapPort: normalized.connection.imapPort,
      imapSecure: normalized.connection.imapSecure,
      smtpHost: normalized.connection.smtpHost,
      smtpPort: normalized.connection.smtpPort,
      smtpSecure: normalized.connection.smtpSecure,
      folder: normalized.connection.folder
    }
  };
}

