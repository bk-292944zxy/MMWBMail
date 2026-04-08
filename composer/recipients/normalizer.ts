import type {
  ComposeRecipient,
  ComposeRecipientBucket,
  ComposeRecipientGroups,
  StructuredComposeRecipient,
  StructuredComposeRecipientGroups
} from "@/composer/recipients/types";

const SIMPLE_EMAIL_PATTERN = /([^\s<>"'(),;:]+@[^\s<>"'(),;:]+)/;

function cleanDisplayName(value: string) {
  const cleaned = value.trim().replace(/^['"]+|['"]+$/g, "").trim();
  return cleaned || null;
}

function splitRecipientBlob(value: string) {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let angleDepth = 0;

  for (const char of value) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if (!inQuotes && char === "<") {
      angleDepth += 1;
      current += char;
      continue;
    }

    if (!inQuotes && char === ">" && angleDepth > 0) {
      angleDepth -= 1;
      current += char;
      continue;
    }

    if (!inQuotes && angleDepth === 0 && (char === "," || char === ";" || char === "\n")) {
      const trimmed = current.trim();
      if (trimmed) {
        parts.push(trimmed);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const trailing = current.trim();
  if (trailing) {
    parts.push(trailing);
  }

  return parts;
}

export function parseComposeRecipient(value: string): ComposeRecipient | null {
  const trimmed = value.trim().replace(/[;,]+$/g, "").trim();
  if (!trimmed) {
    return null;
  }

  const angleMatch = trimmed.match(/^(.*?)<\s*([^<>@\s]+@[^<>@\s]+)\s*>$/);
  if (angleMatch) {
    const displayName = cleanDisplayName(angleMatch[1] ?? "");
    const address = (angleMatch[2] ?? "").trim();
    if (!address) {
      return null;
    }

    return {
      raw: trimmed,
      address,
      displayName,
      normalized: address.toLowerCase(),
      valid: true
    };
  }

  const emailMatch = trimmed.match(SIMPLE_EMAIL_PATTERN);
  if (emailMatch?.[1]) {
    const address = emailMatch[1].trim();
    const nameSource = trimmed.replace(address, "").replace(/[<>]/g, "").trim();

    return {
      raw: trimmed,
      address,
      displayName: cleanDisplayName(nameSource),
      normalized: address.toLowerCase(),
      valid: true
    };
  }

  return {
    raw: trimmed,
    address: trimmed,
    displayName: null,
    normalized: trimmed.toLowerCase(),
    valid: false
  };
}

export function serializeComposeRecipient(recipient: ComposeRecipient) {
  if (!recipient.valid) {
    return recipient.raw;
  }

  return recipient.displayName
    ? `${recipient.displayName} <${recipient.address}>`
    : recipient.address;
}

export function getComposeRecipientDedupeKey(recipient: ComposeRecipient) {
  return recipient.valid ? recipient.normalized : `raw:${recipient.normalized}`;
}

export function parseComposeRecipientList(value: string | string[] | undefined): ComposeRecipient[] {
  if (!value) {
    return [];
  }

  const parts = Array.isArray(value)
    ? value.flatMap((entry) => splitRecipientBlob(entry))
    : splitRecipientBlob(value);

  return parts
    .map((entry) => parseComposeRecipient(entry))
    .filter((entry): entry is ComposeRecipient => Boolean(entry));
}

export function normalizeRecipientStrings(value: string | string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const recipient of parseComposeRecipientList(value)) {
    const key = getComposeRecipientDedupeKey(recipient);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(serializeComposeRecipient(recipient));
  }

  return normalized;
}

export function appendNormalizedRecipientInput(existing: string[], input: string) {
  return normalizeRecipientStrings([...existing, ...splitRecipientBlob(input)]);
}

export function recipientListIncludesValue(recipients: string[], candidate: string) {
  const parsedCandidate = parseComposeRecipient(candidate);
  if (!parsedCandidate) {
    return false;
  }

  const candidateKey = getComposeRecipientDedupeKey(parsedCandidate);

  return parseComposeRecipientList(recipients).some((recipient) => {
    const recipientKey = getComposeRecipientDedupeKey(recipient);
    return recipientKey === candidateKey;
  });
}

function buildStructuredRecipient(
  recipient: ComposeRecipient,
  bucket: ComposeRecipientBucket
): StructuredComposeRecipient {
  return {
    ...recipient,
    bucket,
    dedupeKey: getComposeRecipientDedupeKey(recipient),
    status: recipient.valid ? "valid" : "invalid"
  };
}

export function normalizeStructuredRecipientGroups(
  groups: ComposeRecipientGroups,
  options?: {
    excludeAddresses?: string[];
  }
): StructuredComposeRecipientGroups {
  const seen = new Set(
    (options?.excludeAddresses ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean)
  );

  const dedupeGroup = (bucket: ComposeRecipientBucket, values: string[]) => {
    const normalized: StructuredComposeRecipient[] = [];

    for (const recipient of parseComposeRecipientList(values)) {
      const structured = buildStructuredRecipient(recipient, bucket);
      if (seen.has(structured.dedupeKey)) {
        continue;
      }

      seen.add(structured.dedupeKey);
      normalized.push(structured);
    }

    return normalized;
  };

  return {
    to: dedupeGroup("to", groups.to),
    cc: dedupeGroup("cc", groups.cc),
    bcc: dedupeGroup("bcc", groups.bcc)
  };
}

export function serializeStructuredRecipientGroups(
  groups: StructuredComposeRecipientGroups
): ComposeRecipientGroups {
  return {
    to: groups.to.map(serializeComposeRecipient),
    cc: groups.cc.map(serializeComposeRecipient),
    bcc: groups.bcc.map(serializeComposeRecipient)
  };
}

export function normalizeRecipientGroups(
  groups: ComposeRecipientGroups,
  options?: {
    excludeAddresses?: string[];
  }
): ComposeRecipientGroups {
  return serializeStructuredRecipientGroups(
    normalizeStructuredRecipientGroups(groups, options)
  );
}
