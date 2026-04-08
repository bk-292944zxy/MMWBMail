export type ComposeRecipientBucket = "to" | "cc" | "bcc";
export type ComposeRecipientStatus = "valid" | "invalid";

export type ComposeRecipient = {
  raw: string;
  address: string;
  displayName: string | null;
  normalized: string;
  valid: boolean;
};

export type ComposeRecipientGroups = {
  to: string[];
  cc: string[];
  bcc: string[];
};

export type StructuredComposeRecipient = ComposeRecipient & {
  bucket: ComposeRecipientBucket;
  dedupeKey: string;
  status: ComposeRecipientStatus;
};

export type StructuredComposeRecipientGroups = {
  to: StructuredComposeRecipient[];
  cc: StructuredComposeRecipient[];
  bcc: StructuredComposeRecipient[];
};
