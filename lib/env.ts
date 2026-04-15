import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

function isProductionRuntime() {
  return process.env.NODE_ENV === "production";
}

function readEnv(name: string) {
  return process.env[name]?.trim() || "";
}

function normalizeDatabaseUrl(value: string) {
  const trimmed = value.trim();

  if (trimmed.startsWith("file:")) {
    const [pathOnly] = trimmed.split("?");
    return pathOnly;
  }

  return trimmed;
}

export function getDatabaseUrl() {
  const value = readEnv("DATABASE_URL") || "file:./dev.db";

  if (!value) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return normalizeDatabaseUrl(value);
}

export function getDirectDatabaseUrl() {
  const value = readEnv("DIRECT_URL") || readEnv("DATABASE_URL") || "file:./dev.db";

  if (!value) {
    throw new Error("DIRECT_URL or DATABASE_URL must be configured for Prisma.");
  }

  return normalizeDatabaseUrl(value);
}

export function getMailAccountSecret() {
  const configuredSecret = readEnv("MAIL_ACCOUNT_SECRET") || readEnv("NEXTAUTH_SECRET");

  if (configuredSecret) {
    return configuredSecret;
  }

  if (isProductionRuntime()) {
    throw new Error(
      "MAIL_ACCOUNT_SECRET is not configured. Set MAIL_ACCOUNT_SECRET for hosted mail account encryption."
    );
  }

  return "mmwbmail-local-dev-secret";
}

export function getCronSecret() {
  const value = readEnv("CRON_SECRET");

  if (!value) {
    throw new Error("CRON_SECRET is not configured.");
  }

  return value;
}

export function getTavilyApiKey() {
  const value = readEnv("TAVILY_API_KEY");

  if (!value) {
    throw new Error("TAVILY_API_KEY is not configured.");
  }

  return value;
}
