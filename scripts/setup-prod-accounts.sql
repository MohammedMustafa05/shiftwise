-- =============================================================================
-- ShiftWise: Production reset — keep TWO accounts, seed both, delete the rest
-- =============================================================================
--
-- KEEPS:
--   1. "Test Mary Browns"  (the one test account)
--   2. "Mary Browns LSL"   (Murtaza Akbari's real account)
--
-- DOES:
--   • Seeds 19 employees + availability + 8 weeks of hourly sales onto BOTH
--     kept workplaces (identical data → identical schedule results).
--   • Copies preferences + operating_hours from "Test Mary Browns" onto
--     "Mary Browns LSL" so Murtaza's account behaves exactly like the test one.
--   • HARD-DELETES every other workplace and user (all dependent rows cascade).
--
-- SAFETY:
--   • Runs in a single transaction. If either kept workplace cannot be
--     positively identified, it RAISES and nothing is changed.
--   • Idempotent — safe to re-run.
--
-- USAGE: paste into Supabase SQL Editor → Run.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_test_id  UUID;
  v_lsl_id   UUID;
  v_mgr_id   UUID;
  v_uid      UUID;
  v_grid     JSONB;
  rec        RECORD;
  v_wp_id    UUID;

  v_week DATE := date_trunc('week', CURRENT_DATE)::date;

  wd_full TEXT := '[{"block":"full","startTime":"10:00","endTime":"22:00","label":"Full Day"}]';
  wd_morn TEXT := '[{"block":"morning","startTime":"10:00","endTime":"16:00","label":"Morning"}]';
  wd_eve  TEXT := '[{"block":"evening","startTime":"16:00","endTime":"22:00","label":"Evening"}]';
  wd_off  TEXT := '[{"block":"off","startTime":"00:00","endTime":"00:00","label":"Day Off"}]';
  we_full TEXT := '[{"block":"full","startTime":"10:00","endTime":"00:00","label":"Full Day"}]';
  we_morn TEXT := '[{"block":"morning","startTime":"10:00","endTime":"17:00","label":"Morning"}]';
  we_eve  TEXT := '[{"block":"evening","startTime":"17:00","endTime":"00:00","label":"Evening"}]';
  we_off  TEXT := '[{"block":"off","startTime":"00:00","endTime":"00:00","label":"Day Off"}]';

  v_monday DATE;
  v_day DATE;
  v_dow INT;
  week_offset INT;
  v_email_suffix TEXT;
  v_deleted INT;
BEGIN
  -- ═══════════════════════════════════════════════════════════
  -- Step 0: Identify the two workplaces to KEEP (abort if unsure)
  -- ═══════════════════════════════════════════════════════════
  SELECT id INTO v_test_id FROM workplaces WHERE name ILIKE '%Test Mary Browns%' ORDER BY created_at LIMIT 1;

  -- Murtaza's account: try by workplace name first, then by his manager name.
  SELECT id INTO v_lsl_id FROM workplaces WHERE name ILIKE '%Mary Browns LSL%' ORDER BY created_at LIMIT 1;
  IF v_lsl_id IS NULL THEN
    SELECT u.workplace_id INTO v_lsl_id
    FROM users u
    WHERE u.role = 'EMPLOYER' AND u.name ILIKE '%murtaza%akbari%'
    ORDER BY u.created_at LIMIT 1;
  END IF;

  IF v_test_id IS NULL THEN
    RAISE EXCEPTION 'ABORT: could not find the test account ("Test Mary Browns"). Nothing changed.';
  END IF;
  IF v_lsl_id IS NULL THEN
    RAISE EXCEPTION 'ABORT: could not find Murtaza''s account ("Mary Browns LSL" / manager "Murtaza Akbari"). Nothing changed.';
  END IF;
  IF v_test_id = v_lsl_id THEN
    RAISE EXCEPTION 'ABORT: both names resolved to the SAME workplace (%). Refusing to proceed.', v_test_id;
  END IF;

  RAISE NOTICE 'KEEP test account : %', v_test_id;
  RAISE NOTICE 'KEEP Murtaza acct : %', v_lsl_id;

  -- ═══════════════════════════════════════════════════════════
  -- Step 1: Seed data templates (employees + sales) — created once
  -- ═══════════════════════════════════════════════════════════
  CREATE TEMP TABLE _emp (
    n TEXT, e_prefix TEXT,
    mon TEXT, tue TEXT, wed TEXT, thu TEXT, fri TEXT, sat TEXT, sun TEXT
  ) ON COMMIT DROP;
  INSERT INTO _emp VALUES
    ('Lisa',        'lisa',        'full','full','full','full','full','full','full'),
    ('Aayan',       'aayan',       'full','full','full','full','full','full','full'),
    ('Mehran',      'mehran',      'full','full','full','full','full','morning','morning'),
    ('Omrah',       'omrah',       'full','full','full','full','full','full','full'),
    ('Rupali',      'rupali',      'full','full','full','full','full','full','full'),
    ('Sakeena',     'sakeena',     'full','full','full','full','full','full','full'),
    ('Aaima',       'aaima',       'full','full','full','full','full','full','full'),
    ('Mubeen',      'mubeen',      'full','full','full','full','full','full','full'),
    ('Abdul Nafay', 'abdulnafay',  'full','full','full','full','full','full','full'),
    ('Hassan',      'hassan',      'full','full','full','full','full','full','full'),
    ('Inayah',      'inayah',      'full','full','full','full','full','full','full'),
    ('Ghazia',      'ghazia',      'full','off','off','off','full','full','full'),
    ('Logan',       'logan',       'full','full','off','full','full','full','full'),
    ('Mehrab',      'mehrab',      'full','full','full','full','full','full','full'),
    ('Shahmeer',    'shahmeer',    'full','full','full','full','full','full','full'),
    ('Sana',        'sana',        'evening','off','off','off','off','full','full'),
    ('Pankaj',      'pankaj',      'off','full','off','full','full','off','off'),
    ('Simran',      'simran',      'full','full','full','full','full','full','full'),
    ('Kazim',       'kazim',       'full','full','full','full','full','full','full');

  CREATE TEMP TABLE _dev_sales (dow INT, hour INT, sales NUMERIC(12,2)) ON COMMIT DROP;
  INSERT INTO _dev_sales VALUES
    (0,10,127.40),(0,11,429.44),(0,12,598.19),(0,13,441.15),(0,14,581.22),
    (0,15,643.97),(0,16,676.73),(0,17,895.23),(0,18,1110.46),(0,19,972.36),
    (0,20,962.49),(0,21,884.99),(0,22,59.80),
    (1,10,3.00),(1,11,57.06),(1,12,167.88),(1,13,283.50),(1,14,282.49),
    (1,15,237.85),(1,16,313.10),(1,17,505.75),(1,18,450.93),(1,19,320.25),
    (1,20,246.83),(1,21,250.59),(1,22,6.99),
    (2,10,60.50),(2,11,113.24),(2,12,208.57),(2,13,220.82),(2,14,357.69),
    (2,15,306.18),(2,16,413.23),(2,17,518.50),(2,18,480.37),(2,19,463.93),
    (2,20,357.50),(2,21,294.61),(2,22,162.47),(2,23,75.70),
    (3,10,33.12),(3,11,256.69),(3,12,341.15),(3,13,183.44),(3,14,308.65),
    (3,15,389.90),(3,16,510.53),(3,17,586.43),(3,18,874.20),(3,19,605.47),
    (3,20,486.48),(3,21,301.49),(3,22,172.32),(3,23,40.48),
    (4,10,27.27),(4,11,248.85),(4,12,232.08),(4,13,117.95),(4,14,110.17),
    (4,15,266.24),(4,16,333.65),(4,17,335.47),(4,18,513.76),(4,19,424.15),
    (4,20,244.75),(4,21,191.68),(4,22,1.99),(4,23,21.55),
    (5,10,57.46),(5,11,291.38),(5,12,306.81),(5,13,187.59),(5,14,235.09),
    (5,15,239.89),(5,16,323.29),(5,17,483.34),(5,18,490.74),(5,19,451.01),
    (5,20,323.59),(5,21,199.62),(5,22,12.65),(5,23,43.67),
    (6,10,57.07),(6,11,276.56),(6,12,274.38),(6,13,170.99),(6,14,196.82),
    (6,15,205.53),(6,16,271.95),(6,17,281.39),(6,18,407.32),(6,19,443.91),
    (6,20,456.95),(6,21,199.81),(6,22,22.99);

  -- ═══════════════════════════════════════════════════════════
  -- Step 2: Seed BOTH kept workplaces identically
  -- ═══════════════════════════════════════════════════════════
  FOREACH v_wp_id IN ARRAY ARRAY[v_test_id, v_lsl_id] LOOP
    SELECT id INTO v_mgr_id FROM users WHERE workplace_id = v_wp_id AND role = 'EMPLOYER' ORDER BY created_at LIMIT 1;
    v_email_suffix := replace(v_wp_id::text, '-', '') || '.local';
    RAISE NOTICE 'Seeding workplace % (manager %)', v_wp_id, v_mgr_id;

    FOR rec IN SELECT * FROM _emp LOOP
      INSERT INTO users (id, email, password_hash, role, workplace_id, name, created_at, updated_at)
      VALUES (gen_random_uuid(), rec.e_prefix || '@' || v_email_suffix,
        '$2b$10$LZpHs8vFRMliJ5G5y8nSxeVqZqGnGJl2Xs1GVHrVhHqR7D1Kq1Wbm',
        'EMPLOYEE', v_wp_id, rec.n, NOW(), NOW())
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, workplace_id = EXCLUDED.workplace_id
      RETURNING id INTO v_uid;

      INSERT INTO employee_profiles (id, user_id, workplace_id, role, created_at, updated_at)
      VALUES (gen_random_uuid(), v_uid, v_wp_id, 'STAFF', NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET workplace_id = EXCLUDED.workplace_id;

      v_grid := jsonb_build_object(
        'monday',    (CASE rec.mon WHEN 'full' THEN wd_full WHEN 'morning' THEN wd_morn WHEN 'evening' THEN wd_eve ELSE wd_off END)::jsonb,
        'tuesday',   (CASE rec.tue WHEN 'full' THEN wd_full WHEN 'morning' THEN wd_morn WHEN 'evening' THEN wd_eve ELSE wd_off END)::jsonb,
        'wednesday', (CASE rec.wed WHEN 'full' THEN wd_full WHEN 'morning' THEN wd_morn WHEN 'evening' THEN wd_eve ELSE wd_off END)::jsonb,
        'thursday',  (CASE rec.thu WHEN 'full' THEN wd_full WHEN 'morning' THEN wd_morn WHEN 'evening' THEN wd_eve ELSE wd_off END)::jsonb,
        'friday',    (CASE rec.fri WHEN 'full' THEN wd_full WHEN 'morning' THEN wd_morn WHEN 'evening' THEN wd_eve ELSE wd_off END)::jsonb,
        'saturday',  (CASE rec.sat WHEN 'full' THEN we_full WHEN 'morning' THEN we_morn WHEN 'evening' THEN we_eve ELSE we_off END)::jsonb,
        'sunday',    (CASE rec.sun WHEN 'full' THEN we_full WHEN 'morning' THEN we_morn WHEN 'evening' THEN we_eve ELSE we_off END)::jsonb
      );

      FOR week_offset IN 0..3 LOOP
        INSERT INTO availability_submissions (id, user_id, workplace_id, week_start, availability_grid, status, submitted_at, reviewed_at, reviewed_by)
        VALUES (gen_random_uuid(), v_uid, v_wp_id, v_week + (week_offset * 7), v_grid, 'approved', NOW(), NOW(), v_mgr_id)
        ON CONFLICT (user_id, week_start) DO UPDATE SET
          availability_grid = EXCLUDED.availability_grid, status = 'approved',
          reviewed_at = NOW(), reviewed_by = v_mgr_id;
      END LOOP;

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
    END LOOP;

    -- Hourly sales: 8 weeks centered on today (-4 .. +3)
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

    RAISE NOTICE '  ✓ 19 employees + availability + 8 weeks sales seeded for %', v_wp_id;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════
  -- Step 3: Copy preferences + operating_hours  test → Murtaza
  -- ═══════════════════════════════════════════════════════════
  UPDATE workplaces lsl
  SET preferences = t.preferences,
      operating_hours = t.operating_hours,
      updated_at = NOW()
  FROM workplaces t
  WHERE lsl.id = v_lsl_id AND t.id = v_test_id;
  RAISE NOTICE '  ✓ Copied preferences + operating_hours from test → Murtaza''s account';

  -- ═══════════════════════════════════════════════════════════
  -- Step 4: HARD DELETE everything else (cascades to all dependents)
  -- ═══════════════════════════════════════════════════════════
  DELETE FROM workplaces WHERE id NOT IN (v_test_id, v_lsl_id);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE '  ✓ Deleted % other workplace(s) and all their data', v_deleted;

  -- Remove any orphan users not attached to a kept workplace.
  DELETE FROM users WHERE workplace_id IS NULL OR workplace_id NOT IN (v_test_id, v_lsl_id);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE '  ✓ Deleted % orphan user(s)', v_deleted;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════';
  RAISE NOTICE '  DONE. Kept: Test Mary Browns + Mary Browns LSL';
  RAISE NOTICE '═══════════════════════════════════════════════';
END $$;

COMMIT;

-- Post-run sanity check (should return exactly two rows):
SELECT w.name,
       (SELECT count(*) FROM users u WHERE u.workplace_id = w.id AND u.role = 'EMPLOYEE') AS employees,
       (SELECT count(*) FROM hourly_sales_data h WHERE h.workplace_id = w.id) AS sales_rows,
       w.preferences ? 'constraints' AS has_prefs
FROM workplaces w
ORDER BY w.name;
