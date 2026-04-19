import { prisma } from "@/lib/prisma";
import { AI_OWNER_LEGACY_SCOPE, resolveCurrentAiOwner } from "@/lib/ai-owner";
import { decryptStoredSecret, encryptStoredSecret } from "@/lib/secret-crypto";

const TAVILY_PROVIDER = "tavily";
const TAVILY_API_KEY_MAX_LENGTH = 512;

export type TavilySettingsSummary = {
  ownerLabel: string;
  provider: "tavily";
  configured: boolean;
  keyLastFour: string | null;
};

function normalizeTavilyApiKey(input: string) {
  const value = input.trim();

  if (!value) {
    throw new Error("Enter a Tavily API key.");
  }

  if (value.length > TAVILY_API_KEY_MAX_LENGTH) {
    throw new Error("That Tavily API key is too long.");
  }

  return value;
}

async function findTavilyCredentialRecord(ownerScope: string) {
  return prisma.aiCredential.findFirst({
    where: {
      ownerScope,
      provider: TAVILY_PROVIDER
    }
  });
}

async function findTavilyCredentialRecordForOwner(owner: {
  scope: string;
  type: string;
}) {
  const current = await findTavilyCredentialRecord(owner.scope);
  if (current) {
    return current;
  }

  if (owner.scope === AI_OWNER_LEGACY_SCOPE) {
    return null;
  }

  const legacy = await findTavilyCredentialRecord(AI_OWNER_LEGACY_SCOPE);
  if (!legacy) {
    return null;
  }

  try {
    return await prisma.aiCredential.update({
      where: {
        id: legacy.id
      },
      data: {
        ownerScope: owner.scope,
        ownerType: owner.type
      }
    });
  } catch {
    return legacy;
  }
}

function readStoredTavilyKey(encryptedApiKey: string | null | undefined) {
  if (!encryptedApiKey?.trim()) {
    return null;
  }

  try {
    const decrypted = decryptStoredSecret(encryptedApiKey).trim();
    return decrypted.length > 0 ? decrypted : null;
  } catch {
    return null;
  }
}

function toSummary(ownerLabel: string, key: string | null): TavilySettingsSummary {
  return {
    ownerLabel,
    provider: "tavily",
    configured: Boolean(key),
    keyLastFour: key ? key.slice(-4).padStart(4, "0") : null
  };
}

export async function getTavilySettingsSummary() {
  const owner = await resolveCurrentAiOwner();
  const record = await findTavilyCredentialRecordForOwner(owner);
  return toSummary(owner.label, readStoredTavilyKey(record?.encryptedApiKey));
}

export async function saveTavilyCredential(input: { apiKey: string }) {
  const owner = await resolveCurrentAiOwner();
  const apiKey = normalizeTavilyApiKey(input.apiKey);
  const encryptedApiKey = encryptStoredSecret(apiKey);
  const record = await findTavilyCredentialRecordForOwner(owner);

  if (record) {
    await prisma.aiCredential.update({
      where: {
        id: record.id
      },
      data: {
        ownerType: owner.type,
        provider: TAVILY_PROVIDER,
        encryptedApiKey,
        status: "connected",
        lastValidatedAt: null,
        lastError: null
      }
    });
  } else {
    await prisma.aiCredential.create({
      data: {
        ownerScope: owner.scope,
        ownerType: owner.type,
        provider: TAVILY_PROVIDER,
        encryptedApiKey,
        status: "connected",
        lastValidatedAt: null,
        lastError: null
      }
    });
  }

  return toSummary(owner.label, apiKey);
}

export async function removeTavilyCredential() {
  const owner = await resolveCurrentAiOwner();
  await prisma.aiCredential.deleteMany({
    where: {
      ownerScope: owner.scope,
      provider: TAVILY_PROVIDER
    }
  });

  return toSummary(owner.label, null);
}

export async function getCurrentOwnerTavilyApiKey() {
  const owner = await resolveCurrentAiOwner();
  const record = await findTavilyCredentialRecordForOwner(owner);

  if (record) {
    const storedKey = readStoredTavilyKey(record.encryptedApiKey);
    if (storedKey) {
      return storedKey;
    }
  }

  const envFallback = process.env.TAVILY_API_KEY?.trim() ?? "";
  if (envFallback) {
    return envFallback;
  }

  throw new Error(
    "QuickFact isn't configured yet. Add your Tavily API key in Settings to use sourced answers."
  );
}
