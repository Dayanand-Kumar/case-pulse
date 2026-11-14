CREATE SCHEMA IF NOT EXISTS "DevOps_SF_Summary";

DO $rename_table$
BEGIN
  IF to_regclass('"DevOps_SF_Summary"."Deployment_Metrics"') IS NOT NULL
    AND to_regclass('"DevOps_SF_Summary"."case_insights"') IS NOT NULL THEN
    RAISE EXCEPTION 'Both Deployment_Metrics and case_insights exist in DevOps_SF_Summary; resolve the table data before migration.';
  ELSIF to_regclass('"DevOps_SF_Summary"."Deployment_Metrics"') IS NOT NULL THEN
    ALTER TABLE "DevOps_SF_Summary"."Deployment_Metrics" RENAME TO case_insights;
  END IF;
END
$rename_table$;

DO $rebuild_case_insights$
DECLARE
  site_id_position INTEGER;
BEGIN
  IF to_regclass('"DevOps_SF_Summary"."case_insights"') IS NOT NULL THEN
    ALTER TABLE "DevOps_SF_Summary"."case_insights"
      ADD COLUMN IF NOT EXISTS "Site ID" TEXT,
      ADD COLUMN IF NOT EXISTS "Created Time" TIME WITHOUT TIME ZONE,
      ADD COLUMN IF NOT EXISTS "Closed Time" TIME WITHOUT TIME ZONE,
      ADD COLUMN IF NOT EXISTS lastupdatedon TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp();

    SELECT ordinal_position INTO site_id_position
    FROM information_schema.columns
    WHERE table_schema = 'DevOps_SF_Summary'
      AND table_name = 'case_insights'
      AND column_name = 'Site ID';

    IF site_id_position <> 4 THEN
      CREATE TABLE "DevOps_SF_Summary"."case_insights_recreated" (
        "Work Item Type" TEXT,
        "ID" BIGINT PRIMARY KEY,
        "Salesforce ID" TEXT,
        "Site ID" TEXT,
        "Title" TEXT,
        "Assigned To" TEXT,
        "State" TEXT,
        "Priority" TEXT,
        "Tags" TEXT,
        "Area Path" TEXT,
        "Created Date" DATE,
        "Created Time" TIME WITHOUT TIME ZONE,
        "Comment Count" INTEGER,
        "Related Link Count" INTEGER,
        "Closing Comment" TEXT,
        "Closed Date" DATE,
        "Closed Time" TIME WITHOUT TIME ZONE,
        lastupdatedon TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
      );

      INSERT INTO "DevOps_SF_Summary"."case_insights_recreated" (
        "Work Item Type", "ID", "Salesforce ID", "Site ID", "Title", "Assigned To", "State", "Priority", "Tags", "Area Path",
        "Created Date", "Created Time", "Comment Count", "Related Link Count", "Closing Comment", "Closed Date", "Closed Time", lastupdatedon
      )
      SELECT "Work Item Type", "ID", "Salesforce ID", "Site ID", "Title", "Assigned To", "State", "Priority", "Tags", "Area Path",
             "Created Date", "Created Time", "Comment Count", "Related Link Count", "Closing Comment", "Closed Date", "Closed Time", lastupdatedon
      FROM "DevOps_SF_Summary"."case_insights";

      DROP TABLE "DevOps_SF_Summary"."case_insights";
      ALTER TABLE "DevOps_SF_Summary"."case_insights_recreated" RENAME TO "case_insights";
    END IF;
  END IF;
END
$rebuild_case_insights$;
CREATE TABLE IF NOT EXISTS "DevOps_SF_Summary"."case_insights" (
  "Work Item Type" TEXT,
  "ID" BIGINT PRIMARY KEY,
  "Salesforce ID" TEXT,
  "Site ID" TEXT,
  "Title" TEXT,
  "Assigned To" TEXT,
  "State" TEXT,
  "Priority" TEXT,
  "Tags" TEXT,
  "Area Path" TEXT,
  "Created Date" DATE,
  "Created Time" TIME WITHOUT TIME ZONE,
  "Comment Count" INTEGER,
  "Related Link Count" INTEGER,
  "Closing Comment" TEXT,
  "Closed Date" DATE
);

