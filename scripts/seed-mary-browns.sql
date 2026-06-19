-- Seed: 19 employees + availability for Mary Browns Chicken
-- Manager: Murtaza Akbari | Week: 2026-06-15 (Mon)
-- Run in Supabase SQL Editor

BEGIN;

DO $$
DECLARE
  v_wp_id UUID;
  v_mgr_id UUID;
  v_uid UUID;
  v_week DATE := '2026-06-15';
  v_grid JSONB;
  rec RECORD;
  -- block JSON snippets
  wd_full   TEXT := '[{"block":"full","startTime":"10:00","endTime":"22:00","label":"Full Day"}]';
  wd_morn   TEXT := '[{"block":"morning","startTime":"10:00","endTime":"16:00","label":"Morning"}]';
  wd_eve    TEXT := '[{"block":"evening","startTime":"16:00","endTime":"22:00","label":"Evening"}]';
  wd_off    TEXT := '[{"block":"off","startTime":"00:00","endTime":"00:00","label":"Day Off"}]';
  we_full   TEXT := '[{"block":"full","startTime":"10:00","endTime":"00:00","label":"Full Day"}]';
  we_morn   TEXT := '[{"block":"morning","startTime":"10:00","endTime":"17:00","label":"Morning"}]';
  we_eve    TEXT := '[{"block":"evening","startTime":"17:00","endTime":"00:00","label":"Evening"}]';
  we_off    TEXT := '[{"block":"off","startTime":"00:00","endTime":"00:00","label":"Day Off"}]';
