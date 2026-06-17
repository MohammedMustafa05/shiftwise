-- Extend hourly_sales_data for Clearview ingestion (dates, DOW, anomalies, source)

ALTER TABLE hourly_sales_data
  ADD COLUMN IF NOT EXISTS day_of_week SMALLINT,
  ADD COLUMN IF NOT EXISTS is_anomaly BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anomaly_reason TEXT,
  ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'cash_sheet',
  ADD COLUMN IF NOT EXISTS transaction_count INTEGER,
  ADD COLUMN IF NOT EXISTS source_file TEXT;

CREATE INDEX IF NOT EXISTS idx_hourly_sales_date_hour
  ON hourly_sales_data (workplace_id, sale_date, hour);

CREATE INDEX IF NOT EXISTS idx_hourly_sales_dow
  ON hourly_sales_data (workplace_id, day_of_week, hour);

CREATE OR REPLACE VIEW hourly_sales_for_training AS
SELECT *
FROM hourly_sales_data
WHERE is_anomaly = false
  AND sale_date IS NOT NULL
  AND day_of_week IS NOT NULL
ORDER BY sale_date, hour;