CREATE TABLE IF NOT EXISTS "DevOps_SF_Summary"."team_activities" (
  "ID" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Team Member" TEXT NOT NULL CHECK ("Team Member" IN ('Tuta Mahesh', 'Madala Koteswar Rao', 'Dayanand Kumar K.')),
  "Activity Date" DATE NOT NULL,
  "Activity Type" TEXT NOT NULL CHECK ("Activity Type" IN ('Case analysis', 'Development / fix', 'Testing / validation', 'Code review', 'Team meeting', 'Documentation', 'Support', 'Break', 'Other')),
  "Details" TEXT NOT NULL CHECK (length(btrim("Details")) BETWEEN 1 AND 500),
  "Start Time" TIME WITHOUT TIME ZONE NOT NULL,
  "End Time" TIME WITHOUT TIME ZONE NOT NULL,
  "Created At" TIMESTAMPTZ NOT NULL DEFAULT now(),
  lastupdatedon TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CHECK ("End Time" > "Start Time")
);

CREATE INDEX IF NOT EXISTS team_activities_member_date_idx
  ON "DevOps_SF_Summary"."team_activities" ("Team Member", "Activity Date", "Start Time");

CREATE TABLE IF NOT EXISTS "DevOps_SF_Summary"."resources" (
  "Resource_Name" TEXT PRIMARY KEY,
  "Department" TEXT NOT NULL,
  "Team" TEXT NOT NULL
);

INSERT INTO "DevOps_SF_Summary"."resources" ("Resource_Name", "Department", "Team")
VALUES
  ('Aditya Thummala', 'Architect', 'Core'),
  ('Abrar Ahmed', 'Architect', 'Accounting'),
  ('Siva Chava', 'Lead', 'Core'),
  ('Santhosh Kumar Akula', 'Developer', 'Core'),
  ('Vijaya Nerusu', 'Developer', 'Accounting'),
  ('Dayanand Kumar K', 'App Support', 'Overall'),
  ('Madala Koteswar Rao', 'App Support', 'Core'),
  ('Tuta mahesh', 'App Support', 'Accounting'),
  ('Rohit', 'QA Lead', 'Core'),
  ('Govinda', 'QA Lead', 'Accounting'),
  ('Anil', 'Developer', 'Team 4'),
  ('Anand Kumar Nattar', 'QA', 'Team 4'),
  ('Janardhan', 'Lead', 'Prescribing'),
  ('Anil Cherukupalli', 'Developer', 'Prescribing')
ON CONFLICT ("Resource_Name") DO UPDATE
SET "Department" = EXCLUDED."Department",
    "Team" = EXCLUDED."Team";

CREATE INDEX IF NOT EXISTS resources_department_team_idx
  ON "DevOps_SF_Summary"."resources" ("Department", "Team");

CREATE TABLE IF NOT EXISTS "DevOps_SF_Summary"."resource_aliases" (
  "Alias" TEXT PRIMARY KEY,
  "Resource_Name" TEXT NOT NULL REFERENCES "DevOps_SF_Summary"."resources" ("Resource_Name") ON UPDATE CASCADE ON DELETE CASCADE
);

INSERT INTO "DevOps_SF_Summary"."resource_aliases" ("Alias", "Resource_Name")
VALUES
  ('Anandhakumar Nattar', 'Anand Kumar Nattar'),
  ('Dayanand Kumar Kasagala', 'Dayanand Kumar K'),
  ('Govinda Singh', 'Govinda'),
  ('Rohit Sabarwal', 'Rohit'),
  ('Tuta mahesh kumar', 'Tuta mahesh')
ON CONFLICT ("Alias") DO UPDATE
SET "Resource_Name" = EXCLUDED."Resource_Name";

ALTER TABLE "DevOps_SF_Summary"."case_insights"
  ADD COLUMN IF NOT EXISTS "Site ID" TEXT,
  ADD COLUMN IF NOT EXISTS "Created Time" TIME WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS "Closed Time" TIME WITHOUT TIME ZONE;

CREATE OR REPLACE FUNCTION "DevOps_SF_Summary".derive_case_site_id()
RETURNS trigger
LANGUAGE plpgsql
AS $derive_site_id$
BEGIN
  IF NEW."Title" IS NULL OR position('|' IN NEW."Title") = 0 THEN
    NEW."Site ID" := NULL;
  ELSE
    NEW."Site ID" := NULLIF(btrim(regexp_replace(NEW."Title", '^.*\|', '')), '');
    IF NEW."Site ID" IS NULL OR NEW."Site ID" !~* '^HC[A-Z0-9]+$' THEN
      NEW."Site ID" := NULL;
    ELSE
      NEW."Site ID" := upper(NEW."Site ID");
    END IF;
  END IF;
  RETURN NEW;
END
$derive_site_id$;

