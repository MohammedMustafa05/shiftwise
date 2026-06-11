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

/**
 * Run `fn` inside a single client transaction with the RLS session variable
 * `app.current_workplace_id` set for the duration.  All queries inside `fn`
 * run through the same client so they are automatically scoped to the tenant.
 *
 * Usage (in route handlers):
 *   const result = await withWorkplace(workplaceId, async (wq) => {
 *     return wq.query<Row>(`SELECT ... FROM ... WHERE workplace_id = $1`, [workplaceId]);
 *   });
 */
export async function withWorkplace<T>(
  workplaceId: string,
  fn: (client: { query: typeof query }) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Activate RLS for this connection — policies read this setting.
    await client.query(`SET LOCAL app.current_workplace_id = '${workplaceId.replace(/'/g, "''")}'`);
    const scopedQuery = <R extends pg.QueryResultRow = pg.QueryResultRow>(
      text: string,
      params?: unknown[]
    ) => client.query<R>(text, params);
    const result = await fn({ query: scopedQuery as typeof query });
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function endPool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}
