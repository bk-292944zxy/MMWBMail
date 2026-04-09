function isProductionRuntime() {
  return process.env.NODE_ENV === "production";
}

function readEnv(name: string) {
  return process.env[name]?.trim() || "";
}

function assertHostedDatabaseUrl(value: string, variableName: string) {
  if (isProductionRuntime() && value.startsWith("file:")) {
    throw new Error(
      `${variableName} must point to a hosted Postgres database in production. SQLite file URLs are not supported for Vercel hosting.`
    );
  }
}

export function getDatabaseUrl() {
  const value = readEnv("DATABASE_URL");

  if (!value) {
    throw new Error("DATABASE_URL is not configured.");
  }

  assertHostedDatabaseUrl(value, "DATABASE_URL");
  return value;
}

export function getDirectDatabaseUrl() {
  const value = readEnv("DIRECT_URL") || readEnv("DATABASE_URL");

  if (!value) {
    throw new Error("DIRECT_URL or DATABASE_URL must be configured for Prisma.");
  }

  assertHostedDatabaseUrl(value, "DIRECT_URL");
  return value;
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
