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
