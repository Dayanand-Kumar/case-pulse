require('dotenv').config();

const cors = require('cors');
const express = require('express');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const PORT = Number(process.env.API_PORT || 3000);
const IMPORT_COLUMNS = [
  'Work Item Type',
  'ID',
  'Salesforce ID',
  'Title',
  'Assigned To',
  'State',
  'Priority',
  'Tags',
  'Area Path',
  'Created Date',
  'Comment Count',
  'Related Link Count',
  'Closing Comment',
  'Closed Date',
];
const RISK_SUMMARY_IMPORT_COLUMNS = [
  'ID',
  'Work Item Type',
  'Title',
  'Assigned To',
  'State',
  'Tags',
  'Created Date',
  'Due Date',
  'Closed Date',
  'Area Path',
];
const DATABASE_COLUMNS = IMPORT_COLUMNS.flatMap((column) => (
  column === 'Created Date' || column === 'Closed Date'
    ? [column, column.replace('Date', 'Time')]
    : [column]
));
function importColumnsFor(dataset) {
  return dataset === 'riskSummary' ? RISK_SUMMARY_IMPORT_COLUMNS : IMPORT_COLUMNS;
}
function databaseColumnsFor(dataset) {
  return dataset === 'riskSummary' ? RISK_SUMMARY_IMPORT_COLUMNS : DATABASE_COLUMNS;
}
const METRIC_TABLES = {
  cases: '"DevOps_SF_Summary"."case_insights"',
  riskSummary: '"DevOps_SF_Summary"."risk_summary"',
};
const TEAM_ACTIVITY_TABLE = '"DevOps_SF_Summary"."team_activities"';
const RESOURCE_TABLE = '"DevOps_SF_Summary"."resources"';
const TEAM_MEMBERS = ['Tuta Mahesh', 'Madala Koteswar Rao', 'Dayanand Kumar K.'];
const ACTIVITY_TYPES = [
  'Case analysis',
  'Development / fix',
  'Testing / validation',
  'Code review',
  'Team meeting',
  'Documentation',
  'Support',
  'Break',
  'Other',
];
function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return year > 0 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
const ssl = process.env.PGSSL === 'true'
  ? {
      rejectUnauthorized: true,
      ...(process.env.PGSSLROOTCERT
        ? { ca: fsSync.readFileSync(path.resolve(process.cwd(), process.env.PGSSLROOTCERT), 'utf8') }
        : {}),
    }
  : undefined;
const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'postgres',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD,
  ssl,
});
const app = express();
let schemaReady = false;
let schemaPromise;

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:4200' }));
app.use(express.json({ limit: '15mb' }));

async function ensureSchema() {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8')
      .then((schema) => pool.query(schema))
      .then(() => { schemaReady = true; })
      .finally(() => { schemaPromise = undefined; });
  }
  await schemaPromise;
}

function databaseErrorMessage(error) {
  if (error.code === '28P01' || /password authentication failed/i.test(error.message)) {
    return 'PostgreSQL rejected the password for this user. Verify or reset the postgres password, then set PGPASSWORD in .env.';
  }
  if (/SASL|password must be a string/i.test(error.message)) {
    return 'PostgreSQL requires a password. Set PGPASSWORD in your local .env file.';
  }
  if (error.code === '3D000') {
    return 'The configured PostgreSQL database does not exist. Set PGDATABASE to an existing database.';
  }
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return 'Could not reach PostgreSQL. Check that the service is running and PGHOST/PGPORT are correct.';
  }
  if (error.code === '42501') {
    return 'The PostgreSQL user lacks permission to create or access the DevOps_SF_Summary case_insights, risk_summary, team_activities, or resources tables.';
  }
  return 'Could not connect to PostgreSQL. Check PGHOST, PGPORT, PGDATABASE, PGUSER, and PGPASSWORD in .env.';
}

function metricTable(dataset) {
  if (dataset === undefined || dataset === 'cases') return METRIC_TABLES.cases;
  if (dataset === 'riskSummary') return METRIC_TABLES.riskSummary;
  throw new Error('Dataset must be cases or riskSummary.');
}

function addTextFilter(conditions, values, column, value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return;
  values.push(text);
  conditions.push(`"${column}" ILIKE '%' || $${values.length} || '%'`);
}

function addAgeFilter(conditions, values, value, operator) {
  if (value === undefined || value === '') return;
  const age = Number(value);
  if (!Number.isInteger(age) || age < 0 || age > 36500) {
    throw new Error('Age filters must be whole numbers between 0 and 36500 days.');
  }
  values.push(age);
  conditions.push(`(timezone('Asia/Kolkata', now())::date - "Created Date") ${operator} $${values.length}`);
}

