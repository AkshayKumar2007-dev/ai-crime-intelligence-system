/* ============================================================
   PostgreSQL connection + schema
   Configure with DATABASE_URL, e.g.:
     postgres://user:password@localhost:5432/crimeintel
   Defaults to a local dev database if unset.
   ============================================================ */
require('dotenv').config();
const { Pool } = require('pg');

const DEFAULT_URL = 'postgres://postgres:postgres@localhost:5432/crimeintel';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || DEFAULT_URL,
  connectionTimeoutMillis: 3000,
  max: 10,
});

let connected = false;
let warned = false;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'open',
  complaint_text TEXT NOT NULL,
  reporter_name TEXT,
  reporter_phone TEXT,
  city TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  intake JSONB,
  classification JSONB,
  severity JSONB,
  triage JSONB,
  intelligence JSONB,
  summary JSONB,
  agent_processed BOOLEAN NOT NULL DEFAULT TRUE,
  total_processing_ms INTEGER
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  agent TEXT NOT NULL,
  action TEXT NOT NULL,
  case_id TEXT,
  color TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log (timestamp DESC);

CREATE TABLE IF NOT EXISTS agent_stats (
  agent TEXT PRIMARY KEY,
  processed INTEGER NOT NULL DEFAULT 0,
  avg_time INTEGER NOT NULL DEFAULT 0,
  color TEXT
);

CREATE TABLE IF NOT EXISTS model_versions (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  classes JSONB NOT NULL,
  vocab_size INTEGER NOT NULL,
  n_classes INTEGER NOT NULL,
  accuracy REAL,
  train_samples INTEGER,
  test_samples INTEGER,
  trained_at TIMESTAMPTZ,
  model_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_versions_created ON model_versions (created_at DESC);

-- Link each case to the model version that classified it
ALTER TABLE cases ADD COLUMN IF NOT EXISTS model_version TEXT;
CREATE INDEX IF NOT EXISTS idx_cases_model_version ON cases (model_version);

-- Mock police inspectors
CREATE TABLE IF NOT EXISTS inspectors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rank TEXT NOT NULL DEFAULT 'Inspector',
  station TEXT NOT NULL DEFAULT 'Local Police Station',
  phone TEXT,
  email TEXT,
  badge_number TEXT,
  specialty TEXT,
  color TEXT NOT NULL DEFAULT '#00d4ff',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add inspector fields to cases
ALTER TABLE cases ADD COLUMN IF NOT EXISTS inspector_id TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS inspector_notes TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS handled_at TIMESTAMPTZ;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_cases_inspector ON cases (inspector_id);
`;

/**
 * Try to connect and create the schema.
 * Returns true when PostgreSQL is usable, false otherwise (caller falls back).
 */
async function init() {
  try {
    await pool.query('SELECT 1');
    await pool.query(SCHEMA);
    connected = true;
    console.log('[DB] Connected to PostgreSQL ✓');
  } catch (err) {
    connected = false;
    console.warn(`[DB] PostgreSQL not reachable (${err.message}) — using in-memory store.`);
    console.warn(`[DB] Set DATABASE_URL (e.g. ${DEFAULT_URL}) and ensure the server is running to enable persistence.`);
  }
  return connected;
}

/**
 * Run a query against PostgreSQL.
 * Throws when the DB is unavailable — callers decide how to fall back.
 */
async function query(text, params) {
  if (!connected) {
    if (!warned) {
      warned = true;
      console.warn('[DB] Query attempted while PostgreSQL is unavailable — falling back to in-memory.');
    }
    throw new Error('PostgreSQL unavailable');
  }
  return pool.query(text, params);
}

function isConnected() {
  return connected;
}

module.exports = { init, query, isConnected, pool, SCHEMA, DEFAULT_URL };