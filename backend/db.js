require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, 'data');
const JSON_STORE_PATH = path.join(DATA_DIR, 'change_history.json');
const JSON_SESSIONS_PATH = path.join(DATA_DIR, 'sessions.json');

const DEFAULT_CODE = '// Welcome to CollabCode!\n// Start coding here...';

let pool = null;
let usePostgres = false;

function needsSsl(connectionString) {
  if (process.env.DATABASE_SSL === 'true') return true;
  if (process.env.DATABASE_SSL === 'false') return false;
  const url = connectionString || '';
  return (
    url.includes('supabase.co') ||
    url.includes('pooler.supabase.com') ||
    url.includes('render.com') ||
    url.includes('neon.tech') ||
    url.includes('sslmode=require')
  );
}

async function initDb() {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString,
      ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : undefined
    });
    usePostgres = true;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS change_history (
        id UUID PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        change_type VARCHAR(50) NOT NULL,
        actor_username VARCHAR(255),
        actor_role VARCHAR(20),
        actor_socket_id VARCHAR(255),
        description TEXT,
        old_code TEXT,
        new_code TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_change_history_session_created
        ON change_history(session_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(255) PRIMARY KEY,
        code TEXT NOT NULL,
        language VARCHAR(50) DEFAULT 'javascript',
        password TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('Change history: PostgreSQL connected');
    return;
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(JSON_STORE_PATH)) {
    fs.writeFileSync(JSON_STORE_PATH, '[]', 'utf8');
  }
  if (!fs.existsSync(JSON_SESSIONS_PATH)) {
    fs.writeFileSync(JSON_SESSIONS_PATH, '{}', 'utf8');
  }
  const onRender = !!(process.env.RENDER || process.env.RENDER_SERVICE_ID);
  if (onRender || process.env.NODE_ENV === 'production') {
    console.warn(
      'WARNING: DATABASE_URL not set. Change history uses a temp JSON file and will be LOST on redeploy. ' +
      'Add Supabase or Render Postgres URL in environment variables.'
    );
  } else {
    console.log('Change history: local JSON store (dev only). Set DATABASE_URL for PostgreSQL.');
  }
}

function readJsonStore() {
  try {
    return JSON.parse(fs.readFileSync(JSON_STORE_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function writeJsonStore(entries) {
  fs.writeFileSync(JSON_STORE_PATH, JSON.stringify(entries, null, 2), 'utf8');
}

async function logChange({
  sessionId,
  changeType,
  actorUsername,
  actorRole,
  actorSocketId,
  description = null,
  oldCode = null,
  newCode = null,
  metadata = {}
}) {
  const entry = {
    id: uuidv4(),
    session_id: sessionId,
    change_type: changeType,
    actor_username: actorUsername,
    actor_role: actorRole,
    actor_socket_id: actorSocketId,
    description,
    old_code: oldCode,
    new_code: newCode,
    metadata,
    created_at: new Date().toISOString()
  };

  if (usePostgres && pool) {
    const result = await pool.query(
      `INSERT INTO change_history
        (id, session_id, change_type, actor_username, actor_role, actor_socket_id,
         description, old_code, new_code, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        entry.id,
        entry.session_id,
        entry.change_type,
        entry.actor_username,
        entry.actor_role,
        entry.actor_socket_id,
        entry.description,
        entry.old_code,
        entry.new_code,
        JSON.stringify(entry.metadata)
      ]
    );
    return formatRow(result.rows[0]);
  }

  const all = readJsonStore();
  all.push(entry);
  writeJsonStore(all);
  return formatRow(entry);
}

function formatRow(row) {
  const metadata = typeof row.metadata === 'string'
    ? JSON.parse(row.metadata)
    : (row.metadata || {});
  return {
    id: row.id,
    sessionId: row.session_id,
    changeType: row.change_type,
    actorUsername: row.actor_username,
    actorRole: row.actor_role,
    actorSocketId: row.actor_socket_id,
    description: row.description,
    oldCode: row.old_code,
    newCode: row.new_code,
    metadata,
    createdAt: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : row.created_at
  };
}

async function getChangeHistory(sessionId, limit = 100) {
  if (usePostgres && pool) {
    const result = await pool.query(
      `SELECT * FROM change_history
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sessionId, limit]
    );
    return result.rows.map(formatRow).reverse();
  }

  const all = readJsonStore()
    .filter((e) => e.session_id === sessionId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return all.slice(-limit).map(formatRow);
}

function readJsonSessions() {
  try {
    return JSON.parse(fs.readFileSync(JSON_SESSIONS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeJsonSessions(data) {
  fs.writeFileSync(JSON_SESSIONS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

async function saveSessionSnapshot(sessionId, { code, language, password }) {
  const payload = {
    code: code ?? DEFAULT_CODE,
    language: language || 'javascript',
    password: password || null,
    updated_at: new Date().toISOString()
  };

  if (usePostgres && pool) {
    await pool.query(
      `INSERT INTO sessions (id, code, language, password, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO UPDATE SET
         code = EXCLUDED.code,
         language = EXCLUDED.language,
         password = EXCLUDED.password,
         updated_at = NOW()`,
      [sessionId, payload.code, payload.language, payload.password]
    );
    return payload;
  }

  const all = readJsonSessions();
  all[sessionId] = payload;
  writeJsonSessions(all);
  return payload;
}

async function loadSessionSnapshot(sessionId) {
  if (usePostgres && pool) {
    const result = await pool.query(
      'SELECT id, code, language, password FROM sessions WHERE id = $1',
      [sessionId]
    );
    if (result.rows[0]) {
      return {
        code: result.rows[0].code,
        language: result.rows[0].language,
        password: result.rows[0].password
      };
    }
    return restoreCodeFromHistory(sessionId);
  }

  const all = readJsonSessions();
  if (all[sessionId]) {
    return {
      code: all[sessionId].code,
      language: all[sessionId].language,
      password: all[sessionId].password
    };
  }
  return restoreCodeFromHistory(sessionId);
}

async function restoreCodeFromHistory(sessionId) {
  const history = await getChangeHistory(sessionId, 50);
  if (!history.length) return null;

  const latest = [...history].reverse().find((e) => e.newCode != null);
  if (!latest) return null;

  const created = history.find((e) => e.changeType === 'session_created');
  return {
    code: latest.newCode,
    language: created?.metadata?.language || 'javascript',
    password: null
  };
}

module.exports = {
  initDb,
  logChange,
  getChangeHistory,
  saveSessionSnapshot,
  loadSessionSnapshot,
  DEFAULT_CODE
};
