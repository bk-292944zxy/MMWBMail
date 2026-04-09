import { prisma } from "@/lib/prisma";
import { resolveCurrentAiOwner } from "@/lib/ai-owner";
import { decryptStoredSecret, encryptStoredSecret } from "@/lib/secret-crypto";

const OPENAI_PROVIDER = "openai";
const OPENAI_API_KEY_MAX_LENGTH = 512;
export const AI_AVAILABILITY_FRESH_MS = 5 * 60 * 1000;
const OPENAI_SETTINGS_TIMEOUT_MS = 5000;

export type AiCredentialStatus = "not_configured" | "connected" | "invalid";
export type AiAvailabilityStatus =
  | "unknown"
  | "available"
  | "unavailable_invalid_key"
  | "unavailable_quota_or_billing"
  | "unavailable_rate_limited"
  | "unavailable_temporary_error";

export type AiSettingsSummary = {
  ownerLabel: string;
  provider: "openai";
  configured: boolean;
  status: AiCredentialStatus;
  lastValidatedAt: string | null;
  lastError: string | null;
};

export type AiAvailabilitySummary = {
  ownerLabel: string;
  provider: "openai";
  configured: boolean;
  status: AiAvailabilityStatus;
  checkedAt: string | null;
  message: string | null;
};

type ValidationResult = {
  status: Exclude<AiCredentialStatus, "not_configured">;
  lastError: string | null;
  lastValidatedAt: Date | null;
};

type AvailabilityResult = {
  status: Exclude<AiAvailabilityStatus, "unknown">;
  checkedAt: Date;
  message: string | null;
};

const availabilityCache = new Map<
  string,
  {
    checkedAt: number;
    result: AiAvailabilitySummary;
  }
>();

function mapStatus(value: string | null | undefined): AiCredentialStatus {
  if (value === "connected" || value === "invalid") {
    return value;
  }

  return "not_configured";
}

function toSummary(record: {
  status: string;
  lastValidatedAt: Date | null;
  lastError: string | null;
} | null): AiSettingsSummary {
  const owner = resolveCurrentAiOwner();

  return {
    ownerLabel: owner.label,
    provider: "openai",
    configured: Boolean(record),
    status: record ? mapStatus(record.status) : "not_configured",
    lastValidatedAt: record?.lastValidatedAt?.toISOString() ?? null,
    lastError: record?.lastError ?? null
  };
}

function normalizeApiKey(input: string) {
  const value = input.trim();

  if (!value) {
    throw new Error("Enter an OpenAI API key.");
  }

  if (!value.startsWith("sk-")) {
    throw new Error("This does not look like an OpenAI API key. Paste an API key, not a ChatGPT login.");
  }

  if (value.length > OPENAI_API_KEY_MAX_LENGTH) {
    throw new Error("That API key is too long.");
  }

  return value;
}

function toAvailabilitySummary(input: {
  ownerLabel: string;
  configured: boolean;
  status: AiAvailabilityStatus;
  checkedAt: Date | null;
  message: string | null;
}): AiAvailabilitySummary {
  return {
    ownerLabel: input.ownerLabel,
    provider: "openai",
    configured: input.configured,
    status: input.status,
    checkedAt: input.checkedAt?.toISOString() ?? null,
    message: input.message
  };
}

function buildAvailabilityMessage(status: Exclude<AiAvailabilityStatus, "unknown">) {
  switch (status) {
    case "available":
      return null;
    case "unavailable_invalid_key":
      return "Your API key may be invalid or revoked.";
    case "unavailable_quota_or_billing":
      return "Your OpenAI API account may be out of credit or over its usage limit.";
    case "unavailable_rate_limited":
      return "The AI service appears rate-limited right now. Try again shortly.";
    case "unavailable_temporary_error":
      return "Your API key is saved, but AI rewrites aren’t available right now. Update billing, limits, or retry later.";
  }
}

