#!/usr/bin/env node
// MCP server exposing the Work Registry's usage query as one tool.
// Read-only against registry.sqlite (the daemon, a separate process, owns
// all writes). No LLM calls happen inside this tool — it's a pure SQL
// read + deterministic text formatting; the calling agent's only job is
// to relay the output verbatim (see agents/core/AGENTS.md).
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const db = require("./db");
const { formatUsageReport } = require("./usage-format");

const DB_PATH = process.env.REGISTRY_DB_PATH || "/home/OpenMT/OpenMT/registry/registry.sqlite";
const database = db.openDb(DB_PATH);

const server = new McpServer({ name: "openmt-work-registry", version: "1.0.0" });

server.registerTool(
  "work_registry_query_usage",
  {
    title: "Query OpenMT usage/spend",
    description:
      "Reads the Work Registry's cost ledger and returns a preformatted, " +
      "already-correct usage report. Relay the returned text verbatim — " +
      "do not recompute, reformat, or add commentary to the numbers.",
    inputSchema: {
      scope: z.enum(["today", "month", "job", "agent"]).describe(
        "today/month: spend by agent+provider for that window. job: a specific job's total cost (needs filter=job id). agent: one agent's spend this month (needs filter=agent id, e.g. finance)."
      ),
      filter: z.string().optional().describe("job id (scope=job) or agent id (scope=agent)"),
    },
  },
  async ({ scope, filter }) => ({
    content: [{ type: "text", text: formatUsageReport(database, scope, filter) }],
  })
);

const transport = new StdioServerTransport();
server.connect(transport);
