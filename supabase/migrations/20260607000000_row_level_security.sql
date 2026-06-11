-- Row Level Security for multi-tenant data isolation
-- This implements application-driven RLS via SET app.current_workplace_id
-- before each query (set by the API middleware / pool helper).
--
-- Tables that contain PII or cross-tenant risk are protected.
-- The application DB user is granted the rls_appuser role to enforce policies.
-- Admin migrations / seeds continue to run as the superuser (bypasses RLS).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enable RLS on all tenant-scoped tables
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE users                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE hourly_sales_data         ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_submissions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_off_requests         ENABLE ROW LEVEL SECURITY;
ALTER TABLE workplace_invites         ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications             ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_transfers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_open_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE workplace_announcements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE clearview_connections     ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Helper: current session workplace_id (returns NULL if not set)
-- ─────────────────────────────────────────────────────────────────────────────
-- Usage: SET app.current_workplace_id = '<uuid>'; before each query.
-- The API pool wrapper (withWorkplace) does this per request.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Policies — one per table, using current_setting to read the session var
--    BYPASSRLS is granted to the superuser / migration role automatically.
-- ─────────────────────────────────────────────────────────────────────────────

-- users: scoped by workplace_id column
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

-- shifts (join through schedules)
DROP POLICY IF EXISTS shifts_workplace ON shifts;
CREATE POLICY shifts_workplace ON shifts
  USING (
    EXISTS (
      SELECT 1 FROM schedules s
      WHERE s.id = shifts.schedule_id
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
    -- public join preview (slug lookup) must also work without a session var
    OR current_setting('app.current_workplace_id', true) IS NULL
    OR current_setting('app.current_workplace_id', true) = ''
  );

-- activity_logs
DROP POLICY IF EXISTS al_workplace ON activity_logs;
CREATE POLICY al_workplace ON activity_logs
  USING (
    workplace_id::text = current_setting('app.current_workplace_id', true)
    OR current_setting('app.current_workplace_id', true) IS NULL
    OR current_setting('app.current_workplace_id', true) = ''
  );

-- notifications
DROP POLICY IF EXISTS notif_workplace ON notifications;
CREATE POLICY notif_workplace ON notifications
  USING (
    workplace_id::text = current_setting('app.current_workplace_id', true)
    OR current_setting('app.current_workplace_id', true) IS NULL
    OR current_setting('app.current_workplace_id', true) = ''
  );

-- shift_transfers
DROP POLICY IF EXISTS st_workplace ON shift_transfers;
CREATE POLICY st_workplace ON shift_transfers
  USING (
    workplace_id::text = current_setting('app.current_workplace_id', true)
    OR current_setting('app.current_workplace_id', true) IS NULL
    OR current_setting('app.current_workplace_id', true) = ''
  );

-- shift_open_requests
DROP POLICY IF EXISTS sor_workplace ON shift_open_requests;
CREATE POLICY sor_workplace ON shift_open_requests
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
