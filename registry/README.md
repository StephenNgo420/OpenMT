# OpenMT Work Registry (Stages 5, 6 & 7)

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

## Stage 7 (2026-08-20): state machine + history, crash recovery, backups

Three pieces added on top of the Stage 5/6 daemon, no changes to the
event parser or the visible-delegation pipeline itself:

**State machine + history.** Every status transition (`created` →
`in_progress` → `completed`/`failed`/`orphaned`) is now logged to a new
`job_events` table (`job_row_id, from_status, to_status, note,
timestamp`) via a single `db.recordEvent()` helper called from every
function that mutates `jobs.status`. `jobs.status` itself is unchanged as
the fast-path current-state column — `job_events` is purely additive
history, queryable with `db.jobHistory(db, rowId)`. Existing (pre-Stage-7)
jobs have no history rows, since they were never re-processed — only new
transitions get logged going forward.

**Crash recovery.** Two real gaps, closed:

1. *Daemon downtime causing missed Discord notifications.* The old
   Stage 6 logic delivered a live message only if a job was created within
   a fixed 5-minute wall-clock window — correct for the cold-start backfill
   case it was built for, but wrong for a real outage: anything that
   finished more than 5 minutes into a longer outage would get recorded in
   the DB but never actually delivered to Discord. Replaced with a
   heartbeat: the daemon writes `last_heartbeat_at` to a new `daemon_state`
   key/value table every 10s and once more on clean shutdown (SIGTERM/
   SIGINT). On startup it reads the *previous* run's last heartbeat and
   uses it as a fixed cutoff for the rest of that process's life — anything
   at/before it is backfill (recorded, not redelivered); anything after it
   gets delivered, however long the daemon was actually down. A clean
   restart (deploy, manual restart) writes a fresh heartbeat right before
   exiting, so the next boot's catch-up window is ~0 — only a real crash
   (no time to run the shutdown handler) leaves a stale heartbeat and
   triggers genuine catch-up delivery. Verified live: a normal
   `systemctl --user restart` produced a cutoff essentially equal to "now",
   not a stale one.
2. *Jobs the pipeline loses track of.* A specialist session can die, or
   the daemon can restart mid-job, leaving a job stuck in `created` or
   `in_progress` forever with nothing left to ever generate a completion
   event. A new sweep (`sweepStaleJobs`, every 60s) finds jobs older than
   `STALE_JOB_MS` (20 min, tunable) still sitting in those states, marks
   them `orphaned` (a new terminal-but-uncertain status — distinct from
   `failed`, since the real outcome is unknown) with a `job_events` row,
   and — only if the job is "recent" by the same heartbeat-cutoff logic —
   posts a `⚠️` notice so the owner isn't left silently wondering. Verified
   live against two genuinely stuck jobs left over from 2026-08-18 testing
   (`mkt_001`, `coding_001` — pre-dating the cost-capture investigation
   that explains why child sessions vanish before completion is ever
   observed): both got swept, marked `orphaned`, logged to `job_events`,
   and correctly did **not** trigger a live Discord notification, since
   they're old backfill relative to the heartbeat cutoff, not something
   that happened during this process's life.

**Backups.** `backup.js` — a oneshot script, not part of the daemon — run
daily by `openmt-backup.timer` (systemd user timer, `OnCalendar=daily`,
`Persistent=true` so a missed run due to downtime still fires on next
boot) via `openmt-backup.service`. Backs up two things nothing else
protects:
- The registry SQLite DB, via `DatabaseSync(..., {readOnly:true}).serialize()`
  — a consistent point-in-time snapshot safe to take while the daemon has
  the same file open in WAL mode (verified live, no lock conflicts).
- `openclaw.json` (live routing/model config + provider credentials) — not
  in git by design, so this is its only backup; recoverable now beyond
  just the dry-run discipline already practiced for config changes.

