const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");

// NOTE: job_id (e.g. "finance_001") is a human-readable label, NOT
// globally unique — CoreBot generates it fresh per delegation with no
// persistent counter (that's part of what this stage is building). Real
// historical data collides (multiple unrelated "finance_001"s exist
// already). The true identity of a tracked spawn attempt is `id`
// (internal autoincrement) correlated via `tool_call_id` (unique per
// actual sessions_spawn call) and `child_session_key` (unique per actual
// spawned session).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  tool_call_id TEXT UNIQUE,
  parent_session_id TEXT NOT NULL,
  prefix TEXT NOT NULL,
  seq INTEGER,
  task_type TEXT,
  user_request TEXT,
  objective TEXT,
  assigned_agent TEXT,
  child_session_key TEXT,
  run_id TEXT,
  requester_channel TEXT,
  requester_account TEXT,
  status TEXT NOT NULL,
  one_liner_summary TEXT,
  budget_usd REAL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_row_id INTEGER REFERENCES jobs(id),
  agent_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  cost_usd REAL NOT NULL,
  timestamp TEXT NOT NULL,
  UNIQUE(session_key, timestamp, cost_usd)
);

CREATE TABLE IF NOT EXISTS tail_offsets (
  file_path TEXT PRIMARY KEY,
  byte_offset INTEGER NOT NULL
);

-- State machine history (Stage 7): one row per status transition, so a
-- job's full lifecycle is auditable, not just its current status.
CREATE TABLE IF NOT EXISTS job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_row_id INTEGER NOT NULL REFERENCES jobs(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  timestamp TEXT NOT NULL
);

