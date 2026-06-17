-- LLM provider tracking and AI mistake pattern flag on manager preferences.

ALTER TABLE llm_generation_log
  ADD COLUMN IF NOT EXISTS provider_name TEXT;

ALTER TABLE manager_preferences
  ADD COLUMN IF NOT EXISTS is_mistake_pattern BOOLEAN NOT NULL DEFAULT false;