DROP TRIGGER IF EXISTS case_insights_site_id_from_title
  ON "DevOps_SF_Summary"."case_insights";
CREATE TRIGGER case_insights_site_id_from_title
  BEFORE INSERT OR UPDATE OF "Title" ON "DevOps_SF_Summary"."case_insights"
  FOR EACH ROW
  EXECUTE FUNCTION "DevOps_SF_Summary".derive_case_site_id();
UPDATE "DevOps_SF_Summary"."case_insights"
SET "Site ID" = NULLIF(btrim(regexp_replace("Title", '^.*\|', '')), '')
WHERE position('|' IN COALESCE("Title", '')) > 0
  AND NULLIF(btrim(regexp_replace("Title", '^.*\|', '')), '') IS NOT NULL;
DO $migration$
DECLARE
  created_date_type TEXT;
  closed_date_type TEXT;
BEGIN
  SELECT data_type INTO created_date_type
  FROM information_schema.columns
  WHERE table_schema = 'DevOps_SF_Summary'
    AND table_name = 'case_insights'
    AND column_name = 'Created Date';

  IF created_date_type = 'timestamp with time zone' THEN
    UPDATE "DevOps_SF_Summary"."case_insights"
    SET "Created Time" = (timezone('Asia/Kolkata', "Created Date"))::TIME
    WHERE "Created Date" IS NOT NULL AND "Created Time" IS NULL;

    ALTER TABLE "DevOps_SF_Summary"."case_insights"
      ALTER COLUMN "Created Date" TYPE DATE
      USING (timezone('Asia/Kolkata', "Created Date"))::DATE;
  ELSIF created_date_type = 'timestamp without time zone' THEN
    UPDATE "DevOps_SF_Summary"."case_insights"
    SET "Created Time" = "Created Date"::TIME
    WHERE "Created Date" IS NOT NULL AND "Created Time" IS NULL;

    ALTER TABLE "DevOps_SF_Summary"."case_insights"
      ALTER COLUMN "Created Date" TYPE DATE
      USING "Created Date"::DATE;
  END IF;

  SELECT data_type INTO closed_date_type
  FROM information_schema.columns
  WHERE table_schema = 'DevOps_SF_Summary'
    AND table_name = 'case_insights'
    AND column_name = 'Closed Date';

  IF closed_date_type = 'timestamp with time zone' THEN
    UPDATE "DevOps_SF_Summary"."case_insights"
    SET "Closed Time" = (timezone('Asia/Kolkata', "Closed Date"))::TIME
    WHERE "Closed Date" IS NOT NULL AND "Closed Time" IS NULL;

    ALTER TABLE "DevOps_SF_Summary"."case_insights"
      ALTER COLUMN "Closed Date" TYPE DATE
      USING (timezone('Asia/Kolkata', "Closed Date"))::DATE;
  ELSIF closed_date_type = 'timestamp without time zone' THEN
    UPDATE "DevOps_SF_Summary"."case_insights"
    SET "Closed Time" = "Closed Date"::TIME
    WHERE "Closed Date" IS NOT NULL AND "Closed Time" IS NULL;

    ALTER TABLE "DevOps_SF_Summary"."case_insights"
      ALTER COLUMN "Closed Date" TYPE DATE
      USING "Closed Date"::DATE;
  END IF;
END
$migration$;

DO $risk_summary_schema$
DECLARE
  actual_columns TEXT[];
  expected_columns CONSTANT TEXT[] := ARRAY[
    'ID',
    'Work Item Type',
    'Title',
    'Assigned To',
    'State',
    'Tags',
    'Created Date',
    'Due Date',
    'Closed Date',
    'Area Path'
  ];
BEGIN
  SELECT array_agg(column_name::TEXT ORDER BY ordinal_position) INTO actual_columns
  FROM information_schema.columns
  WHERE table_schema = 'DevOps_SF_Summary'
    AND table_name = 'risk_summary'
    AND column_name <> 'lastupdatedon';

  IF actual_columns IS NOT NULL AND actual_columns IS DISTINCT FROM expected_columns THEN
    DROP TABLE "DevOps_SF_Summary"."risk_summary";
  END IF;

  CREATE TABLE IF NOT EXISTS "DevOps_SF_Summary"."risk_summary" (
    "ID" BIGINT PRIMARY KEY,
    "Work Item Type" TEXT,
    "Title" TEXT,
    "Assigned To" TEXT,
    "State" TEXT,
    "Tags" TEXT,
    "Created Date" DATE,
    "Due Date" DATE,
    "Closed Date" DATE,
    "Area Path" TEXT,
    lastupdatedon TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
  );
