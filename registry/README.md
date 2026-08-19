# OpenMT Work Registry (Stage 5)

A small, purely-mechanical daemon that gives Job IDs and delegation a real
persistent backing (per `agents/core/AGENTS.md`'s note that they were
"illustrative, not yet backed by a database" until this stage), and tracks
per-call cost against a Work Registry per
`docs/04-cost-and-token-discipline.md`.

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
- **Zero-LLM Discord delivery** of the completion message, via `openclaw
  message send` (bypasses the agent/LLM entirely).
- A safety guard (`LIVE_DELIVERY_WINDOW_MS`) so backfilling old session
  history on startup/restart never sends live Discord notifications for
  jobs that actually finished long ago — they're still recorded correctly
  in the DB, just not (re-)delivered.

**Known limitation — per-job specialist cost is not reliably captured.**
A spawned child session gets created, does its work, and is deleted
(`cleanup` param on `sessions_spawn`) — sometimes within one second.
Verified: this happens **even when CoreBot passes `cleanup: "keep"`**, so
it isn't a config knob under our control from the outside. Polling (tried
down to 500ms) and `fs.watch`/inotify (near-zero latency) both lose this
race for fast jobs. Completion messages currently show the true dollar
figure captured before the race was lost — often $0.00 for fast jobs, even
though the specialist really did cost something. CoreBot's *own* routing
cost (the spawn/yield/relay turns, which live in CoreBot's own
never-deleted session) **is** captured correctly. Fixing this properly
would need investigating what actually controls that deletion inside
OpenClaw's closed-source subagent lifecycle — out of scope for this pass.

## Files

- `db.js` — SQLite schema (`node:sqlite`, no native deps) + query helpers.
- `parser.js` — pure functions parsing session `.jsonl` lines into events.
  No I/O, no state — fully unit-testable.
- `session-keys.js` — maps a session file's UUID back to its session key
  (e.g. `agent:core:discord:channel:X`) via each agent's `sessions.json`,
  to recover which Discord channel/account a job's parent request came
  in on.
- `daemon.js` — the long-running process: tails every agent's session
  files, correlates events, drives job lifecycle, delivers completions.
- `test-replay.js` — offline test harness; replays real session files
  already on disk through the parser (no live agent calls needed).

## Running

```
node registry/daemon.js          # foreground
REGISTRY_DB_PATH=/path/to.sqlite node registry/daemon.js   # custom DB path
```

Not yet installed as a systemd service — do that (same `Restart=always` +
lingering pattern as `openclaw-gateway.service`/`9router.service`) before
relying on this for real, and before building the `/usage` MCP tool on
top of it (Stage 5 plan, step 3).

## Schema

See `db.js` for the authoritative definition. Key design note: `job_id`
(e.g. `"finance_001"`) is a **human-readable label, not a unique key** —
CoreBot generates it fresh per delegation with no persistent counter, and
real historical data collides (multiple unrelated `"finance_001"`s exist
from different nights). The true identity of a tracked spawn attempt is
the internal `jobs.id`, correlated via `tool_call_id` (unique per actual
`sessions_spawn` call) and `child_session_key` (unique per actual spawned
session).
