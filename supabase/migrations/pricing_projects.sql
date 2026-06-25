CREATE TABLE IF NOT EXISTS pricing_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pricing_project_excludes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_project_id uuid REFERENCES pricing_projects(id) ON DELETE CASCADE,
  item_code text,
  description text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pricing_project_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_project_id uuid REFERENCES pricing_projects(id) ON DELETE CASCADE,
  item_code text,
  description text,
  type text DEFAULT 'excluded_item_found',
  priority text DEFAULT 'high',
  created_at timestamptz DEFAULT now()
);
