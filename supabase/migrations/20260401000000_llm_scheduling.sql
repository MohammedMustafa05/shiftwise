-- LLM scheduling layer: manual-edit overrides, learned manager preferences, generation log.
-- NOTE: no RLS policies here — this app authorizes via JWT (authMiddleware + requireRole),
-- not Supabase auth.uid(), so RLS would never match.

ALTER TABLE schedule_shifts
  ADD COLUMN IF NOT EXISTS is_engine_suggested BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE schedule_shifts
  ADD COLUMN IF NOT EXISTS llm_reasoning TEXT;

-- Reason for every manual edit the manager makes to a generated schedule.
CREATE TABLE IF NOT EXISTS schedule_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID REFERENCES schedules(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES schedule_shifts(id) ON DELETE SET NULL,
  workplace_id UUID NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,
  manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
  override_reason TEXT NOT NULL CHECK (override_reason IN (
    'new_permanent_preference',
    'one_time_exception',
    'event_special_occasion',
    'fixing_ai_mistake'
  )),
  original_employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  new_employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  original_start_time TIME,
  new_start_time TIME,
  original_end_time TIME,
  new_end_time TIME,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Extracted manager preference patterns (learned from new_permanent_preference tags).
CREATE TABLE IF NOT EXISTS manager_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workplace_id UUID NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,
  pattern_type TEXT NOT NULL,
  description TEXT NOT NULL,
  structured_data JSONB NOT NULL DEFAULT '{}',
  confidence_score NUMERIC(3, 2) NOT NULL DEFAULT 0.50,
  times_observed INTEGER NOT NULL DEFAULT 1,
  first_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Each LLM generation attempt and its outcome (feedback loop + cost tracking).
CREATE TABLE IF NOT EXISTS llm_generation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID REFERENCES schedules(id) ON DELETE CASCADE,
  workplace_id UUID NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,
  model_used TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  generation_time_ms INTEGER,
  validation_attempts INTEGER NOT NULL DEFAULT 1,
  hard_constraint_violations_fixed INTEGER NOT NULL DEFAULT 0,
  manager_edits_count INTEGER,
  override_reasons JSONB,
  schedule_quality_score NUMERIC(3, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedule_overrides_workplace ON schedule_overrides(workplace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manager_preferences_workplace ON manager_preferences(workplace_id, is_active, confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_llm_generation_log_schedule ON llm_generation_log(schedule_id);
