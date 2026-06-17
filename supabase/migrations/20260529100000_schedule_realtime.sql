-- Enable Supabase Realtime for schedule tables (mobile live updates)
-- Wrapped in DO block so plain Postgres (CI) doesn't fail.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE schedules;
    ALTER PUBLICATION supabase_realtime ADD TABLE schedule_shifts;
  END IF;
END $$;