function classifyAvailabilityFailure(input: {
  status: number;
  errorCode?: string | null;
  errorType?: string | null;
  message?: string | null;
}): Exclude<AiAvailabilityStatus, "unknown" | "available"> {
  const haystack = `${input.errorCode ?? ""} ${input.errorType ?? ""} ${input.message ?? ""}`
    .toLowerCase()
    .trim();

  if (
    input.status === 401 ||
    haystack.includes("invalid_api_key") ||
    haystack.includes("incorrect api key") ||
    haystack.includes("invalid authentication")
  ) {
    return "unavailable_invalid_key";
  }

  if (
    haystack.includes("insufficient_quota") ||
    haystack.includes("billing") ||
    haystack.includes("credit") ||
    haystack.includes("quota") ||
    haystack.includes("hard limit")
  ) {
    return "unavailable_quota_or_billing";
  }

  if (input.status === 429 || haystack.includes("rate limit")) {
    return "unavailable_rate_limited";
  }

  return "unavailable_temporary_error";
}

async function callOpenAiAvailability(apiKey: string): Promise<AvailabilityResult> {
  const checkedAt = new Date();

  try {
    const response = await fetchOpenAiModels(apiKey);

    if (response.ok) {
      return {
        status: "available",
        checkedAt,
        message: null
      };
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          error?: {
            code?: string;
            type?: string;
            message?: string;
          };
        }
      | null;

    const status = classifyAvailabilityFailure({
      status: response.status,
      errorCode: payload?.error?.code ?? null,
      errorType: payload?.error?.type ?? null,
      message: payload?.error?.message ?? null
    });

    return {
      status,
      checkedAt,
      message: buildAvailabilityMessage(status)
    };
  } catch {
    return {
      status: "unavailable_temporary_error",
      checkedAt,
      message: buildAvailabilityMessage("unavailable_temporary_error")
    };
  }
}

function clearAiAvailabilityCache(ownerScope: string) {
  availabilityCache.delete(ownerScope);
}

async function fetchOpenAiModels(apiKey: string) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), OPENAI_SETTINGS_TIMEOUT_MS);

  try {
    return await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      cache: "no-store",
      signal: controller.signal
    });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export async function getAiSettingsSummary() {
  const owner = resolveCurrentAiOwner();
  const record = await prisma.aiCredential.findUnique({
    where: { ownerScope: owner.scope },
    select: {
      status: true,
      lastValidatedAt: true,
      lastError: true
    }
  });

  return toSummary(record);
}

export async function getCurrentOwnerOpenAiCredential() {
  const owner = resolveCurrentAiOwner();
  const record = await prisma.aiCredential.findUnique({
    where: { ownerScope: owner.scope }
  });

  if (!record) {
    throw new Error("AI Writing Assistant isn't configured yet. Add your OpenAI API key in Settings to use rewrite modes.");
  }

  if (record.status === "invalid") {
    throw new Error(
      record.lastError?.trim() ||
        "The saved OpenAI API key needs attention before rewrite requests can use it."
    );
  }

  return {
    owner,
    apiKey: decryptStoredSecret(record.encryptedApiKey),
    status: mapStatus(record.status)
  };
}

export async function removeAiCredential() {
  const owner = resolveCurrentAiOwner();

  await prisma.aiCredential.deleteMany({
    where: {
      ownerScope: owner.scope,
      provider: OPENAI_PROVIDER
    }
  });

  clearAiAvailabilityCache(owner.scope);

  return getAiSettingsSummary();
}

async function callOpenAiValidation(apiKey: string): Promise<ValidationResult> {
  try {
    const response = await fetchOpenAiModels(apiKey);

    if (response.ok) {
      return {
        status: "connected",
        lastError: null,
        lastValidatedAt: new Date()
      };
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          error?: {
            message?: string;
          };
        }
      | null;

    return {
      status: "invalid",
      lastError:
        payload?.error?.message?.trim() ||
        "OpenAI rejected this API key. Check that the key is active and has API access.",
      lastValidatedAt: new Date()
    };
  } catch (error) {
    return {
      status: "invalid",
      lastError:
        error instanceof Error && error.name === "AbortError"
          ? "OpenAI took too long to respond while validating this key. The key was saved, but not confirmed yet."
          : "We could not reach OpenAI to validate this key right now. Check your key and try again.",
      lastValidatedAt: new Date()
    };
  }
}

