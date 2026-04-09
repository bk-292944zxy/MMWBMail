import { prisma } from "@/lib/prisma";
import { resolveCurrentAiOwner } from "@/lib/ai-owner";
import { decryptStoredSecret, encryptStoredSecret } from "@/lib/secret-crypto";

const OPENAI_PROVIDER = "openai";
const OPENAI_API_KEY_MAX_LENGTH = 512;

export type AiCredentialStatus = "not_configured" | "connected" | "invalid";

export type AiSettingsSummary = {
  ownerLabel: string;
  provider: "openai";
  configured: boolean;
  status: AiCredentialStatus;
  lastValidatedAt: string | null;
  lastError: string | null;
};

type ValidationResult = {
  status: Exclude<AiCredentialStatus, "not_configured">;
  lastError: string | null;
  lastValidatedAt: Date | null;
};

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

  return getAiSettingsSummary();
}

async function callOpenAiValidation(apiKey: string): Promise<ValidationResult> {
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      cache: "no-store"
    });

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
  } catch {
    return {
      status: "invalid",
      lastError:
        "We could not reach OpenAI to validate this key right now. Check your key and try again.",
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
