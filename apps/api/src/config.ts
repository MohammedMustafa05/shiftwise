import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

/** Postgres URI for the API pool (Supabase session pooler or local Docker). */
function resolveDatabaseUrl(): string {
  const explicit = process.env.DATABASE_URL?.trim();
  if (explicit && !explicit.includes("localhost") && !explicit.includes("127.0.0.1")) {
    return explicit;
  }

  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
  if (password && projectRef) {
    const host =
      process.env.SUPABASE_DB_HOST?.trim() ??
      `aws-1-us-west-2.pooler.supabase.com`;
    return `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@${host}:5432/postgres`;
  }

  return explicit ?? "";
}

function parseCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) return ["http://localhost:5173"];
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parseInt(process.env.PORT ?? "3001", 10),
  databaseUrl: resolveDatabaseUrl(),
  supabase: {
    url: process.env.SUPABASE_URL ?? "",
    projectRef: process.env.SUPABASE_PROJECT_REF ?? "",
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
  },
  jwtSecret: process.env.JWT_SECRET ?? "dev-jwt-secret-change-me",
  mlEngineUrl: process.env.ML_ENGINE_URL ?? "http://localhost:8000",
  mlEngineApiKey: process.env.ML_ENGINE_API_KEY ?? "",
  cronSecret: process.env.CRON_SECRET ?? "dev-cron-secret",
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? "",
  corsOrigins: parseCorsOrigins(),
  redisUrl: process.env.REDIS_URL ?? "",
  llmProvider: (process.env.LLM_PROVIDER ?? "anthropic") as "anthropic" | "openai",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  llmOpenaiModel: process.env.LLM_OPENAI_MODEL ?? "gpt-4o-mini",
  llmMaxTokens: parseInt(process.env.LLM_MAX_TOKENS ?? "16384", 10),
  llmBatchMinEmployees: parseInt(process.env.LLM_BATCH_MIN_EMPLOYEES ?? "10", 10),
  llmPrimaryModel: process.env.LLM_PRIMARY_MODEL ?? "claude-sonnet-4-6",
  llmFallbackModel: process.env.LLM_FALLBACK_MODEL ?? "claude-sonnet-4-6",
  rateLimitDisabled: process.env.RATE_LIMIT_DISABLED === "1",
  clearview: {
    mode: (process.env.CLEARVIEW_MODE ?? "mock") as "mock" | "live",
    clientId: process.env.CLEARVIEW_CLIENT_ID ?? "dummy_client_id",
    clientSecret: process.env.CLEARVIEW_CLIENT_SECRET ?? "dummy_client_secret",
    apiBaseUrl: process.env.CLEARVIEW_API_BASE_URL ?? "https://mock.clearview.local",
    redirectUri:
      process.env.CLEARVIEW_REDIRECT_URI ??
      "http://localhost:3001/api/clearview/callback",
  },
  exportsDir: process.env.EXPORTS_DIR ?? path.resolve(__dirname, "../exports"),
};

export function assertDatabaseConfigured(): void {
  if (!config.databaseUrl) {
    throw new Error(
      "Database not configured. Set SUPABASE_DB_PASSWORD (and SUPABASE_PROJECT_REF) or DATABASE_URL in .env"
    );
  }
}

function isWeakSecret(value: string, devDefaults: string[]): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length < 32) return true;
  return devDefaults.some((d) => trimmed === d);
}

/** Rejects weak secrets when NODE_ENV=production. */
export function assertProductionConfig(): void {
  if (config.nodeEnv !== "production") return;

  const errors: string[] = [];

  if (isWeakSecret(config.jwtSecret, ["dev-jwt-secret-change-me", "change-me-in-production", "test-jwt-secret", "test-secret"])) {
    errors.push("JWT_SECRET must be at least 32 characters and not a default value");
  }
  if (isWeakSecret(config.cronSecret, ["dev-cron-secret"])) {
    errors.push("CRON_SECRET must be at least 32 characters and not a default value");
  }
  if (isWeakSecret(config.tokenEncryptionKey, [])) {
    errors.push("TOKEN_ENCRYPTION_KEY must be at least 32 characters");
  }

  if (errors.length > 0) {
    throw new Error(`Production config invalid:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }
}
