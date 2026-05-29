-- Enable Supabase Realtime for schedule tables (mobile live updates)
ALTER PUBLICATION supabase_realtime ADD TABLE schedules;
ALTER PUBLICATION supabase_realtime ADD TABLE schedule_shifts;