function priorityExpression() {
  return `CASE
    WHEN "Priority" IS NULL OR btrim("Priority") = '' THEN 'Medium'
    WHEN btrim("Priority") = '1' THEN '1 - Critical'
    WHEN btrim("Priority") = '2' THEN '2 - High'
    WHEN btrim("Priority") = '3' THEN '3 - Medium'
    WHEN btrim("Priority") = '4' THEN '4 - Low'
    ELSE "Priority"
  END`;
}

function metricSelectExpressions(dataset) {
  return databaseColumnsFor(dataset).map((column) => (
    column === 'Priority'
      ? `${priorityExpression()} AS "Priority"`
      : column === 'Created Date' || column === 'Closed Date' || column === 'Due Date'
        ? `"${column}"::text AS "${column}"`
        : `"${column}"`
  ));
}

function addStateFilter(conditions, value) {
  if (typeof value !== 'string' || !value.trim()) return;
  const state = value.trim();
  if (state === 'resolved') {
    conditions.push(`lower(trim("State")) IN ('removed', 'done', 'delivered to prod', 'refinement')`);
  } else if (state === 'opened') {
    conditions.push(`lower(trim("State")) NOT IN ('resolved', 'closed', 'removed', 'done', 'delivered to prod', 'refinement')`);
  } else if (state === 'awaitingImplementation') {
    conditions.push(`lower(trim("State")) = 'awaiting implementation'`);
  } else {
    throw new Error('State filter must be resolved, opened, or awaitingImplementation.');
  }
}

function buildFilters(query, dataset) {
  const values = [];
  const conditions = [];
  const areaPaths = typeof query.areaPath === 'string'
    ? query.areaPath.split(',').map((areaPath) => areaPath.trim()).filter(Boolean)
    : [];
  if (areaPaths.length === 1) {
    addTextFilter(conditions, values, 'Area Path', areaPaths[0]);
  } else if (areaPaths.length > 1) {
    const areaConditions = areaPaths.map((areaPath) => {
      values.push(areaPath);
      return `"Area Path" ILIKE '%' || $${values.length} || '%'`;
    });
    conditions.push(`(${areaConditions.join(' OR ')})`);
  }
  if (dataset !== 'riskSummary') {
    addAgeFilter(conditions, values, query.ageMinDays, '>=');
    addAgeFilter(conditions, values, query.ageMaxDays, '<=');
  }
  addTextFilter(conditions, values, 'Tags', query.tags);
  const severity = typeof query.severity === 'string' ? query.severity.trim() : '';
  if (severity && dataset !== 'riskSummary') {
    values.push(severity);
    conditions.push(`${priorityExpression()} ILIKE '%' || $${values.length} || '%'`);
  }
  addTextFilter(conditions, values, 'Assigned To', query.assignedTo);
  addStateFilter(conditions, query.stateFilter);
  return { values, where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '' };
}

app.get('/api/health', async (_request, response) => {
  try {
    await ensureSchema();
    await pool.query('SELECT 1');
    response.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    response.status(503).json({ status: 'error', database: 'disconnected', error: databaseErrorMessage(error) });
  }
});

app.get('/api/metrics', async (request, response) => {
  try {
    await ensureSchema();
    const dataset = request.query.dataset === 'riskSummary' ? 'riskSummary' : 'cases';
    const table = metricTable(dataset);
    const { values, where } = buildFilters(request.query, dataset);
    const ageExpression = dataset === 'riskSummary'
      ? `CASE WHEN "Created Date" IS NOT NULL THEN GREATEST(0, timezone('Asia/Kolkata', now())::date - "Created Date")::integer ELSE NULL END`
      : `GREATEST(0, timezone('Asia/Kolkata', now())::date - "Created Date")::integer`;
    const resolutionExpression = dataset === 'riskSummary'
      ? `CASE WHEN lower(trim("State")) IN ('done', 'delivered to prod') AND "Created Date" IS NOT NULL AND "Closed Date" IS NOT NULL THEN GREATEST(0, ("Closed Date" - "Created Date"))::integer ELSE NULL END`
      : `CASE WHEN lower(trim("State")) IN ('done', 'delivered to prod') AND "Created Date" IS NOT NULL AND "Created Time" IS NOT NULL AND "Closed Date" IS NOT NULL AND "Closed Time" IS NOT NULL THEN GREATEST(0, floor(extract(epoch FROM (("Closed Date" + "Closed Time") - ("Created Date" + "Created Time"))) / 86400))::integer ELSE NULL END`;
    const result = await pool.query(`SELECT ${metricSelectExpressions(dataset).join(', ')}, ${ageExpression} AS "Age", ${resolutionExpression} AS "Resolution" FROM ${table} ${where} ORDER BY "Created Date" DESC NULLS LAST, "ID" DESC`, values);
    const refreshes = await pool.query(
      `SELECT "Area Path", max(lastupdatedon) AS lastupdatedon FROM ${table} GROUP BY "Area Path"`,
    );
    const lastDataRefreshByArea = Object.fromEntries(
      refreshes.rows.map((row) => [row['Area Path'], row.lastupdatedon]),
    );
    response.json({ items: result.rows, total: result.rowCount, lastDataRefreshByArea });
  } catch (error) {
    const status = error.message.startsWith('Age filters') || error.message.startsWith('State filter') || error.message.startsWith('Dataset must') ? 400 : 503;
    response.status(status).json({ error: status === 400 ? error.message : databaseErrorMessage(error) });
  }
});

