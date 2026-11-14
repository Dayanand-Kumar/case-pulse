const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const express = require('express');

const scrypt = promisify(crypto.scrypt);
const USERS_TABLE = '"DevOps_SF_Summary"."app_users"';
const SESSIONS_TABLE = '"DevOps_SF_Summary"."auth_sessions"';
const ROLES_TABLE = '"DevOps_SF_Summary"."app_roles"';
const PERMISSIONS_TABLE = '"DevOps_SF_Summary"."role_permissions"';
const SESSION_HOURS = 8;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const PERMISSIONS = [
  'cases', 'dashboard', 'risk-summary', 'team-workload', 'categories', 'documentation',
  'reports', 'monitoring', 'live-data', 'access-management', 'data-import',
];
const SEED_USERS = [
  { username: 'dayanand', displayName: 'Dayanand', role: 'admin' },
  { username: 'madala', displayName: 'Madala', role: 'manager' },
  { username: 'tuta', displayName: 'Tuta', role: 'viewer' },
];
// Route prefixes whose GET requests need a specific page permission on top of signing in.
const PERMISSION_BY_PREFIX = [
  { prefix: '/live-data', permission: 'live-data' },
  { prefix: '/error-details', permission: 'monitoring' },
  { prefix: '/team-workload', permission: 'team-workload', method: 'GET' },
];
const IMPORT_PATHS = new Set(['/metrics/import', '/error-details/import', '/team-workload/import']);
const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;

/** Creates a salted scrypt hash so plain passwords are never stored. */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

/** Compares a password with a stored hash in constant time. */
async function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** Hashes a bearer token so a database leak does not expose usable sessions. */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Builds the public user shape returned to the browser. */
function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    active: row.active,
    permissions: row.permissions || [],
  };
}

