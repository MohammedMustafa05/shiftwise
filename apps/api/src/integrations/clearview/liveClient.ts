import type { HourlySalesRow } from "@shiftwise/shared";
import { config } from "../../config.js";
import { httpError } from "../../middleware/errorHandler.js";
import type { ClearviewTokens, IClearviewClient } from "./types.js";
import { mapRawClearviewSales } from "./normalizeSales.js";

/**
 * Live Clearview Partner Connect client.
 * Implemented for env flip; requires real credentials and endpoint docs from manager.
 */
export class LiveClearviewClient implements IClearviewClient {
  readonly mode = "live" as const;

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: config.clearview.clientId,
      redirect_uri: config.clearview.redirectUri,
      response_type: "code",
      state,
    });
    return `${config.clearview.apiBaseUrl}/oauth/authorize?${params}`;
  }

  async exchangeCode(code: string): Promise<ClearviewTokens> {
    const res = await fetch(`${config.clearview.apiBaseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        client_id: config.clearview.clientId,
        client_secret: config.clearview.clientSecret,
        redirect_uri: config.clearview.redirectUri,
      }),
    });
    if (!res.ok) {
      throw httpError(502, `Clearview token exchange failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined,
    };
  }

  async refreshToken(refreshToken: string): Promise<ClearviewTokens> {
    const res = await fetch(`${config.clearview.apiBaseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: config.clearview.clientId,
        client_secret: config.clearview.clientSecret,
      }),
    });
    if (!res.ok) {
      throw httpError(502, `Clearview token refresh failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined,
    };
  }

  async fetchHourlySales(
    storeId: string,
    weekStart: string,
    weekEnd: string
  ): Promise<HourlySalesRow[]> {
    const params = new URLSearchParams({ storeId, weekStart, weekEnd });
    const res = await fetch(
      `${config.clearview.apiBaseUrl}/api/sales/hourly?${params}`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) {
      throw httpError(502, `Clearview sales fetch failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      transactions: Array<{ date: string; hour: number; amount: number }>;
    };
    return mapRawClearviewSales(data.transactions ?? []);
  }
}
