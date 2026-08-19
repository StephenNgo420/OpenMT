#!/usr/bin/env node
// OpenMT Work Registry daemon (Stage 5). Purely mechanical: tails every
// agent's session .jsonl files, extracts job lifecycle + per-call cost
// data that OpenClaw itself already computes, and persists it to SQLite.
// No LLM calls. See /home/OpenMT/OpenMT/docs/04-cost-and-token-discipline.md
// and the Stage 5 plan for the design rationale.
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const db = require("./db");
const { parseLine } = require("./parser");
const { loadSessionKeyIndex, parseDiscordChannelFromKey, AGENTS_DIR } = require("./session-keys");
const { displayName } = require("./usage-format");

// Stage 6: visible delegation pipeline. This is always the project owner
// regardless of who technically sent the Discord message — there's no
// reliable way to recover the actual message author's Discord user ID
// from session data (checked; not present in session transcripts, sessions
// index, or gateway logs), and for this single-owner project that's fine.
const OWNER_DISCORD_MENTION = process.env.OWNER_DISCORD_ID ? `<@${process.env.OWNER_DISCORD_ID}>` : "";

const DB_PATH = process.env.REGISTRY_DB_PATH || "/home/OpenMT/OpenMT/registry/registry.sqlite";
const POLL_MS = 500; // fast enough to catch short-lived child sessions before cleanup:delete removes them
const RESCAN_MS = 30000;

const database = db.openDb(DB_PATH);
let sessionKeyIndex = loadSessionKeyIndex();
let lastRescan = 0;

// file path -> { agentId, sessionId }
const watchedFiles = new Map();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function sessionFileToId(filePath) {
  return path.basename(filePath, ".jsonl");
}

function listSessionFiles() {
  const files = [];
  let agentIds;
  try {
    agentIds = fs.readdirSync(AGENTS_DIR);
  } catch {
    return files;
  }
  for (const agentId of agentIds) {
    const dir = path.join(AGENTS_DIR, agentId, "sessions");
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.endsWith(".jsonl") && !entry.includes("trajectory")) {
        const filePath = path.join(dir, entry);
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(filePath).mtimeMs;
        } catch {}
        files.push({ agentId, filePath, mtimeMs });
      }
    }
  }
  // Chronological-ish order: a spawned child's session file is always
  // created (and last modified, if short-lived) after its parent's spawn
  // call/result, so this makes the "parent before child" ordering the
  // common case during backfill. Live tailing doesn't depend on this —
  // real-time events naturally arrive in the right order.
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return files;
}

function findChildSessionFile(childSessionKey) {
  // childSessionKey: "agent:<agentId>:subagent:<uuid>"
  const m = /^agent:([^:]+):/.exec(childSessionKey || "");
  if (!m) return null;
  const uuid = childSessionKey.split(":").pop();
  return path.join(AGENTS_DIR, m[1], "sessions", `${uuid}.jsonl`);
}

function readNewLines(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { lines: [], newOffset: null }; // file gone (cleanup: delete)
  }
  const knownOffset = db.getTailOffset(database, filePath);
  if (stat.size <= knownOffset) return { lines: [], newOffset: knownOffset };

  const fd = fs.openSync(filePath, "r");
  const length = stat.size - knownOffset;
  const buf = Buffer.alloc(length);
  fs.readSync(fd, buf, 0, length, knownOffset);
  fs.closeSync(fd);

  const text = buf.toString("utf8");
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline === -1) return { lines: [], newOffset: knownOffset }; // incomplete line, wait for more

  const complete = text.slice(0, lastNewline);
  const newOffset = knownOffset + Buffer.byteLength(text.slice(0, lastNewline + 1), "utf8");
  const lines = complete.split("\n").filter(Boolean);
  return { lines, newOffset };
}

function deliverMessage({ account, target, message, label }) {
  execFile(
    "openclaw",
    ["message", "send", "--channel", "discord", "--account", account, "--target", target, "--message", message],
    { env: { ...process.env, PATH: `${process.env.PATH}:/home/OpenMT/.npm-global/bin` } },
    (err, stdout, stderr) => {
      if (err) log("delivery FAILED:", label || "", account, target, err.message, stderr);
      else log("delivered", label || "message", "as", account, "to", target);
    }
  );
}

