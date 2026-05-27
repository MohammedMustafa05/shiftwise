import pg from "pg";
import { config } from "../config.js";

let poolInstance: pg.Pool | null = null;

export function setPool(pool: pg.Pool): void {
  poolInstance = pool;
}

export function getPool(): pg.Pool {
  if (!poolInstance) {
    if (!config.databaseUrl) {
      throw new Error("DATABASE_URL is not set");
    }
    poolInstance = new pg.Pool({ connectionString: config.databaseUrl });
  }
  return poolInstance;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function endPool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}
