import type { HourlySalesRow } from "@shiftagent/shared";

export interface ClearviewTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface IClearviewClient {
  readonly mode: "mock" | "live";

  getAuthorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<ClearviewTokens>;
  refreshToken(refreshToken: string): Promise<ClearviewTokens>;
  fetchHourlySales(
    storeId: string,
    weekStart: string,
    weekEnd: string
  ): Promise<HourlySalesRow[]>;
}
