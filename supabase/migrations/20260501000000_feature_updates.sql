-- Feature updates: announcements, time off type, profile flags, realtime

ALTER TABLE time_off_requests
  ADD COLUMN IF NOT EXISTS request_type TEXT NOT NULL DEFAULT 'Personal';

CREATE TABLE IF NOT EXISTS workplace_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workplace_id UUID NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workplace_announcements_workplace
  ON workplace_announcements(workplace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS employee_schedule_views (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, schedule_id)
);
