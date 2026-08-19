// Deterministic text formatting for /usage — no LLM involved in computing
// or rendering any of these numbers (docs/04-cost-and-token-discipline.md).
const db = require("./db");

const DISPLAY_NAMES = {
  core: "CoreBot", finance: "FinanceBot", picture: "PictureBot", coding: "CodingBot",
  file: "FileBot", marketing: "MarBot", research: "ResearchBot", main: "main",
};

function displayName(agentId) {
  return DISPLAY_NAMES[agentId] || agentId;
}

function startOfTodayIso() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfMonthIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

function money(n) {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

function formatUsageReport(database, scope, filter) {
  if (scope === "job") {
    if (!filter) return "Usage: `job` scope requires a job ID, e.g. `/usage job finance_001`.";
    const job = db.findJobByLabel(database, filter);
    if (!job) return `No job found with ID "${filter}".`;
    const total = db.sumJobCost(database, job.id);
    return [
      `💰 USAGE — ${job.job_id}`,
      `Status: ${job.status}${job.assigned_agent ? ` (${displayName(job.assigned_agent)})` : ""}`,
      job.one_liner_summary ? job.one_liner_summary : "",
      `${money(total)} used`,
    ].filter(Boolean).join("\n");
  }

  if (scope === "agent") {
    if (!filter) return "Usage: `agent` scope requires an agent id, e.g. `/usage agent finance`.";
    const rows = db.usageForAgent(database, filter, startOfMonthIso());
    if (rows.length === 0) return `No usage recorded for ${displayName(filter)} this month.`;
    const lines = [`💰 USAGE — ${displayName(filter)}, this month`, ""];
    let total = 0;
    for (const r of rows) {
      lines.push(`${r.provider.padEnd(12)} ${money(r.total).padStart(10)}  (${r.calls} call${r.calls === 1 ? "" : "s"})`);
      total += r.total;
    }
    lines.push("", `Total: ${money(total)}`);
    return lines.join("\n");
  }

  const since = scope === "today" ? startOfTodayIso() : startOfMonthIso();
  const label = scope === "today" ? "today" : "this month";
  const rows = db.usageByAgentProvider(database, since);
  const totalRow = db.usageTotal(database, since);

  if (rows.length === 0) return `💰 USAGE — ${label}\n\nNo spend recorded yet.`;

  const lines = [`💰 USAGE — ${label}`, ""];
  for (const r of rows) {
    lines.push(`${displayName(r.agent_id).padEnd(14)} (${r.provider.padEnd(10)}) ${money(r.total).padStart(10)}  (${r.calls} call${r.calls === 1 ? "" : "s"})`);
  }
  lines.push("", `Total: ${money(totalRow.total)} across ${totalRow.calls} call${totalRow.calls === 1 ? "" : "s"}`);
  return lines.join("\n");
}

module.exports = { formatUsageReport, displayName };
