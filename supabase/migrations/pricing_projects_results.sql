ALTER TABLE pricing_projects ADD COLUMN IF NOT EXISTS results jsonb;
ALTER TABLE pricing_projects ADD COLUMN IF NOT EXISTS unpriced_file_name text;
