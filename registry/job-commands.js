// Deterministic formatting for the /history and /retry Discord commands
// (Stage 7). Same discipline as usage-format.js: pure SQL read + string
// formatting, no LLM involved in producing any of this text.
const db = require("./db");
const { displayName } = require("./usage-format");

const RETRYABLE_STATUSES = new Set(["failed", "orphaned"]);

function formatJobHistory(database, jobId) {
  if (!jobId) return "Usage: `/history <job id>`, e.g. `/history finance_001`.";
  const job = db.findJobByLabel(database, jobId);
  if (!job) return `No job found with ID "${jobId}".`;
  const events = db.jobHistory(database, job.id);
  const lines = [`📜 HISTORY — ${job.job_id}`, ""];
  if (events.length === 0) {
    lines.push("(no recorded transitions — this job predates Stage 7's history tracking)");
  } else {
    for (const e of events) {
      const arrow = e.from_status ? `${e.from_status} → ${e.to_status}` : e.to_status;
      lines.push(`${e.timestamp}  ${arrow}${e.note ? `  (${e.note})` : ""}`);
    }
  }
  lines.push("", `Current status: ${job.status}`);
  return lines.join("\n");
}

// Returns the stored task-packet fields for a job so CoreBot can re-issue
// a fresh sessions_spawn with the same content, rather than the registry
// (which has no delegation authority of its own) attempting to redispatch
// anything itself. CoreBot decides whether/how to act on this.
function formatJobForRetry(database, jobId) {
  if (!jobId) return "Usage: `/retry <job id>`, e.g. `/retry finance_001`.";
  const job = db.findJobByLabel(database, jobId);
  if (!job) return `No job found with ID "${jobId}".`;
  if (!RETRYABLE_STATUSES.has(job.status)) {
    return `\`${job.job_id}\` is ${job.status}, not failed/orphaned — nothing to retry. ${job.status === "completed" ? "It already finished." : "It's still open; wait for it to resolve first."}`;
  }
  return [
    `RETRY DATA for ${job.job_id} (original status: ${job.status})`,
    `SPECIALIST: ${displayName(job.prefix)} (agent id: ${job.assigned_agent || job.prefix})`,
    `TASK TYPE: ${job.task_type || "(none recorded)"}`,
    `USER REQUEST: ${job.user_request || "(none recorded)"}`,
    `OBJECTIVE: ${job.objective || "(none recorded)"}`,
    "",
    `Re-delegate this via sessions_spawn to the specialist above, with a fresh JOB ID and CONTEXT noting it's a retry of ${job.job_id}. Do not modify the original USER REQUEST/OBJECTIVE.`,
  ].join("\n");
}

module.exports = { formatJobHistory, formatJobForRetry };
