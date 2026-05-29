import { query } from "../db/pool.js";

export type AnnouncementType =
  | "schedule_published"
  | "shift_request_accepted"
  | "shift_request_rejected"
  | "time_off_accepted"
  | "time_off_rejected"
  | "transfer_shift_accepted"
  | "transfer_shift_rejected"
  | "offer_shift_accepted"
  | "availability_accepted"
  | "availability_rejected";

export type EmployeeAnnouncement = {
  id: string;
  title: string;
  date: string;
  type: AnnouncementType;
  route: string;
  read: boolean;
};

function formatAnnouncementDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export async function createNotification(
  userId: string,
  workplaceId: string,
  type: AnnouncementType,
  title: string,
  route: string,
  referenceId?: string
): Promise<void> {
  if (referenceId) {
    const existing = await query(
      `SELECT id FROM employee_notifications
       WHERE user_id = $1 AND type = $2 AND reference_id = $3
       LIMIT 1`,
      [userId, type, referenceId]
    );
    if (existing.rows.length > 0) return;
  }

  await query(
    `INSERT INTO employee_notifications (user_id, workplace_id, type, title, route, reference_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, workplaceId, type, title, route, referenceId ?? null]
  );
}

export async function notifyWorkplaceEmployees(
  workplaceId: string,
  type: AnnouncementType,
  title: string,
  route: string,
  referenceId?: string
): Promise<void> {
  const employees = await query<{ id: string }>(
    `SELECT id FROM users WHERE workplace_id = $1 AND role = 'EMPLOYEE'`,
    [workplaceId]
  );
  for (const emp of employees.rows) {
    await createNotification(emp.id, workplaceId, type, title, route, referenceId);
  }
}

export async function getEmployeeAnnouncements(userId: string): Promise<EmployeeAnnouncement[]> {
  const result = await query<{
    id: string;
    type: string;
    title: string;
    route: string;
    read_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, type, title, route, read_at, created_at
     FROM employee_notifications
     WHERE user_id = $1
     ORDER BY read_at NULLS FIRST, created_at DESC
     LIMIT 30`,
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    date: formatAnnouncementDate(
      row.created_at instanceof Date ? row.created_at : new Date(row.created_at)
    ),
    type: row.type as AnnouncementType,
    route: row.route,
    read: row.read_at != null,
  }));
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<void> {
  await query(
    `UPDATE employee_notifications SET read_at = now()
     WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
    [notificationId, userId]
  );
}
