-- UI integration: extended profiles, approvals, transfers, activity

ALTER TABLE employee_profiles
  ADD COLUMN IF NOT EXISTS profile_data JSONB NOT NULL DEFAULT '{}';

ALTER TABLE schedule_shifts
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS availability_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workplace_id UUID NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  availability_grid JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (user_id, week_start)
);

CREATE TABLE IF NOT EXISTS time_off_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workplace_id UUID NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS shift_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES schedule_shifts(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workplace_id UUID NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  actor_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_availability_submissions_workplace ON availability_submissions(workplace_id, status);
CREATE INDEX IF NOT EXISTS idx_time_off_requests_workplace ON time_off_requests(workplace_id, status);
CREATE INDEX IF NOT EXISTS idx_shift_transfers_to_user ON shift_transfers(to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_activity_log_workplace ON activity_log(workplace_id, created_at DESC);
