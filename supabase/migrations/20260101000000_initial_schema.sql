-- ShiftWise Plan 1 schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE user_role AS ENUM ('EMPLOYER', 'EMPLOYEE');
CREATE TYPE schedule_status AS ENUM ('draft', 'published');
CREATE TYPE payroll_department_format AS ENUM ('EMPLOYEE', 'JOB', 'STORE');

CREATE TABLE workplaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'America/Toronto',
  operating_hours JSONB NOT NULL DEFAULT '{}',
  preferences JSONB NOT NULL DEFAULT '{}',
  clearview_store_code TEXT,
  payroll_department_format payroll_department_format NOT NULL DEFAULT 'EMPLOYEE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL,
  workplace_id UUID REFERENCES workplaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workplace_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workplace_id UUID NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE clearview_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workplace_id UUID NOT NULL UNIQUE REFERENCES workplaces(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  last_sales_sync_at TIMESTAMPTZ,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE employee_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  workplace_id UUID NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'STAFF',
  rush_hour_suitability NUMERIC(3, 2) NOT NULL DEFAULT 0.5,
  performance_level NUMERIC(3, 2) NOT NULL DEFAULT 0.5,
  reliability_score NUMERIC(3, 2) NOT NULL DEFAULT 0.5,
  employee_number TEXT,
  payroll_department TEXT,
  job_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE employee_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, day_of_week, start_time, end_time)
);

CREATE TABLE hourly_sales_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workplace_id UUID NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,
  sale_date DATE NOT NULL,
  hour SMALLINT NOT NULL CHECK (hour >= 0 AND hour <= 23),
  sales_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workplace_id, sale_date, hour)
);

CREATE TABLE schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workplace_id UUID NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  status schedule_status NOT NULL DEFAULT 'draft',
  ml_metadata JSONB NOT NULL DEFAULT '{}',
  clearview_export_path TEXT,
  exported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workplace_id, week_start)
);

CREATE TABLE schedule_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  shift_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  role TEXT NOT NULL,
  location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_workplace ON users(workplace_id);
CREATE INDEX idx_hourly_sales_workplace_date ON hourly_sales_data(workplace_id, sale_date);
CREATE INDEX idx_schedules_workplace ON schedules(workplace_id);
CREATE INDEX idx_schedule_shifts_schedule ON schedule_shifts(schedule_id);
CREATE INDEX idx_employee_availability_user ON employee_availability(user_id);