app.get('/api/resources', async (_request, response) => {
  try {
    await ensureSchema();
    const result = await pool.query(
      `SELECT resource."Resource_Name", resource."Department", resource."Team", COALESCE(array_agg(alias."Alias") FILTER (WHERE alias."Alias" IS NOT NULL), ARRAY[]::text[]) AS "Aliases" FROM ${RESOURCE_TABLE} AS resource LEFT JOIN "DevOps_SF_Summary"."resource_aliases" AS alias USING ("Resource_Name") GROUP BY resource."Resource_Name", resource."Department", resource."Team" ORDER BY resource."Resource_Name"`,
    );
    response.json({ items: result.rows });
  } catch (error) {
    response.status(503).json({ error: databaseErrorMessage(error) });
  }
});

app.get('/api/team-activities', async (request, response) => {
  const { member, date } = request.query;
  if (typeof member !== 'string' || !TEAM_MEMBERS.includes(member)) {
    return response.status(400).json({ error: 'Select a valid team member.' });
  }
  if (!isValidDate(date)) {
    return response.status(400).json({ error: 'Provide an activity date in YYYY-MM-DD format.' });
  }
  try {
    await ensureSchema();
    const result = await pool.query(
      `SELECT "ID", "Team Member", "Activity Date"::text AS "Activity Date", "Activity Type", "Details", "Start Time"::text AS "Start Time", "End Time"::text AS "End Time", floor(extract(epoch FROM ("End Time" - "Start Time")) / 60)::integer AS "Duration Minutes" FROM ${TEAM_ACTIVITY_TABLE} WHERE "Team Member" = $1 AND "Activity Date" = $2::date ORDER BY "Start Time", "ID"`,
      [member, date],
    );
    response.json({ items: result.rows });
  } catch (error) {
    response.status(503).json({ error: databaseErrorMessage(error) });
  }
});

