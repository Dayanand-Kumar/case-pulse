require('dotenv').config();

const cors = require('cors');
const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { createAuth } = require('./auth');

const PORT = Number(process.env.API_PORT || 3000);
const IMPORT_COLUMNS = [
  'Work Item Type',
  'ID',
  'Salesforce ID',
  'Site ID',
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
  riskSummary: '"DevOps_SF_Summary"."risk_summary_metrics"',
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
const METRICS_CACHE_TTL_MS = 15000;
const RESOURCES_CACHE_TTL_MS = 300000;
const REFRESH_CACHE_TTL_MS = 300000;
const metricsCache = new Map();
let resourcesCache;
const refreshCache = new Map();const LIVE_DATA_AREA_PATH = String.raw`Central Change Portfolio\Practice Management\Core`;
const AZURE_DEVOPS_API_VERSION = '7.1';

function azureDevOpsConfig() {
  return {
    organization: String(process.env.AZURE_DEVOPS_ORGANIZATION || process.env.AZURE_DEVOPS_ORG || '').trim(),
    project: String(process.env.AZURE_DEVOPS_PROJECT || '').trim(),
    pat: String(process.env.AZURE_DEVOPS_PAT || '').trim(),
  };
}

function azureDevOpsErrorMessage(error) {
  if (error?.status === 401 || error?.status === 403) return 'Azure DevOps rejected the configured token. Verify the PAT and its Work Items read permission.';
  if (error?.status === 404) return 'Azure DevOps could not find the configured organization or project.';
  return error?.message || 'Could not load live Azure DevOps data.';
}

async function azureDevOpsRequest(url, config, options = {}) {
  const auth = Buffer.from(`:${config.pat}`).toString('base64');
  const result = await fetch(url, {
    ...options,
    headers: { Accept: 'application/json', Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!result.ok) {
    const error = new Error(`Azure DevOps returned HTTP ${result.status}.`);
    error.status = result.status;
    throw error;
  }
  return result.json();
}

function azureWorkItemToCase(item) {
  const fields = item.fields || {};
  const assignedTo = fields['System.AssignedTo'];
  return {
    'Work Item Type': fields['System.WorkItemType'] || 'Case', ID: item.id,
    'Salesforce ID': fields['Custom.SalesforceID'] || fields['Custom.SalesforceId'] || null,
    'Site ID': null, Title: fields['System.Title'] || '',
    'Assigned To': typeof assignedTo === 'object' ? assignedTo.displayName : assignedTo || null,
    State: fields['System.State'] || '', Priority: fields['Microsoft.VSTS.Common.Priority'] ?? null,
    Tags: fields['System.Tags'] || '', 'Area Path': fields['System.AreaPath'] || LIVE_DATA_AREA_PATH,
    'Created Date': fields['System.CreatedDate'] || null, 'Comment Count': fields['System.CommentCount'] ?? null,
    'Related Link Count': fields['System.RelatedLinkCount'] ?? null, 'Closing Comment': null,
    'Closed Date': fields['Microsoft.VSTS.Common.ClosedDate'] || null, 'Azure DevOps URL': item.url,
  };
}

function cacheRead(cache, key, ttl) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > ttl) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheWrite(cache, key, value) {
  cache.set(key, { createdAt: Date.now(), value });
  while (cache.size > 100) cache.delete(cache.keys().next().value);
  return value;
}

function metricsCacheKey(dataset, query) {
  return JSON.stringify([dataset, Object.keys(query).sort().map((key) => [key, query[key]])]);
}

function invalidateMetricsCache() {
  metricsCache.clear();
  refreshCache.clear();
}
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
const auth = createAuth({ pool, ensureSchema: () => ensureSchema() });

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:4200' }));
app.use(express.json({ limit: '15mb' }));

async function ensureSchema() {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8')
      .then((schema) => pool.query(schema))
      .then(() => auth.setup())
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
  const dateComparator = operator === '>=' ? '<=' : '>=';
  conditions.push(`"Created Date" ${dateComparator} (timezone('Asia/Kolkata', now())::date - $${values.length})`);
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

function addSearchIdFilter(conditions, values, value) {
  const search = typeof value === 'string' ? value.trim() : '';
  if (!search) return;
  values.push(search);
  conditions.push(`("ID"::text ILIKE '%' || $${values.length} || '%' OR "Salesforce ID" ILIKE '%' || $${values.length} || '%' OR "Site ID" ILIKE '%' || $${values.length} || '%')`);
}
function siteIdFromTitle(title) {
  const segments = String(title ?? '').split('|');
  const lastSegment = segments[segments.length - 1]?.trim() ?? '';
  return /^HC[A-Z0-9]+$/i.test(lastSegment) ? lastSegment.toUpperCase() : null;
}
function addSiteIdFilter(conditions, values, value) {
  const search = typeof value === 'string' ? value.trim() : '';
  if (!search) return;
  values.push(search);
  conditions.push(`"Site ID" ILIKE '%' || $${values.length} || '%'`);
}
function addTagFilter(conditions, values, value) {
  const tag = typeof value === 'string' ? value.trim() : '';
  if (!tag) return;
  values.push(tag);
  conditions.push(`EXISTS (SELECT 1 FROM unnest(string_to_array(COALESCE("Tags", ''), ';')) AS case_tag WHERE lower(btrim(case_tag)) = lower($${values.length}))`);
}

function addStateFilter(conditions, values, value) {
  if (typeof value !== 'string' || !value.trim()) return;
  const states = value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  const stateConditions = [];
  for (const state of states) {
    if (state === 'reopened') addTagFilter(conditions, values, 'Reopened');
    else if (state === 'resolved') stateConditions.push(`lower(trim("State")) IN ('closed', 'removed', 'done', 'delivered to prod', 'refinement')`);
    else if (state === 'opened') stateConditions.push(`lower(trim("State")) NOT IN ('resolved', 'closed', 'removed', 'done', 'delivered to prod', 'refinement')`);
    else if (state === 'awaitingimplementation') stateConditions.push(`lower(trim("State")) = 'awaiting implementation'`);
    else throw new Error('State filter must be resolved, opened, reopened, or awaitingImplementation.');
  }
  if (stateConditions.length) conditions.push(`(${stateConditions.join(' OR ')})`);
}
function addEligibleDatasetFilter(conditions, values, dataset, includeReopened, areaPaths = []) {
  const eligibleTags = dataset === 'riskSummary'
    ? ['orca', 'pentest 2026', 'zerothreat']
    : ['external', 'internal', ...(areaPaths.some((areaPath) => areaPath.toLowerCase().includes('epractice'))
      ? ['devopsitemloader', 'architect input', 'documents regression']
      : [])];
  const tagConditions = eligibleTags.map((tag) => {
    values.push(tag);
    return "\"Tags\" ILIKE '%' || $" + values.length + " || '%'";
  });
  if (dataset !== 'riskSummary') {
    tagConditions.push(`EXISTS (SELECT 1 FROM unnest(string_to_array(COALESCE("Tags", ''), ';')) AS po_tag WHERE lower(btrim(po_tag)) = 'po')`);
  }
  const eligibleCondition = '(' + tagConditions.join(' OR ') + ')';
  if (includeReopened) {
    values.push('Reopened');
    conditions.push('(' + eligibleCondition.slice(1, -1) + ` OR EXISTS (SELECT 1 FROM unnest(string_to_array(COALESCE("Tags", ''), ';')) AS case_tag WHERE lower(btrim(case_tag)) = lower($${values.length}))` + ')');
  } else {
    conditions.push(eligibleCondition);
  }
}

function buildFilters(query, dataset) {
  const values = [];
  const conditions = [];
  const areaPaths = typeof query.areaPath === 'string'
    ? query.areaPath.split(',').map((areaPath) => areaPath.trim()).filter(Boolean)
    : [];
  const includeReopened = dataset !== 'riskSummary' && ((typeof query.stateFilter === 'string' && query.stateFilter.split(',').some((state) => state.trim().toLowerCase() === 'reopened')) || (typeof query.tags === 'string' && query.tags.trim().toLowerCase() === 'reopened'));
  addEligibleDatasetFilter(conditions, values, dataset, includeReopened, areaPaths);
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
  addTagFilter(conditions, values, query.tags);
  const severity = typeof query.severity === 'string' ? query.severity.trim() : '';
  if (severity && dataset !== 'riskSummary') {
    values.push(severity);
    conditions.push(`${priorityExpression()} ILIKE '%' || $${values.length} || '%'`);
  }
  addTextFilter(conditions, values, 'Assigned To', query.assignedTo);
  addSearchIdFilter(conditions, values, query.searchId);

  addStateFilter(conditions, values, query.stateFilter);
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

// Everything below this point requires a signed-in user; login and health stay public.
app.use('/api/auth', auth.router);
app.use('/api', auth.authenticate);
app.use('/api/admin', auth.admin);
app.use('/api', auth.routeGuard);

app.get('/api/live-data', async (_request, response) => {
  const config = azureDevOpsConfig();
  if (!config.organization || !config.project || !config.pat) return response.status(503).json({ error: 'Configure AZURE_DEVOPS_ORGANIZATION, AZURE_DEVOPS_PROJECT, and AZURE_DEVOPS_PAT in the API .env file.' });
  try {
    const baseUrl = `https://dev.azure.com/${encodeURIComponent(config.organization)}/${encodeURIComponent(config.project)}`;
    const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.AreaPath] UNDER '${LIVE_DATA_AREA_PATH.replaceAll("'", "''")}' ORDER BY [System.Id] DESC`;
    const queryResult = await azureDevOpsRequest(`${baseUrl}/_apis/wit/wiql?api-version=${AZURE_DEVOPS_API_VERSION}`, config, { method: 'POST', body: JSON.stringify({ query: wiql }) });
    const ids = (queryResult.workItems || []).map((workItem) => workItem.id).filter(Number.isInteger);
    const items = [];
    for (let start = 0; start < ids.length; start += 200) {
      const batch = await azureDevOpsRequest(`${baseUrl}/_apis/wit/workitemsbatch?api-version=${AZURE_DEVOPS_API_VERSION}`, config, { method: 'POST', body: JSON.stringify({ ids: ids.slice(start, start + 200), fields: ['System.WorkItemType', 'System.Title', 'System.AssignedTo', 'System.State', 'Microsoft.VSTS.Common.Priority', 'System.Tags', 'System.AreaPath', 'System.CreatedDate', 'Microsoft.VSTS.Common.ClosedDate', 'Custom.SalesforceID'] }) });
      items.push(...(batch.value || []).map(azureWorkItemToCase));
    }
    response.json({ items, total: items.length, areaPath: LIVE_DATA_AREA_PATH, fetchedAt: new Date().toISOString() });
  } catch (error) {
    response.status([401, 403, 404].includes(error.status) ? error.status : 502).json({ error: azureDevOpsErrorMessage(error) });
  }
});
app.get('/api/metrics', async (request, response) => {
  try {
    await ensureSchema();
    const dataset = request.query.dataset === 'riskSummary' ? 'riskSummary' : 'cases';
    const cacheKey = metricsCacheKey(dataset, request.query);
    const cached = cacheRead(metricsCache, cacheKey, METRICS_CACHE_TTL_MS);
    if (cached) {
      response.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30');
      return response.json(cached);
    }
    const table = metricTable(dataset);
    const { values, where } = buildFilters(request.query, dataset);
    const ageExpression = dataset === 'riskSummary'
      ? `CASE WHEN "Created Date" IS NOT NULL THEN GREATEST(0, timezone('Asia/Kolkata', now())::date - "Created Date")::integer ELSE NULL END`
      : `GREATEST(0, timezone('Asia/Kolkata', now())::date - "Created Date")::integer`;
    const resolutionExpression = dataset === 'riskSummary'
      ? `CASE WHEN lower(trim("State")) IN ('done', 'delivered to prod') AND "Created Date" IS NOT NULL AND "Closed Date" IS NOT NULL THEN GREATEST(0, ("Closed Date" - "Created Date"))::integer ELSE NULL END`
      : `CASE WHEN lower(trim("State")) IN ('done', 'delivered to prod') AND "Created Date" IS NOT NULL AND "Created Time" IS NOT NULL AND "Closed Date" IS NOT NULL AND "Closed Time" IS NOT NULL THEN GREATEST(0, floor(extract(epoch FROM (("Closed Date" + "Closed Time") - ("Created Date" + "Created Time"))) / 86400))::integer ELSE NULL END`;
    const cachedRefreshes = refreshCache.get(dataset);
    const refreshPromise = cachedRefreshes && Date.now() - cachedRefreshes.cachedAt <= REFRESH_CACHE_TTL_MS
      ? Promise.resolve(cachedRefreshes.value)
      : pool.query(`SELECT "Area Path", max(lastupdatedon) AS lastupdatedon FROM ${table} GROUP BY "Area Path"`)
        .then((refreshes) => {
          const value = Object.fromEntries(refreshes.rows.map((row) => [row['Area Path'], row.lastupdatedon]));
          refreshCache.set(dataset, { cachedAt: Date.now(), value });
          return value;
        });
    const [result, lastDataRefreshByArea] = await Promise.all([
      pool.query(`SELECT ${metricSelectExpressions(dataset).join(', ')}, ${ageExpression} AS "Age", ${resolutionExpression} AS "Resolution" FROM ${table} ${where} ORDER BY "Created Date" DESC NULLS LAST, "ID" DESC`, values),
      refreshPromise,
    ]);
    const payload = {
      items: result.rows,
      total: result.rowCount,
      lastDataRefreshByArea,
    };
    cacheWrite(metricsCache, cacheKey, payload);
    response.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30');
    response.json(payload);
  } catch (error) {
    const status = error.message.startsWith('Age filters') || error.message.startsWith('State filter') || error.message.startsWith('Dataset must') ? 400 : 503;
    response.status(status).json({ error: status === 400 ? error.message : databaseErrorMessage(error) });
  }
});

app.get('/api/resources', async (_request, response) => {
  try {
    await ensureSchema();
    const cached = resourcesCache && Date.now() - resourcesCache.createdAt <= RESOURCES_CACHE_TTL_MS
      ? resourcesCache.value
      : undefined;
    if (cached) {
      response.set('Cache-Control', 'private, max-age=300');
      return response.json(cached);
    }
    const result = await pool.query(
      `SELECT resource."Resource_Name", resource."Department", resource."Team", COALESCE(array_agg(alias."Alias") FILTER (WHERE alias."Alias" IS NOT NULL), ARRAY[]::text[]) AS "Aliases" FROM ${RESOURCE_TABLE} AS resource LEFT JOIN "DevOps_SF_Summary"."resource_aliases" AS alias USING ("Resource_Name") GROUP BY resource."Resource_Name", resource."Department", resource."Team" ORDER BY resource."Resource_Name"`,
    );
    resourcesCache = { createdAt: Date.now(), value: { items: result.rows } };
    response.set('Cache-Control', 'private, max-age=300');
    response.json(resourcesCache.value);
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
  const expectedColumns = importColumnsFor(request.body?.dataset).filter((column) => column !== 'Site ID');
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
          const value = column === 'Site ID' ? siteIdFromTitle(record.Title) : record[column];
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
    invalidateMetricsCache();
    response.json({ imported: records.length });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    response.status(400).json({ error: `Import failed: ${error.message}` });
  } finally {
    client.release();
  }
});

const ERROR_DETAILS_TABLE = '"DevOps_SF_Summary"."error_details"';
const MONITORING_MODULES = ['Diary', 'Patient', 'Settings', 'Correspondence', 'FHIR', 'Accounting', 'Prescribing'];
const ERROR_DETAIL_COLUMNS = `id, module, error_date::text AS error_date, to_char(exact_timestamp, 'YYYY-MM-DD"T"HH24:MI:SS') AS exact_timestamp, error_details, occurrence_count, alarm_configured, remarks, severity, environment, status, owner, ticket_id`;

function errorDetailFilters(query) {
  const conditions = [];
  const values = [];
  const add = (sql, value) => { values.push(value); conditions.push(sql.replaceAll('?', `$${values.length}`)); };
  const { module, dateFrom, dateTo, alarm, severity, status, search, errorDetails } = query;
  if (module) {
    if (typeof module !== 'string' || !MONITORING_MODULES.includes(module)) throw new Error('Select a valid module.');
    add('module = ?', module);
  }
  if (dateFrom) {
    if (!isValidDate(dateFrom)) throw new Error('From date must be YYYY-MM-DD.');
    add('error_date >= ?::date', dateFrom);
  }
  if (dateTo) {
    if (!isValidDate(dateTo)) throw new Error('To date must be YYYY-MM-DD.');
    add('error_date <= ?::date', dateTo);
  }
  if (alarm) {
    if (!['Yes', 'No'].includes(alarm)) throw new Error('Alarm filter must be Yes or No.');
    add('alarm_configured = ?', alarm);
  }
  if (typeof severity === 'string' && severity.trim()) add('lower(severity) = lower(?)', severity.trim());
  if (typeof status === 'string' && status.trim()) add('lower(status) = lower(?)', status.trim());
  if (typeof errorDetails === 'string' && errorDetails.trim()) add('lower(btrim(error_details)) = lower(btrim(?))', errorDetails);
  if (typeof search === 'string' && search.trim()) {
    values.push(`%${search.trim().replace(/[\\%_]/g, '\\$&')}%`);
    const parameter = `$${values.length}`;
    conditions.push(`(error_details ILIKE ${parameter} OR COALESCE(remarks, '') ILIKE ${parameter} OR COALESCE(ticket_id, '') ILIKE ${parameter})`);
  }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', values };
}

app.get('/api/error-details', async (request, response) => {
  let filters;
  try {
    filters = errorDetailFilters(request.query);
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }
  try {
    await ensureSchema();
    const result = await pool.query(
      `SELECT ${ERROR_DETAIL_COLUMNS} FROM ${ERROR_DETAILS_TABLE} ${filters.where} ORDER BY error_date DESC, exact_timestamp DESC NULLS LAST, id DESC LIMIT 5000`,
      filters.values,
    );
    response.json({ items: result.rows, total: result.rowCount });
  } catch (error) {
    response.status(503).json({ error: databaseErrorMessage(error) });
  }
});

// Per-day totals for each distinct error; used when an error is selected.
app.get('/api/error-details/occurrences', async (request, response) => {
  if (typeof request.query.errorDetails !== 'string' || !request.query.errorDetails.trim()) {
    return response.status(400).json({ error: 'Provide the errorDetails text to count.' });
  }
  let filters;
  try {
    filters = errorDetailFilters({ module: request.query.module, dateFrom: request.query.dateFrom, dateTo: request.query.dateTo, errorDetails: request.query.errorDetails });
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }
  try {
    await ensureSchema();
    const result = await pool.query(
      `SELECT error_date::text AS error_date, SUM(occurrence_count)::integer AS occurrences, COUNT(*)::integer AS entries, to_char(MIN(exact_timestamp), 'HH24:MI:SS') AS first_seen, to_char(MAX(exact_timestamp), 'HH24:MI:SS') AS last_seen FROM ${ERROR_DETAILS_TABLE} ${filters.where} GROUP BY error_date ORDER BY error_date DESC`,
      filters.values,
    );
    response.json({ items: result.rows, total: result.rows.reduce((sum, row) => sum + row.occurrences, 0) });
  } catch (error) {
    response.status(503).json({ error: databaseErrorMessage(error) });
  }
});

app.post('/api/error-details/import', async (request, response) => {
  const records = request.body?.records;
  if (!Array.isArray(records) || records.length === 0) {
    return response.status(400).json({ error: 'Provide at least one row in the records array.' });
  }
  if (records.length > 20000) {
    return response.status(413).json({ error: 'A workbook can contain at most 20,000 rows per import.' });
  }
  const text = (value) => (value === undefined || value === null || String(value).trim() === '' ? null : String(value).trim());
  const rows = [];
  for (const [index, record] of records.entries()) {
    const line = index + 2;
    if (!record || typeof record !== 'object') return response.status(400).json({ error: `Row ${line} is not valid.` });
    const module = MONITORING_MODULES.find((name) => name.toLowerCase() === String(record.module ?? '').trim().toLowerCase());
    if (!module) return response.status(400).json({ error: `Row ${line} has an invalid Module. Use ${MONITORING_MODULES.join(', ')}.` });
    const errorDate = text(record.error_date);
    if (!isValidDate(errorDate)) return response.status(400).json({ error: `Row ${line} needs a Date in YYYY-MM-DD format.` });
    const exactTimestamp = text(record.exact_timestamp);
    if (exactTimestamp && !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(exactTimestamp) && !/^\d{2}:\d{2}(:\d{2})?$/.test(exactTimestamp)) {
      return response.status(400).json({ error: `Row ${line} has an invalid Exact Timestamp. Use YYYY-MM-DD HH:MM:SS or HH:MM:SS.` });
    }
    const timestamp = exactTimestamp ? (exactTimestamp.length <= 8 ? `${errorDate} ${exactTimestamp}` : exactTimestamp.replace('T', ' ')) : null;
    if (timestamp && timestamp.slice(0, 10) !== errorDate) {
      return response.status(400).json({ error: `Row ${line}: Exact Timestamp must be on the same day as Date.` });
    }
    const details = text(record.error_details);
    if (!details) return response.status(400).json({ error: `Row ${line} needs Error Details.` });
    const countText = text(record.occurrence_count);
    const count = countText === null ? 1 : Number(countText);
    if (!Number.isInteger(count) || count < 0) return response.status(400).json({ error: `Row ${line} has an invalid No: Of times Occurred.` });
    const alarmText = text(record.alarm_configured)?.toLowerCase() ?? 'no';
    if (!['yes', 'no', 'y', 'n'].includes(alarmText)) return response.status(400).json({ error: `Row ${line} Alarm Configured must be Yes or No.` });
    const rowHash = crypto.createHash('sha256').update([module, errorDate, timestamp ?? '', details.toLowerCase()].join('|')).digest('hex');
    rows.push([module, errorDate, timestamp, details, count, alarmText.startsWith('y') ? 'Yes' : 'No', text(record.remarks), text(record.severity), text(record.environment), text(record.status), text(record.owner), text(record.ticket_id), rowHash]);
  }
  const unique = [...new Map(rows.map((row) => [row[12], row])).values()];

  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    return response.status(503).json({ error: databaseErrorMessage(error) });
  }
  try {
    await ensureSchema();
    await client.query('BEGIN');
    for (let start = 0; start < unique.length; start += 1000) {
      const batch = unique.slice(start, start + 1000);
      const values = batch.flat();
      const tuples = batch.map((_, row) => `(${Array.from({ length: 13 }, (_, column) => `$${row * 13 + column + 1}`).join(', ')})`);
      await client.query(
        `INSERT INTO ${ERROR_DETAILS_TABLE} (module, error_date, exact_timestamp, error_details, occurrence_count, alarm_configured, remarks, severity, environment, status, owner, ticket_id, row_hash) VALUES ${tuples.join(', ')} ON CONFLICT (row_hash) DO UPDATE SET occurrence_count = EXCLUDED.occurrence_count, alarm_configured = EXCLUDED.alarm_configured, remarks = EXCLUDED.remarks, severity = EXCLUDED.severity, environment = EXCLUDED.environment, status = EXCLUDED.status, owner = EXCLUDED.owner, ticket_id = EXCLUDED.ticket_id, lastupdatedon = statement_timestamp()`,
        values,
      );
    }
    await client.query('COMMIT');
    response.json({ imported: unique.length });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    response.status(400).json({ error: `Import failed: ${error.message}` });
  } finally {
    client.release();
  }
});

const WORKLOAD_TABLE = '"DevOps_SF_Summary"."team_details"';
const WORKLOAD_RESOURCES = ['Kasagala Dayanand', 'Madala Koteswar Rao', 'Tuta Mahesh Kumar'];

app.get('/api/team-workload', async (request, response) => {
  const { resource, dateFrom, dateTo } = request.query;
  const conditions = [];
  const values = [];
  if (resource) {
    if (typeof resource !== 'string' || !WORKLOAD_RESOURCES.includes(resource)) return response.status(400).json({ error: 'Select a valid resource.' });
    values.push(resource);
    conditions.push(`"Resource" = $${values.length}`);
  }
  for (const [name, value, operator] of [['From date', dateFrom, '>='], ['To date', dateTo, '<=']]) {
    if (!value) continue;
    if (!isValidDate(value)) return response.status(400).json({ error: `${name} must be YYYY-MM-DD.` });
    values.push(value);
    conditions.push(`"Date" ${operator} $${values.length}::date`);
  }
  try {
    await ensureSchema();
    const result = await pool.query(
      `SELECT id, "Date"::text AS "Date", "From", "To", "Activity Type", "What did you work on", "Resource" FROM ${WORKLOAD_TABLE} ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY "Date" DESC, "Resource", "From" LIMIT 10000`,
      values,
    );
    response.json({ items: result.rows, total: result.rowCount });
  } catch (error) {
    response.status(503).json({ error: databaseErrorMessage(error) });
  }
});

app.post('/api/team-workload/import', async (request, response) => {
  const records = request.body?.records;
  if (!Array.isArray(records) || records.length === 0) {
    return response.status(400).json({ error: 'Provide at least one row in the records array.' });
  }
  if (records.length > 20000) {
    return response.status(413).json({ error: 'A workbook can contain at most 20,000 rows per import.' });
  }
  const text = (value) => (value === undefined || value === null || String(value).trim() === '' ? null : String(value).trim());
  const rows = [];
  for (const [index, record] of records.entries()) {
    const line = index + 2;
    if (!record || typeof record !== 'object') return response.status(400).json({ error: `Row ${line} is not valid.` });
    const date = text(record.date);
    if (!isValidDate(date)) return response.status(400).json({ error: `Row ${line} needs a Date in YYYY-MM-DD format.` });
    const from = text(record.from);
    const to = text(record.to);
    if (!from || !/^([01]\d|2[0-3]):[0-5]\d$/.test(from)) return response.status(400).json({ error: `Row ${line} needs From as HH:MM.` });
    if (!to || !/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(to)) return response.status(400).json({ error: `Row ${line} needs To as HH:MM (24:00 for end of day).` });
    if (to <= from) return response.status(400).json({ error: `Row ${line}: To must be after From.` });
    const activityType = text(record.activity_type);
    if (!activityType || activityType.length > 100) return response.status(400).json({ error: `Row ${line} needs an Activity Type (100 characters or fewer).` });
    const details = text(record.details);
    if (!details || details.length > 1000) return response.status(400).json({ error: `Row ${line} needs "What did you work on" (1000 characters or fewer).` });
    const resource = WORKLOAD_RESOURCES.find((name) => name.toLowerCase() === String(record.resource ?? '').trim().toLowerCase());
    if (!resource) return response.status(400).json({ error: `Row ${line} has an invalid Resource. Use ${WORKLOAD_RESOURCES.join(', ')}.` });
    const rowHash = crypto.createHash('sha256').update([resource, date, from, to].join('|')).digest('hex');
    rows.push([date, from, to, activityType, details, resource, rowHash]);
  }
  const unique = [...new Map(rows.map((row) => [row[6], row])).values()];

  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    return response.status(503).json({ error: databaseErrorMessage(error) });
  }
  try {
    await ensureSchema();
    await client.query('BEGIN');
    // Sample loads replace the existing rows for the same days and resources so hours are not double-counted.
    if (request.body?.replaceExisting === true) {
      await client.query(`DELETE FROM ${WORKLOAD_TABLE} WHERE "Date" = ANY($1::date[]) AND "Resource" = ANY($2::text[])`, [[...new Set(unique.map((row) => row[0]))], [...new Set(unique.map((row) => row[5]))]]);
    }
    for (let start = 0; start < unique.length; start += 1000) {
      const batch = unique.slice(start, start + 1000);
      const tuples = batch.map((_, row) => `(${Array.from({ length: 7 }, (_, column) => `$${row * 7 + column + 1}`).join(', ')})`);
      await client.query(
        `INSERT INTO ${WORKLOAD_TABLE} ("Date", "From", "To", "Activity Type", "What did you work on", "Resource", row_hash) VALUES ${tuples.join(', ')} ON CONFLICT (row_hash) DO UPDATE SET "Activity Type" = EXCLUDED."Activity Type", "What did you work on" = EXCLUDED."What did you work on", lastupdatedon = statement_timestamp()`,
        batch.flat(),
      );
    }
    await client.query('COMMIT');
    response.json({ imported: unique.length });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    response.status(400).json({ error: `Import failed: ${error.message}` });
  } finally {
    client.release();
  }
});

app.listen(PORT, () => console.log(`DevOps metrics API listening on http://localhost:${PORT}`));
