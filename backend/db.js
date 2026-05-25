require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, 'data');
const JSON_STORE_PATH = path.join(DATA_DIR, 'change_history.json');

let pool = null;
let usePostgres = false;

async function initDb() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
  console.log('Change history: using local JSON store (set DATABASE_URL for PostgreSQL)');
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

module.exports = { initDb, logChange, getChangeHistory };