-- Small key/value store for daemon-level state that must survive a
-- restart — currently just the heartbeat used for crash-recovery catch-up
-- (see daemon.js). Not job-specific, so it doesn't belong in tail_offsets.
CREATE TABLE IF NOT EXISTS daemon_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_job_row ON usage_log(job_row_id);
CREATE INDEX IF NOT EXISTS idx_usage_agent_time ON usage_log(agent_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_jobs_child_session ON jobs(child_session_key);
CREATE INDEX IF NOT EXISTS idx_jobs_job_id ON jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_jobs_parent_session ON jobs(parent_session_id, status);
CREATE INDEX IF NOT EXISTS idx_job_events_job_row ON job_events(job_row_id);
`;

function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  return db;
}

// Records a status transition into job_events. Called by every function
// below that changes jobs.status, so job_events is always a complete,
// derivable-from-nothing-else history of the state machine.
function recordEvent(db, jobRowId, fromStatus, toStatus, note) {
  db.prepare(
    `INSERT INTO job_events (job_row_id, from_status, to_status, note, timestamp) VALUES (?, ?, ?, ?, ?)`
  ).run(jobRowId, fromStatus ?? null, toStatus, note ?? null, new Date().toISOString());
}

function jobHistory(db, rowId) {
  return db.prepare(`SELECT * FROM job_events WHERE job_row_id = ? ORDER BY id ASC`).all(rowId);
}

function insertJob(db, job) {
  try {
    db.prepare(
      `INSERT INTO jobs (job_id, tool_call_id, parent_session_id, prefix, seq, task_type, user_request, objective, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'created', ?)`
    ).run(job.jobId, job.toolCallId, job.parentSessionId, job.prefix, job.seq, job.taskType ?? null, job.userRequest ?? null, job.objective ?? null, job.createdAt);
  } catch (e) {
    if (!String(e.message).includes("UNIQUE constraint")) throw e; // same tool_call_id seen twice (re-tail) — fine, ignore
    return;
  }
  const created = findJobByToolCallId(db, job.toolCallId);
  if (created) recordEvent(db, created.id, null, "created", null);
}

// The job this parent session is most recently waiting on completion for.
function findLatestInProgressJobByParentSession(db, parentSessionId) {
  return db.prepare(
    `SELECT * FROM jobs WHERE parent_session_id = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1`
  ).get(parentSessionId);
}

function findJobByToolCallId(db, toolCallId) {
  return db.prepare(`SELECT * FROM jobs WHERE tool_call_id = ?`).get(toolCallId);
}

function markJobInProgress(db, rowId, fields) {
  db.prepare(
    `UPDATE jobs SET assigned_agent = ?, child_session_key = ?, run_id = ?, status = 'in_progress' WHERE id = ?`
  ).run(fields.assignedAgent, fields.childSessionKey, fields.runId, rowId);
  recordEvent(db, rowId, "created", "in_progress", `assigned to ${fields.assignedAgent}`);
}

function markJobFailed(db, rowId, note, fromStatus) {
  db.prepare(`UPDATE jobs SET status = 'failed', one_liner_summary = ?, completed_at = ? WHERE id = ?`).run(note, new Date().toISOString(), rowId);
  recordEvent(db, rowId, fromStatus ?? null, "failed", note);
}

// Terminal-but-uncertain: the pipeline lost track of this job (specialist
// never yielded, daemon or session died mid-flight) rather than it
// completing or failing cleanly. Distinct from "failed" because we don't
// actually know the outcome — see daemon.js's stale-job sweep.
function markJobOrphaned(db, rowId, note, fromStatus) {
  db.prepare(`UPDATE jobs SET status = 'orphaned', one_liner_summary = ?, completed_at = ? WHERE id = ?`).run(note, new Date().toISOString(), rowId);
  recordEvent(db, rowId, fromStatus ?? null, "orphaned", note);
}

// Jobs sitting in `status` longer than `olderThanIso` (compared against
// created_at) with nothing newer — candidates for the stale-job sweep.
function findStaleJobsByStatus(db, status, olderThanIso) {
  return db.prepare(`SELECT * FROM jobs WHERE status = ? AND created_at < ? ORDER BY id ASC`).all(status, olderThanIso);
}

function getDaemonState(db, key) {
  const row = db.prepare(`SELECT value FROM daemon_state WHERE key = ?`).get(key);
  return row ? row.value : null;
}

function setDaemonState(db, key, value) {
  db.prepare(
    `INSERT INTO daemon_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

function setJobRequester(db, rowId, channel, account) {
  db.prepare(`UPDATE jobs SET requester_channel = ?, requester_account = ? WHERE id = ? AND requester_channel IS NULL`).run(channel, account, rowId);
}

// Most recent in_progress job for this exact child session — child session
// keys are freshly generated UUIDs per spawn, so this is a reliable match.
function findJobByChildSessionKey(db, childSessionKey) {
  return db.prepare(`SELECT * FROM jobs WHERE child_session_key = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1`).get(childSessionKey);
}

function completeJob(db, rowId, oneLiner) {
  db.prepare(
    `UPDATE jobs SET status = 'completed', one_liner_summary = ?, completed_at = ? WHERE id = ?`
  ).run(oneLiner, new Date().toISOString(), rowId);
  recordEvent(db, rowId, "in_progress", "completed", oneLiner);
}

function insertUsage(db, u) {
  try {
    db.prepare(
      `INSERT INTO usage_log (job_row_id, agent_id, session_key, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      u.jobRowId ?? null, u.agentId, u.sessionKey, u.provider, u.model,
      u.inputTokens ?? null, u.outputTokens ?? null, u.cacheReadTokens ?? null, u.cacheWriteTokens ?? null,
      u.costUsd, u.timestamp
    );
  } catch (e) {
    if (!String(e.message).includes("UNIQUE constraint")) throw e;
  }
}

function sumJobCost(db, rowId) {
  const row = db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM usage_log WHERE job_row_id = ?`).get(rowId);
  return row.total;
}

// Spend grouped by agent+provider within a date window. `since` is an
// ISO8601 string (inclusive); pass null for all-time.
function usageByAgentProvider(db, since) {
  const query = since
    ? `SELECT agent_id, provider, SUM(cost_usd) AS total, COUNT(*) AS calls FROM usage_log WHERE timestamp >= ? GROUP BY agent_id, provider ORDER BY total DESC`
    : `SELECT agent_id, provider, SUM(cost_usd) AS total, COUNT(*) AS calls FROM usage_log GROUP BY agent_id, provider ORDER BY total DESC`;
  return since ? db.prepare(query).all(since) : db.prepare(query).all();
}

function usageTotal(db, since) {
  const query = since
    ? `SELECT COALESCE(SUM(cost_usd), 0) AS total, COUNT(*) AS calls FROM usage_log WHERE timestamp >= ?`
    : `SELECT COALESCE(SUM(cost_usd), 0) AS total, COUNT(*) AS calls FROM usage_log`;
  return since ? db.prepare(query).get(since) : db.prepare(query).get();
}

function findJobByLabel(db, jobId) {
  // Most recent match — job_id labels aren't globally unique (see README).
  return db.prepare(`SELECT * FROM jobs WHERE job_id = ? ORDER BY id DESC LIMIT 1`).get(jobId);
}

function usageForAgent(db, agentId, since) {
  const query = since
    ? `SELECT provider, SUM(cost_usd) AS total, COUNT(*) AS calls FROM usage_log WHERE agent_id = ? AND timestamp >= ? GROUP BY provider ORDER BY total DESC`
    : `SELECT provider, SUM(cost_usd) AS total, COUNT(*) AS calls FROM usage_log WHERE agent_id = ? GROUP BY provider ORDER BY total DESC`;
  return since ? db.prepare(query).all(agentId, since) : db.prepare(query).all(agentId);
}

function getTailOffset(db, filePath) {
  const row = db.prepare(`SELECT byte_offset FROM tail_offsets WHERE file_path = ?`).get(filePath);
  return row ? row.byte_offset : 0;
}

function setTailOffset(db, filePath, offset) {
  db.prepare(
    `INSERT INTO tail_offsets (file_path, byte_offset) VALUES (?, ?)
     ON CONFLICT(file_path) DO UPDATE SET byte_offset = excluded.byte_offset`
  ).run(filePath, offset);
}

module.exports = {
  openDb, insertJob, findJobByToolCallId, findLatestInProgressJobByParentSession, markJobInProgress, markJobFailed,
  setJobRequester, findJobByChildSessionKey, completeJob, insertUsage, sumJobCost, getTailOffset, setTailOffset,
  usageByAgentProvider, usageTotal, findJobByLabel, usageForAgent,
  recordEvent, jobHistory, markJobOrphaned, findStaleJobsByStatus, getDaemonState, setDaemonState,
};
