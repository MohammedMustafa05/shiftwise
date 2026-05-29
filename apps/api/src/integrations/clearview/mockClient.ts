import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { HourlySalesRow } from "@shiftagent/shared";
import { config } from "../../config.js";
import type { ClearviewTokens, IClearviewClient } from "./types.js";
import { mapRawClearviewSales, normalizeSalesToWeek } from "./normalizeSales.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(): Array<{ date: string; hour: number; amount: number }> {
  const fixturePath = path.resolve(__dirname, "../../../fixtures/clearview_sales_response.json");
  const raw = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
    transactions: Array<{ date: string; hour: number; amount: number }>;
  };
  return raw.transactions;
}

export class MockClearviewClient implements IClearviewClient {
  readonly mode = "mock" as const;

  getAuthorizationUrl(state: string): string {
    const base = config.clearview.redirectUri.replace(/\/callback$/, "");
    return `${base}/callback?code=mock_auth_code&state=${encodeURIComponent(state)}`;
  }

  async exchangeCode(_code: string): Promise<ClearviewTokens> {
    return {
      accessToken: "mock_access_token",
      refreshToken: "mock_refresh_token",
      expiresAt: new Date(Date.now() + 86400_000 * 30),
    };
  }

  async refreshToken(_refreshToken: string): Promise<ClearviewTokens> {
    return this.exchangeCode("mock");
  }

  async fetchHourlySales(
    _storeId: string,
    weekStart: string,
    _weekEnd: string
  ): Promise<HourlySalesRow[]> {
    const raw = mapRawClearviewSales(loadFixture());
    return normalizeSalesToWeek(raw, weekStart);
  }
}