app.post('/api/team-activities', async (request, response) => {
  const { member, date, activityType, details, startTime, endTime } = request.body || {};
  if (typeof member !== 'string' || !TEAM_MEMBERS.includes(member)) {
    return response.status(400).json({ error: 'Select a valid team member.' });
  }
  if (!isValidDate(date)) {
    return response.status(400).json({ error: 'Provide an activity date in YYYY-MM-DD format.' });
  }
  if (typeof activityType !== 'string' || !ACTIVITY_TYPES.includes(activityType)) {
    return response.status(400).json({ error: 'Select a valid activity type.' });
  }
  if (typeof details !== 'string' || !details.trim() || details.trim().length > 500) {
    return response.status(400).json({ error: 'Activity details are required and must be 500 characters or fewer.' });
  }
  const validTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!validTime(startTime) || !validTime(endTime) || startTime >= endTime) {
    return response.status(400).json({ error: 'Enter a valid same-day time range with the end after the start.' });
  }
  let client;
  try {
    await ensureSchema();
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${member}:${date}`]);
    const overlap = await client.query(
      `SELECT 1 FROM ${TEAM_ACTIVITY_TABLE} WHERE "Team Member" = $1 AND "Activity Date" = $2::date AND "Start Time" < $4::time AND "End Time" > $3::time LIMIT 1`,
      [member, date, startTime, endTime],
    );
    if (overlap.rowCount) {
      await client.query('ROLLBACK');
      return response.status(409).json({ error: 'This time range overlaps an activity already logged for this team member.' });
    }
    const result = await client.query(
      `INSERT INTO ${TEAM_ACTIVITY_TABLE} ("Team Member", "Activity Date", "Activity Type", "Details", "Start Time", "End Time") VALUES ($1, $2::date, $3, $4, $5::time, $6::time) RETURNING "ID", "Team Member", "Activity Date"::text AS "Activity Date", "Activity Type", "Details", "Start Time"::text AS "Start Time", "End Time"::text AS "End Time", floor(extract(epoch FROM ("End Time" - "Start Time")) / 60)::integer AS "Duration Minutes"`,
      [member, date, activityType, details.trim(), startTime, endTime],
    );
    await client.query('COMMIT');
    response.status(201).json(result.rows[0]);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    response.status(503).json({ error: databaseErrorMessage(error) });
  } finally {
    if (client) client.release();
  }
});

app.delete('/api/team-activities/:id', async (request, response) => {
  if (!/^\d+$/.test(request.params.id)) {
    return response.status(400).json({ error: 'Activity ID must be numeric.' });
  }
  try {
    await ensureSchema();
    const result = await pool.query(`DELETE FROM ${TEAM_ACTIVITY_TABLE} WHERE "ID" = $1 RETURNING "ID"`, [request.params.id]);
    if (!result.rowCount) return response.status(404).json({ error: 'Activity entry was not found.' });
    response.status(204).end();
  } catch (error) {
    response.status(503).json({ error: databaseErrorMessage(error) });
  }
});

app.post('/api/metrics/import', async (request, response) => {
  const records = request.body?.records;
  let table;
  try {
    table = metricTable(request.body?.dataset);
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }
  if (!Array.isArray(records) || records.length === 0) {
    return response.status(400).json({ error: 'Provide at least one workbook row in the records array.' });
  }
  if (records.length > 20000) {
    return response.status(413).json({ error: 'A workbook can contain at most 20,000 rows per import.' });
  }
  const expectedColumns = importColumnsFor(request.body?.dataset);
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== 'object' || expectedColumns.some((column) => !Object.hasOwn(record, column))) {
      const description = request.body?.dataset === 'riskSummary' ? 'risk summary' : 'DevOps';
      return response.status(400).json({ error: `Row ${index + 2} does not contain all required ${description} columns.` });
    }
    if (!/^\d+$/.test(String(record.ID ?? ''))) {
      return response.status(400).json({ error: `Row ${index + 2} must have a numeric ID.` });
    }
    if (request.body?.dataset !== 'riskSummary') {
      for (const column of ['Comment Count', 'Related Link Count']) {
        const value = record[column];
        if (value !== null && value !== '' && (!Number.isInteger(Number(value)) || Number(value) < 0)) {
          return response.status(400).json({ error: `Row ${index + 2} has an invalid ${column}.` });
        }
      }
    }
  }

  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    return response.status(503).json({ error: databaseErrorMessage(error) });
  }
  try {
    await ensureSchema();
    await client.query('BEGIN');
    const dataset = request.body?.dataset === 'riskSummary' ? 'riskSummary' : 'cases';
    const tableColumns = databaseColumnsFor(dataset);
    const importColumns = importColumnsFor(dataset);
    const columnSql = [...tableColumns.map((column) => `"${column}"`), 'lastupdatedon'].join(', ');
    const updateSql = [
      ...tableColumns.filter((column) => column !== 'ID').map((column) => `"${column}" = EXCLUDED."${column}"`),
      'lastupdatedon = statement_timestamp()',
    ].join(', ');
    for (let start = 0; start < records.length; start += 1000) {
      const batch = records.slice(start, start + 1000);
      const values = [];
      const tuples = batch.map((record) => {
        const placeholders = importColumns.flatMap((column) => {
          const value = record[column];
          values.push(value === '' ? null : value);
          const parameter = `$${values.length}`;
          if (dataset === 'riskSummary' || column !== 'Closed Date' && column !== 'Created Date') return [parameter];
          const timestamp = `CASE WHEN ${parameter}::text IS NULL THEN NULL WHEN ${parameter}::text ~* '(Z|[+-][0-9]{2}:?[0-9]{2})$' THEN timezone('Asia/Kolkata', ${parameter}::timestamptz) ELSE ${parameter}::timestamp END`;
          return [`(${timestamp})::date`, `(${timestamp})::time`];
        });
        return `(${[...placeholders, 'statement_timestamp()'].join(', ')})`;
      });
      await client.query(`INSERT INTO ${table} (${columnSql}) VALUES ${tuples.join(', ')} ON CONFLICT ("ID") DO UPDATE SET ${updateSql}`, values);
    }
    await client.query('COMMIT');
    response.json({ imported: records.length });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    response.status(400).json({ error: `Import failed: ${error.message}` });
  } finally {
    client.release();
  }
});

app.listen(PORT, () => console.log(`DevOps metrics API listening on http://localhost:${PORT}`));