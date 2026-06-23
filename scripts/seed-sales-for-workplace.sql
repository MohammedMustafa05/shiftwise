-- Seed dev sales data for ALL workplaces that don't have sales data yet.
-- Run this after creating test accounts to give them the same sales profile
-- as the dev environment (Mary Browns / Clearview data).
--
-- Safe to re-run: uses ON CONFLICT to upsert.

BEGIN;

DO $$
DECLARE
  v_wp RECORD;
  v_monday DATE;
  v_day DATE;
  v_dow INT;
  week_offset INT;
  v_count INT := 0;
BEGIN
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

  FOR v_wp IN SELECT id, name FROM workplaces LOOP
    FOR week_offset IN -4..3 LOOP
      v_monday := date_trunc('week', CURRENT_DATE)::date + (week_offset * 7);
      FOR v_dow IN 0..6 LOOP
        v_day := v_monday + v_dow;
        INSERT INTO hourly_sales_data
          (workplace_id, sale_date, hour, sales_amount, day_of_week, data_source)
        SELECT v_wp.id, v_day, s.hour, s.sales,
          CASE v_dow WHEN 6 THEN 0 ELSE v_dow + 1 END, 'seed'
        FROM _dev_sales s WHERE s.dow = v_dow
        ON CONFLICT (workplace_id, sale_date, hour) DO UPDATE SET
          sales_amount = EXCLUDED.sales_amount, day_of_week = EXCLUDED.day_of_week, data_source = 'seed';
      END LOOP;
    END LOOP;
    v_count := v_count + 1;
    RAISE NOTICE 'Seeded sales for: % (%)', v_wp.name, v_wp.id;
  END LOOP;

  RAISE NOTICE 'Done! Sales seeded for % workplaces (8 weeks each)', v_count;
END $$;

COMMIT;
