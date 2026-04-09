import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { getMailAccountSecret } from "@/lib/env";

function getEncryptionKey() {
  return createHash("sha256").update(getMailAccountSecret()).digest();
}

export function encryptStoredSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptStoredSecret(value: string) {
  const decoded = Buffer.from(value, "base64");
  const iv = decoded.subarray(0, 12);
  const authTag = decoded.subarray(12, 28);
  const encrypted = decoded.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
