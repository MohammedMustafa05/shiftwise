const fs = require("fs");
const path = require("path");

function readRootEnvApiUrl() {
  const envPath = path.resolve(__dirname, "../../.env");
  if (!fs.existsSync(envPath)) return undefined;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("EXPO_PUBLIC_API_URL=")) {
      return trimmed.slice("EXPO_PUBLIC_API_URL=".length).trim();
    }
  }
  return undefined;
}

/** @param {import('expo/config').ConfigContext} ctx */
module.exports = ({ config }) => {
  const apiUrl =
    process.env.EXPO_PUBLIC_API_URL ??
    readRootEnvApiUrl() ??
    "http://localhost:3001/api";

  return {
    ...config,
    extra: {
      ...config.extra,
      apiUrl,
    },
  };
};