Both land in `~/openmt-backups/<timestamp>/`, mode `0700`. Retention:
last 14 daily backups kept (`OPENMT_BACKUP_RETENTION`), oldest pruned
automatically. Verified live: `systemctl --user start
openmt-backup.service` produced a real snapshot, both files present,
readable back with a fresh `DatabaseSync` connection.

**Known limitation, unchanged from Stage 5:** per-job specialist cost
capture is still not reliably possible (see above) — this stage doesn't
touch that.

**Not covered by this stage** (closed in the follow-up pass below): a
formal retry mechanism, leases as an explicit field, or new Discord
commands surfacing `job_events`/history.

## Stage 7 continued (2026-08-20): leases, `/retry`, `/history`

- **`lease_expires_at`** — new column on `jobs`, set at creation and reset
  when a job enters `in_progress`. The stale-job sweep now queries
  `db.findExpiredLeases()` directly instead of recomputing staleness from
  `created_at` + a constant. Same default duration as before
  (`db.DEFAULT_LEASE_MS`, 20 min) — this is a formalization, not a
  behavior change, but it means a future per-job-type lease duration
  wouldn't need a schema change, and `SELECT job_id, lease_expires_at
  FROM jobs WHERE status='in_progress'` now tells you directly when each
  open job will be swept.
- **`artifact_path`** — new column on `jobs`. When a `final_assistant`
  event's text contains a `MEDIA:<path>` reference (confirmed live format
  for `image_generate` results — `~/.openclaw/media/tool-image-generation/
  <slug>---<uuid>.<ext>`), the daemon captures it onto the job row;
  surfaced in `/usage job <id>` as an `Artifact:` line. Best-effort, same
  underlying race as specialist cost capture (see above) — reliable when
  the event we're reading is the one that actually carried the
  `MEDIA:` line, not guaranteed for a delegated child session that gets
  cleaned up first. This is deliberately just artifact *capture*, not
  versioning — see the main README's Stage 7 section for why full
  versioning wasn't built (no signal yet for "this is a new revision of
  that artifact", even now that FileBot can actually produce files — see
  the main README's "FileBot fixed" section).
- **`work_registry_job_history`** (MCP tool) — reads `job_events` for a
  job ID, formatted by `job-commands.js`'s `formatJobHistory`. Backs a new
  `/history <job id>` command in `agents/core/AGENTS.md`, relayed verbatim
  like `/usage`.
- **`work_registry_get_retry_data`** (MCP tool) — for a `failed`/`orphaned`
  job, returns its original TASK TYPE/USER REQUEST/OBJECTIVE and assigned
  specialist so CoreBot can re-issue it via `sessions_spawn` with a fresh
  job ID; for any other status, returns an explanation instead (CoreBot is
  instructed not to delegate anything in that case). The registry itself
  never delegates — only CoreBot can decide to redispatch work, so
  `/retry` is CoreBot doing its normal thing, re-triggered with the
  original packet. **Verified live, full loop**: `/retry coding_001`
  (orphaned from the crash-recovery test) → CoreBot pulled the packet →
  spawned `coding_002` to CodingBot with the identical request → tracked
  through the full state machine with real `job_events`/lease/all three
  Discord messages, exactly like any other delegation.
- **Fallback**: already covered by 9router (2026-08-19), nothing new here.
- **Queueing**: not built — current design is synchronous/single-delegator
  with no contention to solve; explicitly deferred until there's a real
  need (future multi-user support), not built against a hypothetical.

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
- `job-commands.js` — deterministic text formatting for `/history` and
  `/retry` (task-packet extraction for the latter).
- `mcp-server.js` — the MCP server exposing `work_registry_query_usage`,
  `work_registry_job_history`, and `work_registry_get_retry_data`
  (stdio transport, spawned by OpenClaw per `mcp.servers` config).
- `test-replay.js` — offline test harness; replays real session files
  already on disk through the parser (no live agent calls needed).
- `backup.js` — oneshot Stage 7 backup script (registry DB + openclaw.json),
  run by `openmt-backup.timer`/`.service`, not the long-running daemon.

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
