-- Per-employee notifications for mobile announcements

CREATE TABLE IF NOT EXISTS employee_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workplace_id UUID NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  route TEXT NOT NULL,
  reference_id TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_notifications_user_created
  ON employee_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_employee_notifications_user_unread
  ON employee_notifications(user_id) WHERE read_at IS NULL;
