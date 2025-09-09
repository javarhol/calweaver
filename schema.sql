-- Users and auth
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,         -- Google sub
  email TEXT,
  name TEXT,
  tz TEXT,
  google_refresh_token_enc TEXT,
  google_refresh_iv TEXT,
  google_access_token_enc TEXT,
  google_access_iv TEXT,
  google_access_expiry INTEGER, -- epoch seconds
  created_at TEXT,
  updated_at TEXT
);

-- Preferences
CREATE TABLE IF NOT EXISTS preferences (
  user_id TEXT PRIMARY KEY,
  horizon_days INTEGER DEFAULT 7,
  working_start TEXT DEFAULT '09:00', -- HH:MM
  working_end TEXT DEFAULT '17:00',
  workdays TEXT DEFAULT '["Mon","Tue","Wed","Thu","Fri"]',
  min_block INTEGER DEFAULT 25,
  max_block INTEGER DEFAULT 90,
  buffer_minutes INTEGER DEFAULT 10,
  max_daily_focus INTEGER DEFAULT 240,
  include_weekends INTEGER DEFAULT 0,
  calendar_id TEXT,
  tasks_list_ids TEXT, -- JSON array of Google Tasks list IDs to include
  created_at TEXT,
  updated_at TEXT
);

-- OpenAI keys (BYOK)
CREATE TABLE IF NOT EXISTS openai_keys (
  user_id TEXT PRIMARY KEY,
  key_enc TEXT,
  key_iv TEXT,
  created_at TEXT
);

-- Runs
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  user_id TEXT,
  started_at TEXT,
  horizon_start TEXT,
  horizon_end TEXT,
  stats_json TEXT
);

-- Scheduled blocks mapping
CREATE TABLE IF NOT EXISTS scheduled_blocks (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  task_id TEXT,
  start TEXT,
  end TEXT,
  calendar_event_id TEXT,
  run_id TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_blocks_user ON scheduled_blocks(user_id);
CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id);
