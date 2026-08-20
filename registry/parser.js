// Pure parsing functions over OpenClaw session .jsonl lines.
// Confirmed shapes (2026-08-19, OpenClaw 2026.7.1-2) by inspecting live
// session files directly — see registry/README.md.

const JOB_ID_RE = /JOB ID:\s*(\S+)/;
// A generated-artifact reference an agent embeds in its own reply text,
// e.g. "...\n\nMEDIA:/home/OpenMT/.openclaw/media/tool-image-generation/foo---<uuid>.jpg"
// (confirmed live in real PictureBot session data, 2026-08-20). Only
// image_generate results carry this today — FileBot's document tool has
// never actually fired in any real session (checked), so there's nothing
// equivalent to look for there yet.
const MEDIA_RE = /MEDIA:(\S+)/;

function extractMediaPath(text) {
  const m = MEDIA_RE.exec(text || "");
  return m ? m[1] : null;
}

function parseJobId(jobId) {
  // Prefix can itself contain underscores (e.g. "core_cmds_001"), so split
  // on the LAST underscore-separated numeric segment, not the first.
  const m = /^(.+)_(\d+)$/.exec(jobId || "");
  if (!m) return { prefix: jobId || "unknown", seq: null };
  return { prefix: m[1], seq: parseInt(m[2], 10) };
}

// Returns an array of events for a single parsed JSONL line (object, not string).
function parseLine(obj) {
  const events = [];
  if (obj.type !== "message" || !obj.message) return events;
  const msg = obj.message;
  const timestamp = obj.timestamp || new Date().toISOString();

  // Assistant turn: may carry usage/cost, and may contain a sessions_spawn toolCall.
  if (msg.role === "assistant" && Array.isArray(msg.content)) {
    if (msg.usage && msg.usage.cost && typeof msg.usage.cost.total === "number") {
      events.push({
        type: "usage",
        provider: msg.provider,
        model: msg.model,
        inputTokens: msg.usage.input,
        outputTokens: msg.usage.output,
        cacheReadTokens: msg.usage.cacheRead,
        cacheWriteTokens: msg.usage.cacheWrite,
        costUsd: msg.usage.cost.total,
        timestamp,
      });
    }

    const toolCalls = msg.content.filter((c) => c && c.type === "toolCall");
    for (const tc of toolCalls) {
      if (tc.name === "sessions_spawn" && tc.arguments) {
        const task = tc.arguments.task || "";
        const jobIdMatch = JOB_ID_RE.exec(task);
        if (jobIdMatch) {
          const { prefix, seq } = parseJobId(jobIdMatch[1]);
          events.push({
            type: "spawn_call",
            toolCallId: tc.id,
            jobId: jobIdMatch[1],
            prefix,
            seq,
            agentId: tc.arguments.agentId,
            taskType: extractField(task, "TASK TYPE"),
            userRequest: extractField(task, "USER REQUEST"),
            objective: extractField(task, "OBJECTIVE"),
            timestamp,
          });
        }
      }
    }

    // A terminal assistant reply: has content but no toolCall (plain text/final answer).
    if (toolCalls.length === 0 && msg.stopReason && msg.stopReason !== "toolUse") {
      const textParts = msg.content.filter((c) => c && c.type === "text").map((c) => c.text);
      if (textParts.length > 0) {
        events.push({ type: "final_assistant", text: textParts.join("\n"), timestamp });
      }
    }
  }

  // Tool result for a sessions_spawn call: carries the childSessionKey on
  // success. A call can also be rejected (e.g. missing agentId) — in that
  // case CoreBot typically recovers by handling the request directly, and
  // the job never reaches in_progress.
  if (msg.role === "toolResult" && msg.toolName === "sessions_spawn") {
    if (msg.details && msg.details.status === "accepted") {
      events.push({
        type: "spawn_result",
        toolCallId: msg.toolCallId,
        childSessionKey: msg.details.childSessionKey,
        runId: msg.details.runId,
        resolvedProvider: msg.details.resolvedProvider,
        resolvedModel: msg.details.resolvedModel,
        timestamp,
      });
    } else if (msg.isError) {
      events.push({
        type: "spawn_rejected",
        toolCallId: msg.toolCallId,
        error: msg.details && msg.details.error,
        timestamp,
      });
    }
  }

  // Original inbound user request to a top-level (non-subagent) session —
  // used to capture where a job's completion should be delivered back to.
  if (msg.role === "user" && typeof msg.content === "string") {
    events.push({ type: "user_message", timestamp });
  }

  return events;
}

// Extract a single-line field like "TASK TYPE: Quick DCF valuation" from the task packet text.
function extractField(task, label) {
  const re = new RegExp(`${label}:\\s*(.+)`);
  const m = re.exec(task);
  if (!m) return null;
  return m[1].replace(/^"|"$/g, "").trim();
}

module.exports = { parseLine, parseJobId, extractField, extractMediaPath };
