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

CREATE TABLE IF NOT EXISTS "DevOps_SF_Summary"."case_insights" (
  "Work Item Type" TEXT,
  "ID" BIGINT PRIMARY KEY,
  "Salesforce ID" TEXT,
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
  ADD COLUMN IF NOT EXISTS "Created Time" TIME WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS "Closed Time" TIME WITHOUT TIME ZONE;

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

DROP TABLE IF EXISTS "DevOps_SF_Summary"."data_refreshes";