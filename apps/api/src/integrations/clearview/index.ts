import { config } from "../../config.js";
import { LiveClearviewClient } from "./liveClient.js";
import { MockClearviewClient } from "./mockClient.js";
import type { IClearviewClient } from "./types.js";

let client: IClearviewClient | null = null;

export function getClearviewClient(): IClearviewClient {
  if (!client) {
    client =
      config.clearview.mode === "live"
        ? new LiveClearviewClient()
        : new MockClearviewClient();
  }
  return client;
}

export function resetClearviewClientForTests(): void {
  client = null;
}

export * from "./types.js";
