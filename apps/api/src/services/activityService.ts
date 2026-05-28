import { query } from "../db/pool.js";

export async function logActivity(
  workplaceId: string,
  type: string,
  message: string,
  actorName?: string
): Promise<void> {
  await query(
    `INSERT INTO activity_log (workplace_id, type, message, actor_name) VALUES ($1, $2, $3, $4)`,
    [workplaceId, type, message, actorName ?? null]
  );
}

export async function getActivity(workplaceId: string, limit = 20) {
  const result = await query<{
    id: string;
    type: string;
    message: string;
    actor_name: string | null;
    created_at: Date;
  }>(
    `SELECT id, type, message, actor_name, created_at FROM activity_log
     WHERE workplace_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [workplaceId, limit]
  );
  return result.rows.map((r) => ({
    id: r.id,
    type: r.type,
    message: r.message,
    timestamp: r.created_at.toISOString(),
    actor: r.actor_name,
  }));
}
