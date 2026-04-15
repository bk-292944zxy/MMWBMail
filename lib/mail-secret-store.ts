import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { decryptStoredSecret, encryptStoredSecret } from "@/lib/secret-crypto";

export interface MailSecretStore {
  getPassword(accountId: string): Promise<string | null>;
  setPassword(accountId: string, password: string): Promise<void>;
  deletePassword(accountId: string): Promise<void>;
}

type SecretFileShape = {
  version: 1;
  mailAccountPasswords: Record<string, string>;
};

const SECRET_FILE_VERSION = 1 as const;
const defaultSecretFilePath = join(process.cwd(), ".maximail-secrets", "mail-account-secrets.json");
const secretFilePath = process.env.LOCAL_SECRET_STORE_PATH?.trim() || defaultSecretFilePath;

let writeQueue: Promise<void> = Promise.resolve();

function createEmptyStore(): SecretFileShape {
  return {
    version: SECRET_FILE_VERSION,
    mailAccountPasswords: {}
  };
}

function normalizeStore(raw: unknown): SecretFileShape {
  if (
    raw &&
    typeof raw === "object" &&
    (raw as { version?: unknown }).version === SECRET_FILE_VERSION &&
    typeof (raw as { mailAccountPasswords?: unknown }).mailAccountPasswords === "object" &&
    (raw as { mailAccountPasswords?: unknown }).mailAccountPasswords !== null
  ) {
    return {
      version: SECRET_FILE_VERSION,
      mailAccountPasswords: {
        ...(raw as { mailAccountPasswords: Record<string, string> }).mailAccountPasswords
      }
    };
  }

  return createEmptyStore();
}

async function readStoreFile() {
  try {
    const raw = await readFile(secretFilePath, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createEmptyStore();
    }
    throw error;
  }
}

async function writeStoreFile(store: SecretFileShape) {
  await mkdir(dirname(secretFilePath), { recursive: true });

  const tmpPath = `${secretFilePath}.${process.pid}.${Date.now()}.tmp`;
  const content = `${JSON.stringify(store, null, 2)}\n`;
  await writeFile(tmpPath, content, { mode: 0o600 });
  await rename(tmpPath, secretFilePath);
}

async function withWriteLock(task: () => Promise<void>) {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(
    () => undefined,
    () => undefined
  );
  await next;
}

class LocalFileMailSecretStore implements MailSecretStore {
  async getPassword(accountId: string) {
    const store = await readStoreFile();
    const encrypted = store.mailAccountPasswords[accountId];

    if (!encrypted) {
      return null;
    }

    return decryptStoredSecret(encrypted);
  }

  async setPassword(accountId: string, password: string) {
    await withWriteLock(async () => {
      const store = await readStoreFile();
      store.mailAccountPasswords[accountId] = encryptStoredSecret(password);
      await writeStoreFile(store);
    });
  }

  async deletePassword(accountId: string) {
    await withWriteLock(async () => {
      const store = await readStoreFile();
      if (!(accountId in store.mailAccountPasswords)) {
        return;
      }
      delete store.mailAccountPasswords[accountId];
      await writeStoreFile(store);
    });
  }
}

export const mailSecretStore: MailSecretStore = new LocalFileMailSecretStore();
