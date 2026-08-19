// Maps a session's file UUID back to its session KEY (e.g.
// "agent:core:discord:channel:958556503655198752") by reading each
// agent's sessions.json index. Used to recover which Discord
// channel/account a job's parent request came in on, since the session
// key encodes that — no need to parse Discord metadata out of message
// content.
const fs = require("node:fs");
const path = require("node:path");

const AGENTS_DIR = "/home/OpenMT/.openclaw/agents";

function loadSessionKeyIndex() {
  const index = new Map(); // sessionId -> { sessionKey, agentId }
  let agentIds;
  try {
    agentIds = fs.readdirSync(AGENTS_DIR);
  } catch {
    return index;
  }
  for (const agentId of agentIds) {
    const sessionsJsonPath = path.join(AGENTS_DIR, agentId, "sessions", "sessions.json");
    if (!fs.existsSync(sessionsJsonPath)) continue;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(sessionsJsonPath, "utf8"));
    } catch {
      continue;
    }
    for (const [sessionKey, meta] of Object.entries(data)) {
      if (meta && meta.sessionId) index.set(meta.sessionId, { sessionKey, agentId });
    }
  }
  return index;
}

// Parses "agent:core:discord:channel:958556503655198752" into channel/account.
function parseDiscordChannelFromKey(sessionKey) {
  const m = /^agent:([^:]+):discord:channel:(\d+)$/.exec(sessionKey || "");
  if (!m) return null;
  return { account: m[1], target: `channel:${m[2]}` };
}

module.exports = { loadSessionKeyIndex, parseDiscordChannelFromKey, AGENTS_DIR };
