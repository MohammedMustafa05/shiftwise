-- Row Level Security for multi-tenant data isolation
-- Tables that contain PII or cross-tenant risk are protected.

-- 1. Enable RLS on all tenant-scoped tables
ALTER TABLE users                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_shifts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE hourly_sales_data         ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_submissions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_off_requests         ENABLE ROW LEVEL SECURITY;
ALTER TABLE workplace_invites         ENABLE ROW LEVEL SECURITY;
ALTER TABLE workplace_announcements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE clearview_connections     ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'activity_log') THEN
    EXECUTE 'ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employee_notifications') THEN
    EXECUTE 'ALTER TABLE employee_notifications ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'shift_transfers') THEN
    EXECUTE 'ALTER TABLE shift_transfers ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'open_shift_posts') THEN
    EXECUTE 'ALTER TABLE open_shift_posts ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- 2. Policies — workplace scoping via session variable

-- users
DROP POLICY IF EXISTS users_workplace ON users;
CREATE POLICY users_workplace ON users
  USING (
    workplace_id::text = current_setting('app.current_workplace_id', true)
    OR current_setting('app.current_workplace_id', true) IS NULL
    OR current_setting('app.current_workplace_id', true) = ''
  );

-- employee_profiles
DROP POLICY IF EXISTS ep_workplace ON employee_profiles;
CREATE POLICY ep_workplace ON employee_profiles
  USING (
    workplace_id::text = current_setting('app.current_workplace_id', true)
    OR current_setting('app.current_workplace_id', true) IS NULL
    OR current_setting('app.current_workplace_id', true) = ''
  );

-- schedules
DROP POLICY IF EXISTS sched_workplace ON schedules;
CREATE POLICY sched_workplace ON schedules
  USING (
    workplace_id::text = current_setting('app.current_workplace_id', true)
    OR current_setting('app.current_workplace_id', true) IS NULL
    OR current_setting('app.current_workplace_id', true) = ''
  );

-- schedule_shifts (join through schedules)
DROP POLICY IF EXISTS shifts_workplace ON schedule_shifts;
CREATE POLICY shifts_workplace ON schedule_shifts
  USING (
    EXISTS (
      SELECT 1 FROM schedules s
      WHERE s.id = schedule_shifts.schedule_id
        AND s.workplace_id::text = current_setting('app.current_workplace_id', true)
    )
    OR current_setting('app.current_workplace_id', true) IS NULL
    OR current_setting('app.current_workplace_id', true) = ''
  );

-- hourly_sales_data
DROP POLICY IF EXISTS hsd_workplace ON hourly_sales_data;
CREATE POLICY hsd_workplace ON hourly_sales_data
  USING (
    workplace_id::text = current_setting('app.current_workplace_id', true)
    OR current_setting('app.current_workplace_id', true) IS NULL
    OR current_setting('app.current_workplace_id', true) = ''
  );

-- availability_submissions
DROP POLICY IF EXISTS avail_workplace ON availability_submissions;
CREATE POLICY avail_workplace ON availability_submissions
  USING (
    workplace_id::text = current_setting('app.current_workplace_id', true)
    OR current_setting('app.current_workplace_id', true) IS NULL
    OR current_setting('app.current_workplace_id', true) = ''
  );

-- time_off_requests
DROP POLICY IF EXISTS tor_workplace ON time_off_requests;
CREATE POLICY tor_workplace ON time_off_requests
  USING (
    workplace_id::text = current_setting('app.current_workplace_id', true)
    OR current_setting('app.current_workplace_id', true) IS NULL
    OR current_setting('app.current_workplace_id', true) = ''
  );

-- workplace_invites
DROP POLICY IF EXISTS wi_workplace ON workplace_invites;
CREATE POLICY wi_workplace ON workplace_invites
  USING (
    workplace_id::text = current_setting('app.current_workplace_id', true)
    OR current_setting('app.current_workplace_id', true) IS NULL
    OR current_setting('app.current_workplace_id', true) = ''
  );

-- workplace_announcements
DROP POLICY IF EXISTS wa_workplace ON workplace_announcements;
CREATE POLICY wa_workplace ON workplace_announcements
  USING (
    workplace_id::text = current_setting('app.current_workplace_id', true)
    OR current_setting('app.current_workplace_id', true) IS NULL
    OR current_setting('app.current_workplace_id', true) = ''
  );

-- clearview_connections
DROP POLICY IF EXISTS cc_workplace ON clearview_connections;
CREATE POLICY cc_workplace ON clearview_connections
  USING (
    workplace_id::text = current_setting('app.current_workplace_id', true)
    OR current_setting('app.current_workplace_id', true) IS NULL
    OR current_setting('app.current_workplace_id', true) = ''
  );

-- activity_log (conditional — table may not exist in all environments)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'activity_log') THEN
    EXECUTE $p$
      DROP POLICY IF EXISTS al_workplace ON activity_log;
      CREATE POLICY al_workplace ON activity_log
        USING (
          workplace_id::text = current_setting('app.current_workplace_id', true)
          OR current_setting('app.current_workplace_id', true) IS NULL
          OR current_setting('app.current_workplace_id', true) = ''
        )
    $p$;
  END IF;
END $$;

-- employee_notifications (conditional)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employee_notifications') THEN
    EXECUTE $p$
      DROP POLICY IF EXISTS notif_workplace ON employee_notifications;
      CREATE POLICY notif_workplace ON employee_notifications
        USING (
          workplace_id::text = current_setting('app.current_workplace_id', true)
          OR current_setting('app.current_workplace_id', true) IS NULL
          OR current_setting('app.current_workplace_id', true) = ''
        )
    $p$;
  END IF;
END $$;

-- shift_transfers (no workplace_id — scope via shift → schedule join)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'shift_transfers') THEN
    EXECUTE $p$
      DROP POLICY IF EXISTS st_workplace ON shift_transfers;
      CREATE POLICY st_workplace ON shift_transfers
        USING (
          EXISTS (
            SELECT 1 FROM schedule_shifts ss
            JOIN schedules s ON s.id = ss.schedule_id
            WHERE ss.id = shift_transfers.shift_id
              AND s.workplace_id::text = current_setting('app.current_workplace_id', true)
          )
          OR current_setting('app.current_workplace_id', true) IS NULL
          OR current_setting('app.current_workplace_id', true) = ''
        )
    $p$;
  END IF;
END $$;

-- open_shift_posts (conditional)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'open_shift_posts') THEN
    EXECUTE $p$
      DROP POLICY IF EXISTS osp_workplace ON open_shift_posts;
      CREATE POLICY osp_workplace ON open_shift_posts
        USING (
          workplace_id::text = current_setting('app.current_workplace_id', true)
          OR current_setting('app.current_workplace_id', true) IS NULL
          OR current_setting('app.current_workplace_id', true) = ''
        )
    $p$;
  END IF;
END $$;
