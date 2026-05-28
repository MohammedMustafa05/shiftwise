-- Open shift posts + two-way swap support

ALTER TABLE shift_transfers
  ADD COLUMN IF NOT EXISTS target_shift_id UUID REFERENCES schedule_shifts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS open_shift_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES schedule_shifts(id) ON DELETE CASCADE,
  posted_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workplace_id UUID NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'cancelled')),
  claimed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_open_shift_posts_shift_open
  ON open_shift_posts(shift_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_open_shift_posts_workplace_status
  ON open_shift_posts(workplace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shift_transfers_shift_pending
  ON shift_transfers(shift_id) WHERE status = 'pending';