export async function saveAiCredential(input: {
  apiKey: string;
  validate?: boolean;
}) {
  const owner = resolveCurrentAiOwner();
  const apiKey = normalizeApiKey(input.apiKey);
  const validation = input.validate === false
    ? {
        status: "connected" as const,
        lastError: null,
        lastValidatedAt: null
      }
    : await callOpenAiValidation(apiKey);
  clearAiAvailabilityCache(owner.scope);

  await prisma.aiCredential.upsert({
    where: {
      ownerScope: owner.scope
    },
    create: {
      ownerScope: owner.scope,
      ownerType: owner.type,
      provider: OPENAI_PROVIDER,
      encryptedApiKey: encryptStoredSecret(apiKey),
      status: validation.status,
      lastValidatedAt: validation.lastValidatedAt,
      lastError: validation.lastError
    },
    update: {
      ownerType: owner.type,
      provider: OPENAI_PROVIDER,
      encryptedApiKey: encryptStoredSecret(apiKey),
      status: validation.status,
      lastValidatedAt: validation.lastValidatedAt,
      lastError: validation.lastError
    }
  });

  return getAiSettingsSummary();
}

export async function testStoredAiCredential() {
  const owner = resolveCurrentAiOwner();
  const record = await prisma.aiCredential.findUnique({
    where: {
      ownerScope: owner.scope
    }
  });

  if (!record) {
    throw new Error("No OpenAI API key is configured.");
  }

  const validation = await callOpenAiValidation(decryptStoredSecret(record.encryptedApiKey));
  clearAiAvailabilityCache(owner.scope);

  await prisma.aiCredential.update({
    where: {
      ownerScope: owner.scope
    },
    data: {
      status: validation.status,
      lastValidatedAt: validation.lastValidatedAt,
      lastError: validation.lastError
    }
  });

  return getAiSettingsSummary();
}

export async function testAiCredentialInput(apiKeyInput?: string | null) {
  const owner = resolveCurrentAiOwner();
  const providedApiKey = apiKeyInput?.trim();

  let apiKey = "";

  if (providedApiKey) {
    apiKey = normalizeApiKey(providedApiKey);
  } else {
    const record = await prisma.aiCredential.findUnique({
      where: {
        ownerScope: owner.scope
      }
    });

    if (!record) {
      throw new Error("No OpenAI API key is configured.");
    }

    apiKey = decryptStoredSecret(record.encryptedApiKey);
  }

  const validation = await callOpenAiValidation(apiKey);
  clearAiAvailabilityCache(owner.scope);

  if (!providedApiKey) {
    await prisma.aiCredential.update({
      where: {
        ownerScope: owner.scope
      },
      data: {
        status: validation.status,
        lastValidatedAt: validation.lastValidatedAt,
        lastError: validation.lastError
      }
    });

    return getAiSettingsSummary();
  }

  return {
    ...toSummary({
      status: validation.status,
      lastValidatedAt: validation.lastValidatedAt,
      lastError: validation.lastError
    }),
    configured: false
  };
}

export async function getAiAvailabilitySummary(input?: {
  force?: boolean;
  maxAgeMs?: number;
}) {
  const owner = resolveCurrentAiOwner();
  const maxAgeMs = input?.maxAgeMs ?? AI_AVAILABILITY_FRESH_MS;
  const cached = availabilityCache.get(owner.scope);

  if (!input?.force && cached && Date.now() - cached.checkedAt <= maxAgeMs) {
    return cached.result;
  }

  const record = await prisma.aiCredential.findUnique({
    where: { ownerScope: owner.scope },
    select: {
      encryptedApiKey: true,
      status: true,
      lastError: true,
      lastValidatedAt: true
    }
  });

  if (!record) {
    return toAvailabilitySummary({
      ownerLabel: owner.label,
      configured: false,
      status: "unknown",
      checkedAt: null,
      message: null
    });
  }

  if (record.status === "invalid") {
    const result = toAvailabilitySummary({
      ownerLabel: owner.label,
      configured: true,
      status: "unavailable_invalid_key",
      checkedAt: record.lastValidatedAt ?? new Date(),
      message: record.lastError?.trim() || buildAvailabilityMessage("unavailable_invalid_key")
    });
    availabilityCache.set(owner.scope, {
      checkedAt: Date.now(),
      result
    });
    return result;
  }

  const availability = await callOpenAiAvailability(decryptStoredSecret(record.encryptedApiKey));
  const result = toAvailabilitySummary({
    ownerLabel: owner.label,
    configured: true,
    status: availability.status,
    checkedAt: availability.checkedAt,
    message: availability.message
  });

  availabilityCache.set(owner.scope, {
    checkedAt: availability.checkedAt.getTime(),
    result
  });

  return result;
}
