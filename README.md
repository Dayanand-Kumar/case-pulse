# CasePulse | Salesforce Case Tracker

An Angular dashboard and Node.js API for importing DevOps work-item exports into local PostgreSQL, filtering them, and exporting the matching rows back to Excel.

## Requirements

- Node.js supported by the installed Angular version (currently 22.22.3+, 24.15.0+, or 26+) and npm
- A PostgreSQL server and a database/user allowed to create and migrate the `DevOps_SF_Summary.case_insights` table

## Configure and run

1. Copy `.env.example` to `.env` and set `PGDATABASE`, `PGUSER`, and `PGPASSWORD` for your local PostgreSQL instance.
2. Run `npm install` from the project root.
3. Run `npm run dev`.
4. Open the URL printed by the Angular dev server (normally `http://localhost:4200`). The dev proxy forwards `/api` to the configured API port, normally 3000. The API initializes the schema on its first database connection.

The application has no login or role checks. Anyone who can reach the API can read and modify data; CORS is not an access control. Restrict both the frontend and API with an approved network boundary or gateway.

`npm run build` produces static files in `dist/case-pulse/browser` and a Node API package in `dist/backend`. The frontend's `api-config.js` can be edited after building to point at a deployed API; leave it empty for the local or same-origin proxy. S3 cannot run the API. See `deployment_steps.txt` for deployment, configuration, and verification. For a single-server EC2 walkthrough, open the **Documentation** tab in the application's left navigation.

The CasePulse dashboard tracks Salesforce cases in the PostgreSQL table `DevOps_SF_Summary.case_insights`. On first API connection after upgrading, the existing `Deployment_Metrics` table is renamed to `case_insights` to preserve its data. The database and API store `Created Date` / `Created Time` and `Closed Date` / `Closed Time` separately; date/time parts are split from workbook timestamps in India Standard Time (IST). CSV and XLSX imports/exports retain the original 14 DevOps workbook headers and order. Import accepts `.csv` and `.xlsx` files whose header row exactly matches all 14 columns. CSV files must have exactly 14 columns per row.

The grid omits Area Path, removes angle-bracketed text from Assigned To, labels priorities 1-4 as Critical / High / Medium / Low (missing priority defaults to Medium), and shows tags as badges with stable colors for each batch. Only records with an exact `External` or `Internal` tag are shown in the grid, summary tiles, and dashboard; the default tag filter is `External`. The **Multi-select** switch beside **Clear all** enables selecting multiple Area Path, tag, and Ownership filters; selected options use OR matching within their filter group. Clear all restores the External default and disables multi-select. Age is the non-negative calendar-day difference between the current IST date and Created Date. Resolution is the elapsed whole days from creation until Closed Date / Closed Time, only for Done or Delivered to PROD items; it is blank if either timestamp is missing.

The **Risk Summary** navigation page presents the case-tracker layout backed by the separate `DevOps_SF_Summary.risk_summary` table. Risk Summary imports, grid results, and exports use the exact ten columns `ID`, `Work Item Type`, `Title`, `Assigned To`, `State`, `Tags`, `Created Date`, `Due Date`, `Closed Date`, and `Area Path`, in that order; the system-managed `lastupdatedon` timestamp is excluded from workbook columns. When the Risks toggle is selected, importing writes to `risk_summary`; otherwise imports write to `case_insights`. Successful imports update `lastupdatedon` in the affected data rows. Selecting an Area Path shows the latest timestamp for that area beside the filter heading. The same system-managed column is present on other non-resource tables; resource tables remain unchanged. If the existing `risk_summary` table does not have exactly those workbook columns in that order, the API startup schema migration drops and recreates it, removing its existing rows. Its tag buttons filter by `ORCA Scan`, `Pentest 2026`, and `ZeroThreat`, independently of the Salesforce Case Tracker's tags; any Risk Summary tag containing `ORCA` (case-insensitive) is classified under `ORCA Scan`. The separate **Dashboard** view includes a monthly case-creation trend, state bars, and a priority doughnut chart. Selecting a tag scopes all charts to matching cases and labels the chart titles with that tag. Priority detail shows each level's filtered count and percentage, plus the combined High/Critical count and share. The Dashboard uses the tracker's current area, tag, state, priority, assignee, and age filters. Dashboard start/end dates filter Created Date inclusively; the monthly trend shows the latest 12 months unless a date range is selected. Use **Print / Save PDF** to print the four charts, one per page, with color, report header/footer, generated date, active filter summary, and a detailed written summary with supporting values for every graph. Choose the browser's Save as PDF destination to download a PDF.