END
$risk_summary_schema$;

ALTER TABLE "DevOps_SF_Summary"."case_insights"
  ADD COLUMN IF NOT EXISTS lastupdatedon TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp();
ALTER TABLE "DevOps_SF_Summary"."team_activities"
  ADD COLUMN IF NOT EXISTS lastupdatedon TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp();
ALTER TABLE "DevOps_SF_Summary"."risk_summary"
  ADD COLUMN IF NOT EXISTS lastupdatedon TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp();

CREATE INDEX IF NOT EXISTS case_insights_created_date_id_idx
  ON "DevOps_SF_Summary"."case_insights" ("Created Date" DESC, "ID" DESC);
CREATE INDEX IF NOT EXISTS case_insights_area_refresh_idx
  ON "DevOps_SF_Summary"."case_insights" ("Area Path", lastupdatedon DESC);
CREATE INDEX IF NOT EXISTS case_insights_state_idx
  ON "DevOps_SF_Summary"."case_insights" ((lower(btrim("State"))));
CREATE INDEX IF NOT EXISTS case_insights_assigned_to_idx
  ON "DevOps_SF_Summary"."case_insights" ((lower(btrim("Assigned To"))));
CREATE INDEX IF NOT EXISTS case_insights_salesforce_id_idx
  ON "DevOps_SF_Summary"."case_insights" ((lower(btrim("Salesforce ID"))));
CREATE INDEX IF NOT EXISTS case_insights_site_id_idx
  ON "DevOps_SF_Summary"."case_insights" ((lower(btrim("Site ID"))));

CREATE INDEX IF NOT EXISTS risk_summary_created_date_id_idx
  ON "DevOps_SF_Summary"."risk_summary" ("Created Date" DESC, "ID" DESC);
CREATE INDEX IF NOT EXISTS risk_summary_area_refresh_idx
  ON "DevOps_SF_Summary"."risk_summary" ("Area Path", lastupdatedon DESC);
CREATE INDEX IF NOT EXISTS risk_summary_state_idx
  ON "DevOps_SF_Summary"."risk_summary" ((lower(btrim("State"))));
