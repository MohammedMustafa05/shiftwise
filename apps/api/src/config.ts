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

export const config = {
  port: parseInt(process.env.PORT ?? "3001", 10),
  databaseUrl: resolveDatabaseUrl(),
  supabase: {
    url: process.env.SUPABASE_URL ?? "",
    projectRef: process.env.SUPABASE_PROJECT_REF ?? "",
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
  },
  jwtSecret: process.env.JWT_SECRET ?? "dev-jwt-secret-change-me",
  mlEngineUrl: process.env.ML_ENGINE_URL ?? "http://localhost:8000",
  cronSecret: process.env.CRON_SECRET ?? "dev-cron-secret",
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? "",
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