// Guard against backfill (replaying old session history on startup, or
// after a restart) sending live Discord notifications for jobs that
// actually completed long ago. Only jobs created within this window get
// a real delivery; older ones still get recorded correctly in the DB.
const LIVE_DELIVERY_WINDOW_MS = 5 * 60 * 1000;

function isRecent(createdAtIso) {
  return Date.now() - new Date(createdAtIso).getTime() <= LIVE_DELIVERY_WINDOW_MS;
}

function formatAcceptAssignMessage(job) {
  return `✅ Accepted \`${job.job_id}\`${job.task_type ? ` — ${job.task_type}` : ""}. Assigning to ${displayName(job.prefix)}.`;
}

function formatSpecialistAcceptMessage(job) {
  return `👋 ${displayName(job.assigned_agent)} here — starting \`${job.job_id}\`.`;
}

function formatCompletionMessage(jobId, oneLiner, totalCost) {
  const mention = OWNER_DISCORD_MENTION ? ` ${OWNER_DISCORD_MENTION}` : "";
  return `✅ ${jobId.toUpperCase()} completed.\n${oneLiner}\n💰 $${totalCost.toFixed(4)} used${mention}`;
}

function truncateOneLiner(text) {
  const firstLine = (text || "").split("\n").find((l) => l.trim().length > 0) || "";
  return firstLine.length > 200 ? firstLine.slice(0, 197) + "..." : firstLine;
}

function processEvent(agentId, sessionId, event) {
  const sessionKey = `agent:${agentId}:${sessionId}`; // not the true key, just a log label
  switch (event.type) {
    case "spawn_call": {
      if (agentId !== "core") return; // only CoreBot delegates
      db.insertJob(database, {
        jobId: event.jobId,
        toolCallId: event.toolCallId,
        parentSessionId: sessionId,
        prefix: event.prefix,
        seq: event.seq,
        taskType: event.taskType,
        userRequest: event.userRequest,
        objective: event.objective,
        createdAt: event.timestamp,
      });
      // Requester channel/account: derived from CoreBot's own session key.
      const createdJob = db.findJobByToolCallId(database, event.toolCallId);
      if (createdJob) {
        const parentMeta = sessionKeyIndex.get(sessionId);
        const discord = parentMeta ? parseDiscordChannelFromKey(parentMeta.sessionKey) : null;
        if (discord) {
          db.setJobRequester(database, createdJob.id, discord.target, discord.account);
          if (isRecent(createdJob.created_at)) {
            deliverMessage({ account: "core", target: discord.target, message: formatAcceptAssignMessage(createdJob), label: "accept/assign" });
          }
        }
      }
      log("job created:", event.jobId, `(row ${createdJob ? createdJob.id : "?"})`);
      break;
    }
    case "spawn_result": {
      const job = db.findJobByToolCallId(database, event.toolCallId);
      if (!job) return;
      const assignedAgent = event.childSessionKey.split(":")[1];
      db.markJobInProgress(database, job.id, {
        assignedAgent,
        childSessionKey: event.childSessionKey,
        runId: event.runId,
      });
      const childFile = findChildSessionFile(event.childSessionKey);
      if (childFile) watchedFiles.set(childFile, { agentId: assignedAgent, sessionId: event.childSessionKey.split(":").pop() });
      log("job in_progress:", job.job_id, `(row ${job.id})`, "->", event.childSessionKey);
      if (job.requester_channel && isRecent(job.created_at)) {
        deliverMessage({
          account: assignedAgent,
          target: job.requester_channel,
          message: formatSpecialistAcceptMessage({ ...job, assigned_agent: assignedAgent }),
          label: "specialist-accept",
        });
      }
      break;
    }
    case "spawn_rejected": {
      const job = db.findJobByToolCallId(database, event.toolCallId);
      if (job && job.status === "created") db.markJobFailed(database, job.id, `spawn rejected: ${event.error}`);
      break;
    }
    case "usage": {
      const job = db.findJobByChildSessionKey(database, `agent:${agentId}:subagent:${sessionId}`);
      db.insertUsage(database, {
        jobRowId: job ? job.id : null,
        agentId,
        sessionKey,
        provider: event.provider,
        model: event.model,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cacheReadTokens: event.cacheReadTokens,
        cacheWriteTokens: event.cacheWriteTokens,
        costUsd: event.costUsd,
        timestamp: event.timestamp,
      });
      break;
    }
    case "final_assistant": {
      // Primary, reliable completion signal: CoreBot's OWN session never
      // gets cleaned up (unlike spawned children, which can be deleted
      // before we get a chance to tail them — cleanup:"delete" races even
      // fast polling). CoreBot's next terminal reply after a spawn+yield
      // is the completion relay for whichever job it was waiting on.
      const job =
        agentId === "core"
          ? db.findLatestInProgressJobByParentSession(database, sessionId)
          : db.findJobByChildSessionKey(database, `agent:${agentId}:subagent:${sessionId}`); // best-effort, if we win the race
      if (!job || job.status !== "in_progress") return; // avoid double-completion if both paths fire
      const totalCost = db.sumJobCost(database, job.id);
      const oneLiner = truncateOneLiner(event.text);
      db.completeJob(database, job.id, oneLiner);
      log("job completed:", job.job_id, `(row ${job.id})`, `$${totalCost.toFixed(4)}`);
      if (!job.requester_channel) {
        log("job", job.job_id, "has no requester channel (non-Discord session) — skipping delivery");
      } else if (!isRecent(job.created_at)) {
        log("job", job.job_id, "is backfilled history (age", Math.round((Date.now() - new Date(job.created_at).getTime()) / 1000), "s) — recorded but not delivering live");
      } else {
        // Posted as the specialist's own Discord identity, not CoreBot —
        // that's the whole point of "visible delegation" (Stage 6).
        deliverMessage({
          account: job.assigned_agent || job.requester_account,
          target: job.requester_channel,
          message: formatCompletionMessage(job.job_id, oneLiner, totalCost),
          label: "completion",
        });
      }
      break;
    }
  }
}

