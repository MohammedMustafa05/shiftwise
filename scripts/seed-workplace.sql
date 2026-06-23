-- =============================================================================
-- ShiftWise: Seed employees + availability + sales for any workplace
-- =============================================================================
--
-- USAGE: Set the workplace name below, then run in Supabase SQL Editor.
--
--   1. Sign up a new manager account on the web app
--   2. Set WORKPLACE_NAME below to match the restaurant name they entered
--   3. Paste this entire script into Supabase SQL Editor → Run
--   4. Log in as that manager → Schedule → Generate
--
-- Everything is idempotent — safe to re-run.
-- =============================================================================

-- Just change the WORKPLACE_NAME variable on the line marked ★ inside the DO block below.

BEGIN;

DO $$
DECLARE
  -- ★ CHANGE THIS to your workplace name (uses ILIKE, so partial match works)
  WORKPLACE_NAME TEXT := '%Test Mary Browns%';

  v_wp_id UUID;
  v_mgr_id UUID;
  v_uid UUID;
  v_grid JSONB;
  rec RECORD;

  -- Current week's Monday (for availability submission)
  v_week DATE := date_trunc('week', CURRENT_DATE)::date;

  -- Block JSON snippets
  wd_full TEXT := '[{"block":"full","startTime":"10:00","endTime":"22:00","label":"Full Day"}]';
  wd_morn TEXT := '[{"block":"morning","startTime":"10:00","endTime":"16:00","label":"Morning"}]';
  wd_eve  TEXT := '[{"block":"evening","startTime":"16:00","endTime":"22:00","label":"Evening"}]';
  wd_off  TEXT := '[{"block":"off","startTime":"00:00","endTime":"00:00","label":"Day Off"}]';
  we_full TEXT := '[{"block":"full","startTime":"10:00","endTime":"00:00","label":"Full Day"}]';
  we_morn TEXT := '[{"block":"morning","startTime":"10:00","endTime":"17:00","label":"Morning"}]';
  we_eve  TEXT := '[{"block":"evening","startTime":"17:00","endTime":"00:00","label":"Evening"}]';
  we_off  TEXT := '[{"block":"off","startTime":"00:00","endTime":"00:00","label":"Day Off"}]';

  -- Sales seeding vars
  v_monday DATE;
  v_day DATE;
  v_dow INT;
  week_offset INT;