CREATE INDEX IF NOT EXISTS risk_summary_assigned_to_idx
  ON "DevOps_SF_Summary"."risk_summary" ((lower(btrim("Assigned To"))));

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS risk_summary_tags_trgm_idx
  ON "DevOps_SF_Summary"."risk_summary" USING gin (lower(COALESCE("Tags", '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS risk_summary_area_path_trgm_idx
  ON "DevOps_SF_Summary"."risk_summary" USING gin (lower(COALESCE("Area Path", '')) gin_trgm_ops);

CREATE OR REPLACE VIEW "DevOps_SF_Summary"."risk_summary_metrics" AS
SELECT "ID", "Work Item Type", "Title", "Assigned To", "State", "Tags",
       "Created Date", "Due Date", "Closed Date", "Area Path", lastupdatedon
FROM "DevOps_SF_Summary"."risk_summary";

DROP TABLE IF EXISTS "DevOps_SF_Summary"."data_refreshes";

CREATE TABLE IF NOT EXISTS "DevOps_SF_Summary"."error_details" (
  id bigserial PRIMARY KEY,
  module text NOT NULL,
  error_date date NOT NULL,
  exact_timestamp timestamp,
  error_details text NOT NULL,
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count >= 0),
  alarm_configured text NOT NULL DEFAULT 'No' CHECK (alarm_configured IN ('Yes', 'No')),
  remarks text,
  severity text,
  environment text,
  status text,
  owner text,
  ticket_id text,
  row_hash text NOT NULL UNIQUE,
  created_on timestamptz NOT NULL DEFAULT statement_timestamp(),
  lastupdatedon timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE INDEX IF NOT EXISTS error_details_module_date_idx
  ON "DevOps_SF_Summary"."error_details" (module, error_date DESC);
CREATE INDEX IF NOT EXISTS error_details_text_idx
  ON "DevOps_SF_Summary"."error_details" (module, lower(btrim(error_details)), error_date);

DROP TABLE IF EXISTS "DevOps_SF_Summary"."team_workload";

CREATE TABLE IF NOT EXISTS "DevOps_SF_Summary"."team_details" (
  id bigserial PRIMARY KEY,
  "Date" date NOT NULL,
  "From" text NOT NULL CHECK ("From" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  "To" text NOT NULL CHECK ("To" ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'),
  "Activity Type" text NOT NULL,
  "What did you work on" text NOT NULL,
  "Resource" text NOT NULL CHECK ("Resource" IN ('Kasagala Dayanand', 'Madala Koteswar Rao', 'Tuta Mahesh Kumar')),
  row_hash text NOT NULL UNIQUE,
  created_on timestamptz NOT NULL DEFAULT statement_timestamp(),
  lastupdatedon timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK ("To" > "From")
);
CREATE INDEX IF NOT EXISTS team_details_resource_date_idx
  ON "DevOps_SF_Summary"."team_details" ("Resource", "Date" DESC, "From");

-- Dummy data for the last 5 days (24 hours per resource per day); only seeded while the table is empty.
INSERT INTO "DevOps_SF_Summary"."team_details" ("Date", "From", "To", "Activity Type", "What did you work on", "Resource", row_hash)
SELECT d::date, b."From", b."To", b."Activity Type", b."What did you work on", b."Resource",
       encode(sha256(convert_to(b."Resource" || '|' || to_char(d, 'YYYY-MM-DD') || '|' || b."From" || '|' || b."To", 'UTF8')), 'hex')
FROM generate_series(current_date - 4, current_date, interval '1 day') AS d
CROSS JOIN (VALUES
  ('00:00', '08:00', 'Off-duty', 'Rest', 'Kasagala Dayanand'),
  ('08:00', '10:00', 'Monitoring', 'Checked FHIR and Diary error dashboards', 'Kasagala Dayanand'),
  ('10:00', '10:15', 'Meeting', 'Daily stand-up', 'Kasagala Dayanand'),
  ('10:15', '12:30', 'Incident Analysis', 'FHIRException MSG_INVALID_ID in GetPatientConditionController', 'Kasagala Dayanand'),
  ('12:30', '13:30', 'Break', 'Lunch', 'Kasagala Dayanand'),
  ('13:30', '16:00', 'Bug Fix', 'Fixed the missing appointment reference check', 'Kasagala Dayanand'),
  ('16:00', '18:00', 'Deployment', 'Release support for Patient module hotfix', 'Kasagala Dayanand'),
  ('18:00', '19:30', 'Monitoring', 'Post-release on-call monitoring', 'Kasagala Dayanand'),
  ('19:30', '24:00', 'Off-duty', 'Rest', 'Kasagala Dayanand'),
  ('00:00', '09:00', 'Off-duty', 'Rest', 'Madala Koteswar Rao'),
  ('09:00', '09:15', 'Meeting', 'Daily stand-up', 'Madala Koteswar Rao'),
  ('09:15', '12:00', 'Incident Analysis', 'Patient record lock timeout analysis', 'Madala Koteswar Rao'),
  ('12:00', '13:00', 'Break', 'Lunch', 'Madala Koteswar Rao'),
  ('13:00', '15:30', 'Bug Fix', 'Correspondence letter template render failure', 'Madala Koteswar Rao'),
  ('15:30', '17:00', 'Testing', 'Regression testing of the fix', 'Madala Koteswar Rao'),
  ('17:00', '18:00', 'Documentation', 'Updated runbook and RCA notes', 'Madala Koteswar Rao'),
  ('18:00', '24:00', 'Off-duty', 'Rest', 'Madala Koteswar Rao'),
  ('00:00', '08:30', 'Off-duty', 'Rest', 'Tuta Mahesh Kumar'),
  ('08:30', '10:30', 'Monitoring', 'Settings and Accounting alarm review', 'Tuta Mahesh Kumar'),
  ('10:30', '10:45', 'Meeting', 'Daily stand-up', 'Tuta Mahesh Kumar'),
  ('10:45', '13:00', 'Bug Fix', 'Practice settings cache refresh failure', 'Tuta Mahesh Kumar'),
  ('13:00', '13:45', 'Break', 'Lunch', 'Tuta Mahesh Kumar'),
  ('13:45', '16:15', 'Incident Analysis', 'Accounting invoice sync timeout', 'Tuta Mahesh Kumar'),
  ('16:15', '18:15', 'Deployment', 'Prescribing module release', 'Tuta Mahesh Kumar'),
  ('18:15', '18:45', 'Documentation', 'Release notes', 'Tuta Mahesh Kumar'),
  ('18:45', '24:00', 'Off-duty', 'Rest', 'Tuta Mahesh Kumar')
) AS b("From", "To", "Activity Type", "What did you work on", "Resource")
WHERE NOT EXISTS (SELECT 1 FROM "DevOps_SF_Summary"."team_details")
ON CONFLICT (row_hash) DO NOTHING;
