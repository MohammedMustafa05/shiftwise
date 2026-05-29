-- Add employee first-approval completion flag (used by web approvals flow)

ALTER TABLE employee_profiles
  ADD COLUMN IF NOT EXISTS first_approval_completed BOOLEAN NOT NULL DEFAULT false;