BEGIN
  -- ═══════════════════════════════════════════════════════════
  -- Step 0: Find the workplace
  -- ═══════════════════════════════════════════════════════════
  SELECT id INTO v_wp_id FROM workplaces WHERE name ILIKE WORKPLACE_NAME LIMIT 1;
  IF v_wp_id IS NULL THEN
    RAISE EXCEPTION 'Workplace not found matching "%". Create a manager account first, then re-run.', WORKPLACE_NAME;
  END IF;
  SELECT id INTO v_mgr_id FROM users WHERE workplace_id = v_wp_id AND role = 'EMPLOYER' LIMIT 1;
  RAISE NOTICE 'Workplace found: % | Manager: %', v_wp_id, v_mgr_id;

  -- ═══════════════════════════════════════════════════════════
  -- Step 1: Seed 19 employees with availability
  -- ═══════════════════════════════════════════════════════════
  CREATE TEMP TABLE _emp (
    n TEXT, e TEXT,
    mon TEXT, tue TEXT, wed TEXT, thu TEXT, fri TEXT, sat TEXT, sun TEXT
  ) ON COMMIT DROP;

  INSERT INTO _emp VALUES
    ('Lisa',        'lisa@marybrowns.local',       'full','full','full','full','full','full','full'),
    ('Aayan',       'aayan@marybrowns.local',      'full','full','full','full','full','full','full'),
    ('Mehran',      'mehran@marybrowns.local',      'full','full','full','full','full','morning','morning'),
    ('Omrah',       'omrah@marybrowns.local',       'full','full','full','full','full','full','full'),
    ('Rupali',      'rupali@marybrowns.local',      'full','full','full','full','full','full','full'),
    ('Sakeena',     'sakeena@marybrowns.local',     'full','full','full','full','full','full','full'),
    ('Aaima',       'aaima@marybrowns.local',       'full','full','full','full','full','full','full'),
    ('Mubeen',      'mubeen@marybrowns.local',      'full','full','full','full','full','full','full'),
    ('Abdul Nafay', 'abdulnafay@marybrowns.local',  'full','full','full','full','full','full','full'),
    ('Hassan',      'hassan@marybrowns.local',      'full','full','full','full','full','full','full'),
    ('Inayah',      'inayah@marybrowns.local',      'full','full','full','full','full','full','full'),
    ('Ghazia',      'ghazia@marybrowns.local',      'full','off','off','off','full','full','full'),
    ('Logan',       'logan@marybrowns.local',        'full','full','off','full','full','full','full'),
    ('Mehrab',      'mehrab@marybrowns.local',       'full','full','full','full','full','full','full'),
    ('Shahmeer',    'shahmeer@marybrowns.local',     'full','full','full','full','full','full','full'),
    ('Sana',        'sana@marybrowns.local',         'evening','off','off','off','off','full','full'),
    ('Pankaj',      'pankaj@marybrowns.local',       'off','full','off','full','full','off','off'),
    ('Simran',      'simran@marybrowns.local',       'full','full','full','full','full','full','full'),
    ('Kazim',       'kazim@marybrowns.local',        'full','full','full','full','full','full','full');

  FOR rec IN SELECT * FROM _emp LOOP
    -- Create user (password: ShiftAgent2026!)
    INSERT INTO users (id, email, password_hash, role, workplace_id, name, created_at, updated_at)
    VALUES (gen_random_uuid(), rec.e,
      '$2b$10$LZpHs8vFRMliJ5G5y8nSxeVqZqGnGJl2Xs1GVHrVhHqR7D1Kq1Wbm',
      'EMPLOYEE', v_wp_id, rec.n, NOW(), NOW())
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_uid;

    INSERT INTO employee_profiles (id, user_id, workplace_id, role, created_at, updated_at)
    VALUES (gen_random_uuid(), v_uid, v_wp_id, 'STAFF', NOW(), NOW())
    ON CONFLICT (user_id) DO NOTHING;

    -- Availability grid
    v_grid := jsonb_build_object(
      'monday',    (CASE rec.mon WHEN 'full' THEN wd_full WHEN 'morning' THEN wd_morn WHEN 'evening' THEN wd_eve ELSE wd_off END)::jsonb,
      'tuesday',   (CASE rec.tue WHEN 'full' THEN wd_full WHEN 'morning' THEN wd_morn WHEN 'evening' THEN wd_eve ELSE wd_off END)::jsonb,
      'wednesday', (CASE rec.wed WHEN 'full' THEN wd_full WHEN 'morning' THEN wd_morn WHEN 'evening' THEN wd_eve ELSE wd_off END)::jsonb,
      'thursday',  (CASE rec.thu WHEN 'full' THEN wd_full WHEN 'morning' THEN wd_morn WHEN 'evening' THEN wd_eve ELSE wd_off END)::jsonb,
      'friday',    (CASE rec.fri WHEN 'full' THEN wd_full WHEN 'morning' THEN wd_morn WHEN 'evening' THEN wd_eve ELSE wd_off END)::jsonb,
      'saturday',  (CASE rec.sat WHEN 'full' THEN we_full WHEN 'morning' THEN we_morn WHEN 'evening' THEN we_eve ELSE we_off END)::jsonb,
      'sunday',    (CASE rec.sun WHEN 'full' THEN we_full WHEN 'morning' THEN we_morn WHEN 'evening' THEN we_eve ELSE we_off END)::jsonb
    );

    -- Availability submission for current week AND next 3 weeks
    FOR week_offset IN 0..3 LOOP
      INSERT INTO availability_submissions (id, user_id, workplace_id, week_start, availability_grid, status, submitted_at, reviewed_at, reviewed_by)
      VALUES (gen_random_uuid(), v_uid, v_wp_id, v_week + (week_offset * 7), v_grid, 'approved', NOW(), NOW(), v_mgr_id)
      ON CONFLICT (user_id, week_start) DO UPDATE SET
        availability_grid = EXCLUDED.availability_grid, status = 'approved',
        reviewed_at = NOW(), reviewed_by = v_mgr_id;
    END LOOP;

    -- Mirror to employee_availability
    DELETE FROM employee_availability WHERE user_id = v_uid;

    IF rec.mon != 'off' THEN
      INSERT INTO employee_availability (id, user_id, day_of_week, start_time, end_time, created_at) VALUES
        (gen_random_uuid(), v_uid, 1,
         CASE rec.mon WHEN 'full' THEN '10:00' WHEN 'morning' THEN '10:00' ELSE '16:00' END::TIME,
         CASE rec.mon WHEN 'full' THEN '22:00' WHEN 'morning' THEN '16:00' ELSE '22:00' END::TIME, NOW())
      ON CONFLICT DO NOTHING;
    END IF;
    IF rec.tue != 'off' THEN
      INSERT INTO employee_availability (id, user_id, day_of_week, start_time, end_time, created_at) VALUES
        (gen_random_uuid(), v_uid, 2,
         CASE rec.tue WHEN 'full' THEN '10:00' WHEN 'morning' THEN '10:00' ELSE '16:00' END::TIME,
         CASE rec.tue WHEN 'full' THEN '22:00' WHEN 'morning' THEN '16:00' ELSE '22:00' END::TIME, NOW())
      ON CONFLICT DO NOTHING;
    END IF;
    IF rec.wed != 'off' THEN
      INSERT INTO employee_availability (id, user_id, day_of_week, start_time, end_time, created_at) VALUES
        (gen_random_uuid(), v_uid, 3,
         CASE rec.wed WHEN 'full' THEN '10:00' WHEN 'morning' THEN '10:00' ELSE '16:00' END::TIME,
         CASE rec.wed WHEN 'full' THEN '22:00' WHEN 'morning' THEN '16:00' ELSE '22:00' END::TIME, NOW())
      ON CONFLICT DO NOTHING;
    END IF;
    IF rec.thu != 'off' THEN
      INSERT INTO employee_availability (id, user_id, day_of_week, start_time, end_time, created_at) VALUES
        (gen_random_uuid(), v_uid, 4,
         CASE rec.thu WHEN 'full' THEN '10:00' WHEN 'morning' THEN '10:00' ELSE '16:00' END::TIME,
         CASE rec.thu WHEN 'full' THEN '22:00' WHEN 'morning' THEN '16:00' ELSE '22:00' END::TIME, NOW())
      ON CONFLICT DO NOTHING;
    END IF;
    IF rec.fri != 'off' THEN
      INSERT INTO employee_availability (id, user_id, day_of_week, start_time, end_time, created_at) VALUES
        (gen_random_uuid(), v_uid, 5,
         CASE rec.fri WHEN 'full' THEN '10:00' WHEN 'morning' THEN '10:00' ELSE '16:00' END::TIME,
         CASE rec.fri WHEN 'full' THEN '22:00' WHEN 'morning' THEN '16:00' ELSE '22:00' END::TIME, NOW())
      ON CONFLICT DO NOTHING;
    END IF;
    IF rec.sat != 'off' THEN
      INSERT INTO employee_availability (id, user_id, day_of_week, start_time, end_time, created_at) VALUES
        (gen_random_uuid(), v_uid, 6,
         CASE rec.sat WHEN 'full' THEN '10:00' WHEN 'morning' THEN '10:00' ELSE '17:00' END::TIME,
         CASE rec.sat WHEN 'full' THEN '00:00' WHEN 'morning' THEN '17:00' ELSE '00:00' END::TIME, NOW())
      ON CONFLICT DO NOTHING;
    END IF;
    IF rec.sun != 'off' THEN
      INSERT INTO employee_availability (id, user_id, day_of_week, start_time, end_time, created_at) VALUES
        (gen_random_uuid(), v_uid, 0,
         CASE rec.sun WHEN 'full' THEN '10:00' WHEN 'morning' THEN '10:00' ELSE '17:00' END::TIME,
         CASE rec.sun WHEN 'full' THEN '00:00' WHEN 'morning' THEN '17:00' ELSE '00:00' END::TIME, NOW())
      ON CONFLICT DO NOTHING;
    END IF;

    RAISE NOTICE 'Employee: %', rec.n;
  END LOOP;

  RAISE NOTICE '✓ 19 employees + availability seeded (current week + 3 future weeks)';

  -- ═══════════════════════════════════════════════════════════
  -- Step 2: Seed dev sales data (8 weeks)
  -- ═══════════════════════════════════════════════════════════
  CREATE TEMP TABLE _dev_sales (dow INT, hour INT, sales NUMERIC(12,2)) ON COMMIT DROP;
  INSERT INTO _dev_sales VALUES
    -- Monday (dow=0) — peak day $8,383
    (0,10,127.40),(0,11,429.44),(0,12,598.19),(0,13,441.15),(0,14,581.22),
    (0,15,643.97),(0,16,676.73),(0,17,895.23),(0,18,1110.46),(0,19,972.36),
    (0,20,962.49),(0,21,884.99),(0,22,59.80),
    -- Tuesday (dow=1) — $3,126
    (1,10,3.00),(1,11,57.06),(1,12,167.88),(1,13,283.50),(1,14,282.49),
    (1,15,237.85),(1,16,313.10),(1,17,505.75),(1,18,450.93),(1,19,320.25),
    (1,20,246.83),(1,21,250.59),(1,22,6.99),
    -- Wednesday (dow=2) — $4,033
    (2,10,60.50),(2,11,113.24),(2,12,208.57),(2,13,220.82),(2,14,357.69),
    (2,15,306.18),(2,16,413.23),(2,17,518.50),(2,18,480.37),(2,19,463.93),
    (2,20,357.50),(2,21,294.61),(2,22,162.47),(2,23,75.70),
    -- Thursday (dow=3) — $5,090
    (3,10,33.12),(3,11,256.69),(3,12,341.15),(3,13,183.44),(3,14,308.65),
    (3,15,389.90),(3,16,510.53),(3,17,586.43),(3,18,874.20),(3,19,605.47),
    (3,20,486.48),(3,21,301.49),(3,22,172.32),(3,23,40.48),
    -- Friday (dow=4) — $3,070
    (4,10,27.27),(4,11,248.85),(4,12,232.08),(4,13,117.95),(4,14,110.17),
    (4,15,266.24),(4,16,333.65),(4,17,335.47),(4,18,513.76),(4,19,424.15),
    (4,20,244.75),(4,21,191.68),(4,22,1.99),(4,23,21.55),
    -- Saturday (dow=5) — $3,646
    (5,10,57.46),(5,11,291.38),(5,12,306.81),(5,13,187.59),(5,14,235.09),
    (5,15,239.89),(5,16,323.29),(5,17,483.34),(5,18,490.74),(5,19,451.01),
    (5,20,323.59),(5,21,199.62),(5,22,12.65),(5,23,43.67),
    -- Sunday (dow=6) — $3,266
    (6,10,57.07),(6,11,276.56),(6,12,274.38),(6,13,170.99),(6,14,196.82),
    (6,15,205.53),(6,16,271.95),(6,17,281.39),(6,18,407.32),(6,19,443.91),
    (6,20,456.95),(6,21,199.81),(6,22,22.99);

  FOR week_offset IN -4..3 LOOP
    v_monday := date_trunc('week', CURRENT_DATE)::date + (week_offset * 7);
    FOR v_dow IN 0..6 LOOP
      v_day := v_monday + v_dow;
      INSERT INTO hourly_sales_data
        (workplace_id, sale_date, hour, sales_amount, day_of_week, data_source)
      SELECT v_wp_id, v_day, s.hour, s.sales,
        CASE v_dow WHEN 6 THEN 0 ELSE v_dow + 1 END, 'seed'
      FROM _dev_sales s WHERE s.dow = v_dow
      ON CONFLICT (workplace_id, sale_date, hour) DO UPDATE SET
        sales_amount = EXCLUDED.sales_amount, day_of_week = EXCLUDED.day_of_week, data_source = 'seed';
    END LOOP;
  END LOOP;

  RAISE NOTICE '✓ Sales data seeded (8 weeks centered on today)';
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════';
  RAISE NOTICE '  ALL DONE! Log in and generate a schedule.';
  RAISE NOTICE '═══════════════════════════════════════════════';
END $$;

COMMIT;
