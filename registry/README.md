# OpenMT Work Registry (Stages 5 & 6)

A small, purely-mechanical daemon that gives Job IDs and delegation a real
persistent backing (per `agents/core/AGENTS.md`'s note that they were
"illustrative, not yet backed by a database" until this stage), tracks
per-call cost against a Work Registry per
`docs/04-cost-and-token-discipline.md` (Stage 5), and makes each
delegation's full lifecycle visible in Discord as it happens (Stage 6).

No LLM calls happen anywhere in this daemon. It works entirely by tailing
OpenClaw's own session `.jsonl` files and reading data OpenClaw already
computes (per-turn token counts and dollar cost).

## Status (2026-08-19)

**Working, verified against real live data:**
- Job creation from CoreBot's `sessions_spawn` calls (parses `JOB ID:
  <id>` out of the task packet — zero changes needed to CoreBot's existing
  behavior).
- Call → result correlation via `tool_call_id` (survives daemon restarts,
  no in-memory state required).
- Rejected-spawn handling (CoreBot recovers by answering directly; job
  correctly marked `failed`, not left dangling).
- **Job completion detection** via CoreBot's own parent session's next
  terminal reply after a spawn+`sessions_yield` — this is the reliable
  signal (see "Known limitation" below for why the child session itself
  isn't).
- **Zero-LLM Discord delivery**, via `openclaw message send` (bypasses the
  agent/LLM entirely), of the **full visible-delegation pipeline (Stage
  6)**: CoreBot posts "✅ Accepted `job_id` — assigning to X" the moment a
  job is created; the specialist's *own* Discord identity posts "👋 X here
  — starting `job_id`" once the child session is confirmed; and the
  specialist's own identity posts the completion (result + cost),
  `@mention`-ing the project owner. Posting as the specialist rather than
  having CoreBot relay everything is the actual point of "visible
  delegation" — verified live end-to-end, all three messages, correct
  bots, correct order.
  - The owner mention (`OWNER_DISCORD_MENTION`, from `OWNER_DISCORD_ID` env
    var) is a **fixed** Discord user ID, not the real per-message
    requester — that ID isn't recoverable from any data source checked
    (session transcripts, sessions index, gateway logs). Fine for a
    single-owner project; would need real author-ID capture to generalize.
  - Each `openclaw message send` call has real CLI startup overhead
    (observed ~40s for the first message in a batch) — not instant, but
    correctly ordered once it lands.
- A safety guard (`LIVE_DELIVERY_WINDOW_MS`, applies to all three message
  types) so backfilling old session history on startup/restart never sends
  live Discord notifications for jobs that actually finished long ago —
  they're still recorded correctly in the DB, just not (re-)delivered.

**Known limitation — per-job specialist cost is not reliably captured.**
A spawned child session gets created, does its work, and is deleted
(`cleanup` param on `sessions_spawn`). Investigated properly (2026-08-19),
not just assumed:

1. `cleanup: "keep"` does **not** prevent deletion — verified twice with
   real jobs (`finance_registry_test_001`/`002`), file gone regardless of
   the param CoreBot actually passed. Not a config knob we control.
2. Polling (down to 500ms) and `fs.watch`/inotify (near-zero latency in
   principle) both lose the race — but it's not actually a *speed*
   problem: a controlled test confirmed `fs.watch` on the target directory
   fires **zero events** for a real child session's entire lifecycle, even
   though `fs.watch` itself works correctly on this filesystem (verified
   with a synthetic write/delete of our own). The file's externally
   observable window on disk is at or near zero — most likely an
   open-then-unlink pattern internal to OpenClaw's cleanup, not something
   any external polling/watching frequency can catch.
3. OpenClaw maintains a separate internal "subagent registry"
   (`resolveSubagentRegistryPath()` → `<state>/subagents/runs.json` in
   `subagent-registry-state-*.js`) that could plausibly retain data past
   session deletion — but it doesn't exist on disk on this deployment, so
   it's not an available data source either.

Completion messages currently show $0.00 for the specialist's actual work
even though it really did cost something. CoreBot's *own* routing cost
(the spawn/yield/relay turns, which live in CoreBot's own never-deleted
session) **is** captured correctly. A real fix would mean getting inside
OpenClaw's own process — a plugin/hook intercepting subagent completion
before cleanup runs — rather than external log-tailing. That's a
materially bigger project, out of scope here; parked, not being chased
further for now (see main README Stage 5/6 status).

**`/usage` — done.** MCP server (`mcp-server.js`) exposes one tool,
`work_registry_query_usage(scope, filter)`, registered in `openclaw.json`
under `mcp.servers.openmt-work-registry`. `agents/core/AGENTS.md` instructs
CoreBot to call it on any `/usage`-style request and relay the result
**verbatim** — the tool does 100% of the real computation (pure SQL read +
deterministic formatting in `usage-format.js`), CoreBot's cheap-tier LLM
call is routing only. Verified live: a real `/usage` message in Discord
returned the correct report.

**Running as a systemd service.** `openmt-registry.service`
(`~/.config/systemd/user/`), same `Restart=always` + lingering pattern as
`openclaw-gateway.service`/`9router.service`. DB lives at
`registry/registry.sqlite` (gitignored — operational data, not source).

## Files

- `db.js` — SQLite schema (`node:sqlite`, no native deps) + query helpers,
  including the `/usage` read queries (`usageByAgentProvider`, etc.).
- `parser.js` — pure functions parsing session `.jsonl` lines into events.
  No I/O, no state — fully unit-testable.
- `session-keys.js` — maps a session file's UUID back to its session key
  (e.g. `agent:core:discord:channel:X`) via each agent's `sessions.json`,
  to recover which Discord channel/account a job's parent request came
  in on.
- `daemon.js` — the long-running process: tails every agent's session
  files, correlates events, drives job lifecycle, delivers completions.
- `usage-format.js` — deterministic text formatting for `/usage` reports.
- `mcp-server.js` — the MCP server exposing `work_registry_query_usage`
  (stdio transport, spawned by OpenClaw per `mcp.servers` config).
- `test-replay.js` — offline test harness; replays real session files
  already on disk through the parser (no live agent calls needed).

## Running

```
node registry/daemon.js          # foreground; or: systemctl --user start openmt-registry.service
REGISTRY_DB_PATH=/path/to.sqlite OWNER_DISCORD_ID=123... node registry/daemon.js
```

`OWNER_DISCORD_ID` (numeric Discord user ID, no `<@>`) is optional — if
unset, completion messages just skip the mention rather than failing.

The MCP server (`mcp-server.js`) isn't run directly — OpenClaw spawns it
itself per the `mcp.servers` config entry when an agent needs it.

## Schema

See `db.js` for the authoritative definition. Key design note: `job_id`
(e.g. `"finance_001"`) is a **human-readable label, not a unique key** —
CoreBot generates it fresh per delegation with no persistent counter, and
real historical data collides (multiple unrelated `"finance_001"`s exist
from different nights). The true identity of a tracked spawn attempt is
the internal `jobs.id`, correlated via `tool_call_id` (unique per actual
`sessions_spawn` call) and `child_session_key` (unique per actual spawned
session).
