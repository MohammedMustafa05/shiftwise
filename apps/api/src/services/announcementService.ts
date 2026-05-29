import { query } from "../db/pool.js";
import { formatDate } from "../utils/dates.js";
import {
  createNotification,
  getEmployeeAnnouncements,
  markNotificationRead,
  type EmployeeAnnouncement,
} from "./notificationService.js";

export type { EmployeeAnnouncement };

export { createNotification, getEmployeeAnnouncements, markNotificationRead };

/** Returns stored notifications, plus an unviewed published schedule if not yet notified. */
export async function getEmployeeAnnouncementsWithLegacy(
  userId: string,
  workplaceId: string
): Promise<EmployeeAnnouncement[]> {
  const items = await getEmployeeAnnouncements(userId);

  const hasScheduleNotice = items.some(
    (i) => i.type === "schedule_published" && !i.read
  );
  if (!hasScheduleNotice) {
    const published = await query<{ id: string; week_start: Date; updated_at: Date }>(
      `SELECT s.id, s.week_start, s.updated_at FROM schedules s
       WHERE s.workplace_id = $1 AND s.status = 'published'
       ORDER BY s.updated_at DESC LIMIT 1`,
      [workplaceId]
    );
    if (published.rows.length > 0) {
      const row = published.rows[0];
      const viewed = await query(
        `SELECT 1 FROM employee_schedule_views WHERE user_id = $1 AND schedule_id = $2`,
        [userId, row.id]
      );
      if (viewed.rows.length === 0) {
        items.unshift({
          id: `schedule-${row.id}`,
          title: "Weekly schedule is live",
          date: new Date(row.updated_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          }),
          type: "schedule_published",
          route: "/(tabs)/schedule",
          read: false,
        });
      }
    }
  }

  return items;
}

export async function markScheduleViewed(userId: string, scheduleId: string) {
  await query(
    `INSERT INTO employee_schedule_views (user_id, schedule_id) VALUES ($1, $2)
     ON CONFLICT (user_id, schedule_id) DO UPDATE SET viewed_at = now()`,
    [userId, scheduleId]
  );
  await query(
    `UPDATE employee_notifications SET read_at = now()
     WHERE user_id = $1 AND type = 'schedule_published' AND reference_id = $2 AND read_at IS NULL`,
    [userId, scheduleId]
  );
}