/** Wires authentication, role checks and admin APIs onto the shared pool. */
function createAuth({ pool, ensureSchema }) {
  const failedLogins = new Map();

  /** Creates auth tables and seeds the sample users once per process; passwords never appear in source. */
  async function setup() {
    await pool.query(await fs.readFile(path.join(__dirname, 'auth.sql'), 'utf8'));
    for (const user of SEED_USERS) {
      const existing = await pool.query(`SELECT 1 FROM ${USERS_TABLE} WHERE lower(username) = $1`, [user.username]);
      if (existing.rowCount) continue;
      const configured = process.env[`AUTH_SEED_PASSWORD_${user.username.toUpperCase()}`] || process.env.AUTH_SEED_PASSWORD;
      const password = configured || crypto.randomBytes(9).toString('base64url');
      await pool.query(
        `INSERT INTO ${USERS_TABLE} (username, display_name, role, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [user.username, user.displayName, user.role, await hashPassword(password)],
      );
      if (!configured) console.log(`Created user "${user.username}" (${user.role}) with one-time password: ${password}`);
    }
  }

  /** Loads a user with the permissions of their current role. */
  async function loadUser(whereSql, values) {
    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.role, u.active, u.password_hash,
        COALESCE((SELECT array_agg(p.permission ORDER BY p.permission) FROM ${PERMISSIONS_TABLE} p WHERE p.role = u.role), '{}') AS permissions
       FROM ${USERS_TABLE} u WHERE ${whereSql}`,
      values,
    );
    return result.rows[0];
  }

  /** Issues a session token for a verified user. */
  async function createSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
    await pool.query(`DELETE FROM ${SESSIONS_TABLE} WHERE expires_at < now()`);
    await pool.query(`INSERT INTO ${SESSIONS_TABLE} (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`, [hashToken(token), userId, expiresAt]);
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /** Rejects requests without a valid, unexpired session and attaches the user to the request. */
  async function authenticate(request, response, next) {
    const match = /^Bearer (.+)$/.exec(request.headers.authorization || '');
    if (!match) return response.status(401).json({ error: 'Sign in to continue.' });
    try {
      await ensureSchema();
      const user = await loadUser(
        `u.active AND u.id = (SELECT user_id FROM ${SESSIONS_TABLE} WHERE token_hash = $1 AND expires_at > now())`,
        [hashToken(match[1])],
      );
      if (!user) return response.status(401).json({ error: 'Your session has expired. Sign in again.' });
      request.user = publicUser(user);
      request.tokenHash = hashToken(match[1]);
      next();
    } catch {
      response.status(503).json({ error: 'Could not verify your session.' });
    }
  }

  /** Builds a middleware that allows only users whose role holds the permission. */
  function requirePermission(permission) {
    return (request, response, next) => {
      if (request.user.permissions.includes(permission)) return next();
      response.status(403).json({ error: 'Your role does not have access to this feature.' });
    };
  }

  /** Applies per-feature permissions to the shared data API after sign-in is confirmed. */
  function routeGuard(request, response, next) {
    if (request.method === 'POST' && IMPORT_PATHS.has(request.path)) return requirePermission('data-import')(request, response, next);
    const rule = PERMISSION_BY_PREFIX.find(({ prefix, method }) => request.path.startsWith(prefix) && (!method || method === request.method));
    if (rule) return requirePermission(rule.permission)(request, response, next);
    next();
  }

  const router = express.Router();

  /** Verifies credentials, then hands the browser a session token and its permissions. */
  router.post('/login', async (request, response) => {
    const username = String(request.body?.username || '').trim().toLowerCase();
    const password = String(request.body?.password || '');
    if (!username || !password || username.length > 100 || password.length > 200) {
      return response.status(400).json({ error: 'Enter a username and password.' });
    }
    const attemptKey = `${username}|${request.ip}`;
    const attempts = failedLogins.get(attemptKey);
    if (attempts && attempts.count >= MAX_FAILED_LOGINS && Date.now() - attempts.last < LOCKOUT_MS) {
      return response.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
    }
    try {
      await ensureSchema();
      const user = await loadUser('lower(u.username) = $1', [username]);
      const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !user.active || !valid) {
        failedLogins.set(attemptKey, { count: (attempts && Date.now() - attempts.last < LOCKOUT_MS ? attempts.count : 0) + 1, last: Date.now() });
        return response.status(401).json({ error: 'Invalid username or password.' });
      }
      failedLogins.delete(attemptKey);
      await pool.query(`UPDATE ${USERS_TABLE} SET last_login_at = now() WHERE id = $1`, [user.id]);
      response.json({ ...(await createSession(user.id)), user: publicUser(user) });
    } catch {
      response.status(503).json({ error: 'Sign-in is unavailable. Check the database connection.' });
    }
  });

  /** Returns the signed-in user so the browser can restore a session after reload. */
  router.get('/me', authenticate, (request, response) => response.json({ user: request.user }));

  /** Ends the current session. */
  router.post('/logout', authenticate, async (request, response) => {
    await pool.query(`DELETE FROM ${SESSIONS_TABLE} WHERE token_hash = $1`, [request.tokenHash]);
    response.status(204).end();
  });

  /** Lets a user replace their own password; other sessions are signed out. */
  router.post('/change-password', authenticate, async (request, response) => {
    const currentPassword = String(request.body?.currentPassword || '');
    const newPassword = String(request.body?.newPassword || '');
    if (newPassword.length < 10 || newPassword.length > 200) {
      return response.status(400).json({ error: 'The new password must be at least 10 characters.' });
    }
    try {
      const user = await loadUser('u.id = $1', [request.user.id]);
      if (!(await verifyPassword(currentPassword, user.password_hash))) {
        return response.status(400).json({ error: 'The current password is incorrect.' });
      }
      await pool.query(`UPDATE ${USERS_TABLE} SET password_hash = $1 WHERE id = $2`, [await hashPassword(newPassword), user.id]);
      await pool.query(`DELETE FROM ${SESSIONS_TABLE} WHERE user_id = $1 AND token_hash <> $2`, [user.id, request.tokenHash]);
      response.status(204).end();
    } catch {
      response.status(500).json({ error: 'Could not change the password.' });
    }
  });

  const admin = express.Router();
  admin.use(requirePermission('access-management'));

  /** Lists users, roles and the assignable permissions for the Access Management page. */
  admin.get('/access', async (_request, response) => {
    try {
      const users = await pool.query(
        `SELECT u.id, u.username, u.display_name, u.role, u.active, u.last_login_at FROM ${USERS_TABLE} u ORDER BY u.id`,
      );
      const roles = await pool.query(
        `SELECT r.role, r.description, COALESCE(array_agg(p.permission ORDER BY p.permission) FILTER (WHERE p.permission IS NOT NULL), '{}') AS permissions
         FROM ${ROLES_TABLE} r LEFT JOIN ${PERMISSIONS_TABLE} p ON p.role = r.role GROUP BY r.role, r.description ORDER BY r.role`,
      );
      response.json({
        permissions: PERMISSIONS,
        roles: roles.rows,
        users: users.rows.map((row) => ({ id: row.id, username: row.username, displayName: row.display_name, role: row.role, active: row.active, lastLoginAt: row.last_login_at })),
      });
    } catch {
      response.status(500).json({ error: 'Could not load access settings.' });
    }
  });

  /** Changes a user's role or active flag; takes effect on their next request. */
  admin.patch('/users/:id', async (request, response) => {
    const id = Number(request.params.id);
    const { role, active } = request.body || {};
    if (!Number.isInteger(id)) return response.status(400).json({ error: 'Invalid user.' });
    if (role !== undefined && typeof role !== 'string') return response.status(400).json({ error: 'Invalid role.' });
    if (active !== undefined && typeof active !== 'boolean') return response.status(400).json({ error: 'Invalid active flag.' });
    if (id === request.user.id && (active === false || (role !== undefined && role !== request.user.role))) {
      return response.status(400).json({ error: 'You cannot change your own role or deactivate yourself.' });
    }
    try {
      const result = await pool.query(
        `UPDATE ${USERS_TABLE} SET role = COALESCE($2, role), active = COALESCE($3, active) WHERE id = $1 RETURNING id`,
        [id, role ?? null, active ?? null],
      );
      if (!result.rowCount) return response.status(404).json({ error: 'User not found.' });
      if (active === false) await pool.query(`DELETE FROM ${SESSIONS_TABLE} WHERE user_id = $1`, [id]);
      response.status(204).end();
    } catch (error) {
      response.status(error.code === '23503' ? 400 : 500).json({ error: error.code === '23503' ? 'Unknown role.' : 'Could not update the user.' });
    }
  });

  /** Replaces the permissions of a role; the admin role always keeps Access Management. */
  admin.put('/roles/:role/permissions', async (request, response) => {
    const { role } = request.params;
    const permissions = request.body?.permissions;
    if (!Array.isArray(permissions) || permissions.some((item) => !PERMISSIONS.includes(item))) {
      return response.status(400).json({ error: 'Unknown permission.' });
    }
    const unique = [...new Set(permissions)];
    if (role === 'admin' && !unique.includes('access-management')) {
      return response.status(400).json({ error: 'The admin role must keep Access Management.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query(`SELECT 1 FROM ${ROLES_TABLE} WHERE role = $1`, [role]);
      if (!exists.rowCount) {
        await client.query('ROLLBACK');
        return response.status(404).json({ error: 'Role not found.' });
      }
      await client.query(`DELETE FROM ${PERMISSIONS_TABLE} WHERE role = $1`, [role]);
      if (unique.length) {
        await client.query(`INSERT INTO ${PERMISSIONS_TABLE} (role, permission) SELECT $1, unnest($2::text[])`, [role, unique]);
      }
      await client.query('COMMIT');
      response.status(204).end();
    } catch {
      await client.query('ROLLBACK').catch(() => undefined);
      response.status(500).json({ error: 'Could not update the role.' });
    } finally {
      client.release();
    }
  });

  return { setup, router, admin, authenticate, routeGuard };
}

module.exports = { createAuth };
