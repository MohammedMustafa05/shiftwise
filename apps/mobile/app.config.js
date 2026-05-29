const fs = require("fs");
const path = require("path");

function readRootEnv(key) {
  const envPath = path.resolve(__dirname, "../../.env");
  if (!fs.existsSync(envPath)) return undefined;
  const prefix = `${key}=`;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return undefined;
}

/** @param {import('expo/config').ConfigContext} ctx */
module.exports = ({ config }) => {
  const apiUrl =
    process.env.EXPO_PUBLIC_API_URL ??
    readRootEnv("EXPO_PUBLIC_API_URL") ??
    "http://localhost:3001/api";
  const supabaseUrl =
    process.env.EXPO_PUBLIC_SUPABASE_URL ?? readRootEnv("EXPO_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    readRootEnv("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  return {
    ...config,
    extra: {
      ...config.extra,
      apiUrl,
      supabaseUrl,
      supabaseAnonKey,
    },
  };
};
