CREATE SCHEMA IF NOT EXISTS "DevOps_SF_Summary";

-- Roles that can be assigned to users.
CREATE TABLE IF NOT EXISTS "DevOps_SF_Summary"."app_roles" (
  role text PRIMARY KEY,
  description text NOT NULL
);

-- Which pages or capabilities each role may use; one row per granted permission.
CREATE TABLE IF NOT EXISTS "DevOps_SF_Summary"."role_permissions" (
  role text NOT NULL REFERENCES "DevOps_SF_Summary"."app_roles" (role) ON UPDATE CASCADE ON DELETE CASCADE,
  permission text NOT NULL,
  PRIMARY KEY (role, permission)
);

-- Application users; only a salted scrypt hash of the password is stored.
CREATE TABLE IF NOT EXISTS "DevOps_SF_Summary"."app_users" (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL REFERENCES "DevOps_SF_Summary"."app_roles" (role) ON UPDATE CASCADE,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_key
  ON "DevOps_SF_Summary"."app_users" (lower(username));

-- Login sessions; only a SHA-256 hash of the bearer token is stored.
CREATE TABLE IF NOT EXISTS "DevOps_SF_Summary"."auth_sessions" (
  token_hash text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES "DevOps_SF_Summary"."app_users" (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx
  ON "DevOps_SF_Summary"."auth_sessions" (expires_at);

INSERT INTO "DevOps_SF_Summary"."app_roles" (role, description) VALUES
  ('admin', 'Full access, including user and role management'),
  ('manager', 'All workspace pages and data import'),
  ('viewer', 'Read-only access to core pages')
ON CONFLICT (role) DO NOTHING;

-- Defaults are seeded once per role so later edits made in Access Management are kept.
INSERT INTO "DevOps_SF_Summary"."role_permissions" (role, permission)
SELECT seed.role, seed.permission
FROM (VALUES
  ('admin', 'cases'), ('admin', 'dashboard'), ('admin', 'risk-summary'), ('admin', 'team-workload'),
  ('admin', 'categories'), ('admin', 'documentation'), ('admin', 'reports'), ('admin', 'monitoring'),
  ('admin', 'live-data'), ('admin', 'access-management'), ('admin', 'data-import'),
  ('manager', 'cases'), ('manager', 'dashboard'), ('manager', 'risk-summary'), ('manager', 'team-workload'),
  ('manager', 'categories'), ('manager', 'documentation'), ('manager', 'reports'), ('manager', 'monitoring'),
  ('manager', 'live-data'), ('manager', 'data-import'),
  ('viewer', 'cases'), ('viewer', 'dashboard'), ('viewer', 'risk-summary'),
  ('viewer', 'documentation'), ('viewer', 'reports')
) AS seed (role, permission)
WHERE NOT EXISTS (
  SELECT 1 FROM "DevOps_SF_Summary"."role_permissions" existing WHERE existing.role = seed.role
);
