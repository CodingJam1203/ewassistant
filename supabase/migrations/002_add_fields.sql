-- Add new columns for the expanded Work Log Form
ALTER TABLE public.work_logs
ADD COLUMN IF NOT EXISTS work_location_type text,
ADD COLUMN IF NOT EXISTS work_location_custom text,
ADD COLUMN IF NOT EXISTS attendance_record_type text,
ADD COLUMN IF NOT EXISTS expected_work_location text;