function tailFile(filePath, agentId) {
  const { lines, newOffset } = readNewLines(filePath);
  if (newOffset === null) {
    watchedFiles.delete(filePath); // deleted (cleanup: delete) — stop watching
    return;
  }
  const sessionId = sessionFileToId(filePath);
  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const events = parseLine(obj);
    for (const event of events) processEvent(agentId, sessionId, event);
  }
  if (newOffset !== db.getTailOffset(database, filePath)) db.setTailOffset(database, filePath, newOffset);
}

function rescanAndTailAll() {
  const now = Date.now();
  if (now - lastRescan > RESCAN_MS) {
    sessionKeyIndex = loadSessionKeyIndex();
    for (const { agentId, filePath } of listSessionFiles()) {
      if (!watchedFiles.has(filePath)) watchedFiles.set(filePath, { agentId, sessionId: sessionFileToId(filePath) });
    }
    lastRescan = now;
  }
  for (const [filePath, meta] of watchedFiles) {
    tailFile(filePath, meta.agentId);
  }
}

// Best-effort fast path: watch each agent's session dir with inotify so a
// short-lived child session (created, written, and deleted under
// cleanup:"delete" — sometimes within one poll interval) has the best
// realistic chance of being read before it's gone. The 500ms poll loop
// above is the reliability fallback if a watch event is missed.
function watchAgentDirs() {
  let agentIds;
  try {
    agentIds = fs.readdirSync(AGENTS_DIR);
  } catch {
    return;
  }
  for (const agentId of agentIds) {
    const dir = path.join(AGENTS_DIR, agentId, "sessions");
    if (!fs.existsSync(dir)) continue;
    try {
      fs.watch(dir, (eventType, filename) => {
        if (!filename || !filename.endsWith(".jsonl") || filename.includes("trajectory")) return;
        const filePath = path.join(dir, filename);
        if (!watchedFiles.has(filePath)) watchedFiles.set(filePath, { agentId, sessionId: sessionFileToId(filePath) });
        tailFile(filePath, agentId);
      });
    } catch (e) {
      log("fs.watch failed for", dir, e.message);
    }
  }
}

log("OpenMT Work Registry daemon starting. DB:", DB_PATH);
rescanAndTailAll();
watchAgentDirs();
setInterval(rescanAndTailAll, POLL_MS);

process.on("SIGTERM", () => {
  log("shutting down");
  process.exit(0);
});