BEGIN
  SELECT id INTO v_wp_id FROM workplaces WHERE name ILIKE '%mary brown%' LIMIT 1;
  IF v_wp_id IS NULL THEN RAISE EXCEPTION 'Workplace not found'; END IF;

  SELECT id INTO v_mgr_id FROM users WHERE workplace_id = v_wp_id AND role = 'EMPLOYER' LIMIT 1;

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
    -- Create user (bcrypt hash of 'ShiftAgent2026!')
    INSERT INTO users (id, email, password_hash, role, workplace_id, name, created_at, updated_at)
    VALUES (gen_random_uuid(), rec.e,
      '$2b$10$LZpHs8vFRMliJ5G5y8nSxeVqZqGnGJl2Xs1GVHrVhHqR7D1Kq1Wbm',
      'EMPLOYEE', v_wp_id, rec.n, NOW(), NOW())
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_uid;

    -- Create employee profile
    INSERT INTO employee_profiles (id, user_id, workplace_id, role, created_at, updated_at)
    VALUES (gen_random_uuid(), v_uid, v_wp_id, 'STAFF', NOW(), NOW())
    ON CONFLICT (user_id) DO NOTHING;

    -- Build grid: weekdays use wd_* blocks, weekends use we_* blocks
    v_grid := jsonb_build_object(
      'monday',    (CASE rec.mon WHEN 'full' THEN wd_full WHEN 'morning' THEN wd_morn WHEN 'evening' THEN wd_eve ELSE wd_off END)::jsonb,
      'tuesday',   (CASE rec.tue WHEN 'full' THEN wd_full WHEN 'morning' THEN wd_morn WHEN 'evening' THEN wd_eve ELSE wd_off END)::jsonb,
      'wednesday', (CASE rec.wed WHEN 'full' THEN wd_full WHEN 'morning' THEN wd_morn WHEN 'evening' THEN wd_eve ELSE wd_off END)::jsonb,
      'thursday',  (CASE rec.thu WHEN 'full' THEN wd_full WHEN 'morning' THEN wd_morn WHEN 'evening' THEN wd_eve ELSE wd_off END)::jsonb,
      'friday',    (CASE rec.fri WHEN 'full' THEN wd_full WHEN 'morning' THEN wd_morn WHEN 'evening' THEN wd_eve ELSE wd_off END)::jsonb,
      'saturday',  (CASE rec.sat WHEN 'full' THEN we_full WHEN 'morning' THEN we_morn WHEN 'evening' THEN we_eve ELSE we_off END)::jsonb,
      'sunday',    (CASE rec.sun WHEN 'full' THEN we_full WHEN 'morning' THEN we_morn WHEN 'evening' THEN we_eve ELSE we_off END)::jsonb
    );

    -- Availability submission
    INSERT INTO availability_submissions (id, user_id, workplace_id, week_start, availability_grid, status, submitted_at, reviewed_at, reviewed_by)
    VALUES (gen_random_uuid(), v_uid, v_wp_id, v_week, v_grid, 'approved', NOW(), NOW(), v_mgr_id)
    ON CONFLICT (user_id, week_start) DO UPDATE SET
      availability_grid = EXCLUDED.availability_grid, status = 'approved',
      reviewed_at = NOW(), reviewed_by = v_mgr_id;

    -- Mirror to employee_availability
    DELETE FROM employee_availability WHERE user_id = v_uid;

    -- Monday (dow=1, weekday)
    IF rec.mon != 'off' THEN
      INSERT INTO employee_availability (id, user_id, day_of_week, start_time, end_time, created_at) VALUES
        (gen_random_uuid(), v_uid, 1,
         CASE rec.mon WHEN 'full' THEN '10:00' WHEN 'morning' THEN '10:00' ELSE '16:00' END::TIME,
         CASE rec.mon WHEN 'full' THEN '22:00' WHEN 'morning' THEN '16:00' ELSE '22:00' END::TIME, NOW())
      ON CONFLICT DO NOTHING;
    END IF;
    -- Tuesday (dow=2)
    IF rec.tue != 'off' THEN
      INSERT INTO employee_availability (id, user_id, day_of_week, start_time, end_time, created_at) VALUES
        (gen_random_uuid(), v_uid, 2,
         CASE rec.tue WHEN 'full' THEN '10:00' WHEN 'morning' THEN '10:00' ELSE '16:00' END::TIME,
         CASE rec.tue WHEN 'full' THEN '22:00' WHEN 'morning' THEN '16:00' ELSE '22:00' END::TIME, NOW())
      ON CONFLICT DO NOTHING;
    END IF;
    -- Wednesday (dow=3)
    IF rec.wed != 'off' THEN
      INSERT INTO employee_availability (id, user_id, day_of_week, start_time, end_time, created_at) VALUES
        (gen_random_uuid(), v_uid, 3,
         CASE rec.wed WHEN 'full' THEN '10:00' WHEN 'morning' THEN '10:00' ELSE '16:00' END::TIME,
         CASE rec.wed WHEN 'full' THEN '22:00' WHEN 'morning' THEN '16:00' ELSE '22:00' END::TIME, NOW())
      ON CONFLICT DO NOTHING;
    END IF;
    -- Thursday (dow=4)
    IF rec.thu != 'off' THEN
      INSERT INTO employee_availability (id, user_id, day_of_week, start_time, end_time, created_at) VALUES
        (gen_random_uuid(), v_uid, 4,
         CASE rec.thu WHEN 'full' THEN '10:00' WHEN 'morning' THEN '10:00' ELSE '16:00' END::TIME,
         CASE rec.thu WHEN 'full' THEN '22:00' WHEN 'morning' THEN '16:00' ELSE '22:00' END::TIME, NOW())
      ON CONFLICT DO NOTHING;
    END IF;
    -- Friday (dow=5, weekday in our system)
    IF rec.fri != 'off' THEN
      INSERT INTO employee_availability (id, user_id, day_of_week, start_time, end_time, created_at) VALUES
        (gen_random_uuid(), v_uid, 5,
         CASE rec.fri WHEN 'full' THEN '10:00' WHEN 'morning' THEN '10:00' ELSE '16:00' END::TIME,
         CASE rec.fri WHEN 'full' THEN '22:00' WHEN 'morning' THEN '16:00' ELSE '22:00' END::TIME, NOW())
      ON CONFLICT DO NOTHING;
    END IF;
    -- Saturday (dow=6, weekend)
    IF rec.sat != 'off' THEN
      INSERT INTO employee_availability (id, user_id, day_of_week, start_time, end_time, created_at) VALUES
        (gen_random_uuid(), v_uid, 6,
         CASE rec.sat WHEN 'full' THEN '10:00' WHEN 'morning' THEN '10:00' ELSE '17:00' END::TIME,
         CASE rec.sat WHEN 'full' THEN '00:00' WHEN 'morning' THEN '17:00' ELSE '00:00' END::TIME, NOW())
      ON CONFLICT DO NOTHING;
    END IF;
    -- Sunday (dow=0, weekend)
    IF rec.sun != 'off' THEN
      INSERT INTO employee_availability (id, user_id, day_of_week, start_time, end_time, created_at) VALUES
        (gen_random_uuid(), v_uid, 0,
         CASE rec.sun WHEN 'full' THEN '10:00' WHEN 'morning' THEN '10:00' ELSE '17:00' END::TIME,
         CASE rec.sun WHEN 'full' THEN '00:00' WHEN 'morning' THEN '17:00' ELSE '00:00' END::TIME, NOW())
      ON CONFLICT DO NOTHING;
    END IF;

    RAISE NOTICE 'Seeded: %', rec.n;
  END LOOP;

  RAISE NOTICE 'Done! 19 employees seeded for workplace %', v_wp_id;
END $$;

COMMIT;