## Filters and export

Area Path buttons filter Accounting, Core, Prescribing, or eP2 (Team 4); Salesforce Case Tracker tag buttons filter External, Internal, Datasync, Code Fix (`DevFixRequired`), Batch1–Batch5, Hospitals, or Pilot Case; Risk Summary tag buttons filter `ORCA Scan`, `Pentest 2026`, or `ZeroThreat`. Ownership filters Developer, QA, App Support, or Unassigned (an empty Assigned To value); and state buttons filter Removed, Done, Delivered to PROD, Refinement, Opened, or Awaiting Implementation. Ownership matches Assigned To using the `DevOps_SF_Summary.resources` table and known account-name variants in `DevOps_SF_Summary.resource_aliases`; its Team values are scoped by selected Area Path (Overall resources remain eligible). QA includes both QA and QA Lead departments. External is the default tag filter in the Salesforce Case Tracker; Risk Summary includes records with any of its risk tags containing `ORCA` (case-insensitive), `Pentest 2026`, or `ZeroThreat` until a specific risk tag is selected. The **Multi-select** switch beside **Clear all** enables multiple Area Path, tag, and Ownership selections; any selected option in a group can match, while different filter groups combine with AND. With multi-select off, choosing a quick filter replaces that group's previous selection. The Salesforce Case Tracker and its Dashboard show only cases containing the exact External or Internal tag; Risk Summary maps any tag containing `ORCA` (case-insensitive) to `ORCA Scan`, and matches `Pentest 2026` and `ZeroThreat` exactly. Tags can also be searched as text beside Assigned To. The Resolved / Closed button matches Removed, Done, Delivered to PROD, and Refinement. Opened excludes Resolved, Closed, Removed, Done, Delivered to PROD, and Refinement. Severity searches the board's `Priority` column because the supplied export has no separate Severity column. Age is calculated from `Created Date` to the current time. `Export view` always downloads the currently filtered rows as an `.xlsx` workbook with the original column names and order.

## API

- `GET /api/health` checks PostgreSQL and initializes the table.
- `GET /api/metrics` accepts `areaPath`, `ageMinDays`, `ageMaxDays`, `tags`, `severity`, `assignedTo`, and `stateFilter` query parameters. Results expose created and closed date/time separately, plus computed `Age` and `Resolution` day counts.
- `POST /api/metrics/import` accepts `{ "records": [...] }` with the exact case workbook columns for the cases dataset, or the nine Risk Summary columns for the `riskSummary` dataset.

The database schema is in `backend/schema.sql`.

## Team workload

The Team workload page supports Tuta Mahesh, Madala Koteswar Rao, and Dayanand Kumar K. Select a member and date to see the activity timeline and totals. Add one activity per time block, selecting a suggested type and entering a short description, start time, and end time. Use a separate `Break` entry for breaks. Activity hours total the non-break entries; break time is shown separately. These are manually logged hours, not an automatic attendance or scheduled-availability calculation. Entries for the same person and date cannot overlap, and time blocks must start and end on the selected day.

Team workload entries persist in `DevOps_SF_Summary.team_activities`. The API provides `GET /api/team-activities?member=...&date=YYYY-MM-DD`, `POST /api/team-activities`, and `DELETE /api/team-activities/:id`.
