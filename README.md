# OpenMT — an AI company running on OpenClaw + Discord

This repo is the **source of truth** for a persistent, multi-agent "AI company"
that lives in a Discord server. One manager bot (CoreBot) receives requests,
routes them to specialist bots (FinanceBot, PictureBot, CodingBot, FileBot,
MarBot, ResearchBot), and everything is visible in the server's chat as it
happens.

(Originally planned around Telegram — switched to Discord before any
Telegram-specific work was actually built, so nothing was lost in the
change. See the commit history if curious.)

It is built on [OpenClaw](https://github.com/openclaw/openclaw), a self-hosted
personal-AI-assistant Gateway. OpenClaw already provides the pieces we need
for the *agent* layer (per-agent identity, workspace, model, Discord
bindings, controlled sub-agent delegation). What OpenClaw does **not**
provide — and what this repo adds on top — is the *company* layer: a
persistent Work Registry, job IDs, a formal job state machine, artifact
versioning, execution leases, fallback/failback, and change-risk governance
for self-modification. Those are described in full in the original project
brief; we are building them incrementally.

## Two machines, one repo

Important, because it's easy to get confused:

- **This repository** — holds config, personas, and (later) the Work
  Registry code. Nothing here runs anything by itself.
- **A small Hetzner VPS** (decided on over a laptop or Raspberry Pi — see
  the setup guide for why) — where the OpenClaw *Gateway* actually runs,
  24/7, so the Discord bots stay online. As of Stage 4, Claude Code runs
  directly on this VPS (this repo is cloned there too) with real shell
  access to `openclaw`, so config edits, gateway restarts, and Discord
  testing now happen live on the server itself rather than being relayed
  through chat. See `docs/01-server-setup.md` for how it was provisioned.

## Current status

| Stage | What | Status |
|---|---|---|
| 1 | Environment audit | ✅ done |
| 2 | Seven-agent architecture (config-as-code) | ✅ done |
| 3 | Bind each agent to its own Discord bot | ✅ done — all 7 bots created, wired, and confirmed responding live in Discord. Three non-obvious fixes were needed along the way (Discord plugin trust, `group:messaging` tool grant, per-account guild registration) — see the "Gotchas" section in `docs/02-discord-bots-setup.md` and `config/openclaw.config.template.json5`. |
| 4 | CoreBot routing (direct vs. delegate) | ✅ done — CoreBot delegates via OpenClaw's native `sessions_spawn` sub-agent mechanism: `agents.defaults.subagents.requireAgentId=true` plus a per-agent `allowAgents` list enforces the responsibility registry in `agents/core/AGENTS.md` at the config level (not just in prose). CoreBot's own `image_generate`/`video_generate` tools are denied (`agents.list[core].tools.deny`) so it structurally can't silently do PictureBot's job instead of delegating — that gap was found and fixed by live testing. Verified 2026-08-18: direct math question answered directly (no delegation); a finance question correctly spawned a properly structured `sessions_spawn` job packet to FinanceBot end-to-end; direct provider checks confirm FinanceBot/CodingBot/FileBot (Anthropic) and PictureBot's actual image generation (Google) all now succeed — the two provider issues below are resolved. |
| 5 | Job IDs + Work Registry (includes the per-job cost ledger + `/usage` — see `docs/04-cost-and-token-discipline.md`) | ✅ core built and verified live — Work Registry daemon (`registry/`, systemd service `openmt-registry.service`) backs CoreBot's existing JOB ID convention with a real SQLite-backed lifecycle (created → in_progress → completed/failed), delivers deterministic zero-LLM completion messages to Discord, and exposes `/usage` via an MCP tool that CoreBot relays verbatim (no recomputation). Verified end-to-end: a live delegation, its completion message, and a live `/usage` request all landed correctly in Discord. **Known gap:** per-job specialist cost isn't reliably captured — see `registry/README.md` for why (confirmed not fixable via `cleanup: "keep"`). No budget enforcement yet (deliberately deferred — see docs/04). |
| 6 | Visible delegation in the server | ✅ done — the Work Registry daemon posts each delegation's full lifecycle visibly in Discord, as the actually-relevant bot identity at each step (not just CoreBot relaying): CoreBot's "✅ Accepted / assigning to X" → the specialist's own "👋 X here — starting" → the specialist's own completion message with cost and an owner mention. Verified live end-to-end. The owner mention is a fixed Discord user ID (`OWNER_DISCORD_ID` env var) rather than the actual per-message author — recovering the real requester's ID wasn't possible from any data source checked (session transcripts, sessions index, gateway logs), and for this single-owner project that's an acceptable simplification. |
| 7+ | State machine, history, versioning, resume, leases, fallback, commands, queueing, security, self-change governance, backups | 🟨 mostly done for a single-owner project — see the dated Stage 7 sections below (state machine/leases/retry/commands/backups, a security review, and the FileBot fix) for what shipped and why. Genuinely still open: artifact *versioning* specifically (chaining "this is a new revision of that prior file" — no signal for that exists yet, even now that FileBot can actually produce files), and any queueing/multi-tenancy work (explicitly deferred until there's a real second owner). |

We are deliberately not building stages 5+ until 2–4 work end-to-end with
real Discord messages, per the project's own "don't overcomplicate the
MVP" rule.

### Live provider issues found while testing (2026-08-18) — all resolved

OpenAI billing (CoreBot), Anthropic billing (FinanceBot/CodingBot/FileBot),
and Google quota (PictureBot's image generation) were all unfunded/blocked
at various points during Stage 3–4 testing today. All three are now
confirmed working via direct provider-level checks and, for finance, a
full CoreBot → `sessions_spawn` → FinanceBot round trip.

### Server memory discipline (2026-08-18, resolved 2026-08-19)

The Hetzner VPS originally ran with 2GB RAM and no swap. A background
script that tried to test multiple specialist agents in parallel via
`sessions_spawn` OOM-killed the Claude Code process and some `node`
processes mid-session. Lesson carried forward: **test agents one at a
time, in the foreground, never via a parallel/background sweep script.**
The server has since been resized to Hetzner's CPX22 (2 vCPU / 4GB RAM),
which gave real headroom back for running 9router alongside the gateway.

### 9router fallback layer (2026-08-19) — all 7 agents live

Added [9router](https://9router.com) as a local OpenAI-compatible proxy
(`http://127.0.0.1:20128/v1`, loopback-only, no tunnel) providing a 3-tier
fallback chain — combo `openmt-tier-fallback`:

1. **Tier 1 (subscription):** ChatGPT Plus/Pro (`cx/gpt-5.5`) → Claude
   Pro/Max (`cc/claude-sonnet-5`), connected via OAuth. Note: this uses
   Anthropic's official Claude Code OAuth client with `org:create_api_key`
   scope, which mints a real API key off the Pro/Max subscription — a
   known ToS gray area for routing subscription usage through a
   third-party proxy, accepted knowingly for this project.
2. **Tier 2 (paid API keys):** `openai/gpt-5.4` → `anthropic/claude-opus-4-8`
   → `gemini/gemini-3.1-pro-preview` — the same keys already used directly
   elsewhere in this config.
3. **Tier 3 (free):** `openrouter/google/gemma-4-31b-it:free`.

A pre-publish security audit of 9router (StationX, July 2026) found several
HIGH-severity issues — TLS verification disabled when forwarding to
providers, plaintext credential storage, a trivially-reversible admin
password derivation, and a `123456` default password granting real
sessions. Mitigated what's under our control: real dashboard password set
(`~/.openclaw/9router-dashboard-password.txt`, mode 600), bound to
127.0.0.1 only, no tunnel/remote-sharing enabled, `--skip-update` (no
unsigned auto-update), and a local patch to `hooks/sqliteRuntime.js` so it
never shells out to `node-gyp`/`cc1` to compile `better-sqlite3` from
source (uses Node's built-in `node:sqlite` instead — that native compile
was the direct trigger for an OOM on the pre-resize 2GB box). The
TLS-bypass and plaintext-storage issues are architectural to 9router
itself and not something we can fix from the outside — known, accepted
risk for this use case.

**CoreBot** was wired first as the test case (`agents.list[1].model` =
`ninerouter/openmt-tier-fallback`). Verified 2026-08-19: a direct CLI turn
and a live Discord message both answered correctly, resolving to the
Tier 1 ChatGPT subscription with no fallback needed.

Once CoreBot was proven, the same treatment was extended to the 5
text-only specialists, one at a time (config change → CLI test → live
Discord test → next agent), reusing the already-connected accounts —
no new OAuth/API keys needed. Two additional combos were added so each
agent's *original* model family stays first in its own fallback chain
(same principle as CoreBot's ChatGPT-first ordering, matching its
original direct OpenAI connection):

- **`openmt-tier-fallback-claude`** (`cc` → `cx` → `anthropic` →
  `openai` → `gemini` → `openrouter free`) — for the agents that were
  originally on `anthropic/claude-opus-4-8` direct.
- **`openmt-tier-fallback-gemini`** (`cc` → `cx` → `gemini` → `openai`
  → `anthropic` → `openrouter free`) — for the agents that were
  originally on `google/gemini-3.1-pro-preview` direct. (No Gemini
  subscription is connected, so Tier 1 here is the same as the Claude
  combo — Tier 2 is where the family match happens.)

All three combos are registered under `models.providers.ninerouter` in
`openclaw.json`. Current state, all verified live in Discord 2026-08-19:

| Agent | `agents.list` index | Now on | Was on (rollback value) |
|---|---|---|---|
| core | 1 | `ninerouter/openmt-tier-fallback` | `openai/gpt-5.6` |
| finance | 2 | `ninerouter/openmt-tier-fallback-claude` | `anthropic/claude-opus-4-8` |
| coding | 4 | `ninerouter/openmt-tier-fallback-claude` | `anthropic/claude-opus-4-8` |
| file | 5 | `ninerouter/openmt-tier-fallback-claude` | `anthropic/claude-opus-4-8` |
| marketing | 6 | `ninerouter/openmt-tier-fallback-gemini` | `google/gemini-3.1-pro-preview` |
| research | 7 | `ninerouter/openmt-tier-fallback-gemini` | `google/gemini-3.1-pro-preview` |
| picture | 3 | `ninerouter/openmt-tier-fallback-gemini` | `google/gemini-3.1-pro-preview` |

**All 7 agents are now on 9router.** Rollback pattern for any agent:
`openclaw config set 'agents.list[<index>].model' '<was-on value>'`.

**PictureBot investigation (2026-08-19)**: confirmed via OpenClaw's source
(`provider-capabilities-CYpG67go.js`, `openclaw-tools-KulZ1cdH.js`,
`runtime-Da0CzszU.js`) that `image_generate` is fully decoupled from an
agent's own `model` field — it resolves through a separate, config-wide
`agents.defaults.imageGenerationModel` (currently unset, so it
auto-discovers an image-capable provider from the whole config — the
direct Google connection, since `ninerouter`'s registered models aren't
declared image-capable and are never candidates). So changing PictureBot's
`model` only affects its text/tool-calling; image generation itself was
never at risk, confirmed by a real Discord image-generation request
completing correctly after the switch.

Side note on testing async tools: `image_generate` runs as a background
task — the tool call returns immediately ("wait for the completion
event"), and the actual image + final reply land later via a separate
callback. A one-shot `openclaw agent --deliver` CLI call can exit before
that callback arrives (shows as `deliveryStatus: suppressed`, not an
error) — the always-running gateway handles real Discord messages fine;
only the synthetic single-shot CLI test doesn't stick around for it.

**Gotcha found during this round**: `openclaw agent --deliver` with
`--reply-channel`/`--reply-to` overrides but no explicit `--reply-account`
falls back to whatever Discord account was last resolved on the gateway
for that channel, rather than the calling agent's own bound account
(`accountId: opts.replyAccountId ?? opts.accountId` in
`agent-command-ABV9I5el.js`). In practice this meant several of the initial
test messages above went out under **CodingBot's** identity regardless of
which agent actually generated the reply — the model routing itself was
correct, only the Discord identity was wrong. Fixed by always passing
`--reply-account <agentId>` explicitly; all 6 agents were re-tested with
the fix and confirmed showing under their own correct bot identity in
Discord. **Always pass `--reply-account` on any future CLI-driven
`--deliver` test.**

9router now runs as a systemd user service (`~/.config/systemd/user/9router.service`,
same pattern as `openclaw-gateway.service`: `Restart=always`, lingering
already enabled so it survives reboots and logouts without an active SSH
session). Verified 2026-08-19: service starts clean, the one-time
`better-sqlite3` install attempt runs harmlessly under `--ignore-scripts`
(no compile, exits on its own), and CoreBot answered correctly through it
end-to-end in Discord after the service came up. CoreBot still has no
automatic fallback to its old direct connection if 9router's service
itself is down — the rollback command above is the manual recovery path.

### Independent Codex review gate for CodingBot self-change (2026-08-19)

`agents/coding/AGENTS.md`'s 4-tier self-change risk system (LOW/MEDIUM/
HIGH/CRITICAL) had been "target design, not yet enforced" since Stage 1.
This is the first real enforcement of a piece of it: a new internal-only
agent, `codex-review`, gives an independent second opinion before any
HIGH or CRITICAL self-change operation reaches the owner for approval.
This does not replace the owner-approval requirement — it's an additional
gate. MEDIUM/LOW are unaffected.

**`codex-review`**: no Discord binding, never posts to the server, only
reachable via `sessions_spawn` and only by CodingBot
(`agents.list[coding].subagents.allowAgents = ["codex-review"]`, `[]`
before). Tools: `allow: ["read"]` only — no write/exec/`sessions_spawn`/
anything else, and `subagents.allowAgents: []` — it cannot commission
anyone, including CodingBot. Model: `ninerouter/openmt-codex-review`, a
new OpenAI-only 9router combo (`cx/gpt-5.6-sol` → `openai/gpt-5.4`,
deliberately never falling through to Claude/Gemini — the whole point is
a model family CodingBot doesn't share).

**Model-choice gotcha**: the actual OpenAI-branded "Codex" models
(`gpt-5.3-codex`, `gpt-5.3-codex-spark`) are hardcoded OAuth-only in
OpenClaw's provider code — confirmed by tracing `openai-provider-*.js`,
not guessed — so they can't be reached via a plain API key regardless of
config. Worse, `gpt-5.3-codex-spark` specifically also isn't usable on our
actual ChatGPT account tier (tested live, got a 400 rejecting it — a plan
limitation, separate from the OAuth-vs-API-key issue). `gpt-5.6-sol` is
the newest generation that actually works on this account via the
already-connected ChatGPT/Codex OAuth profile (the same one 9router's
Tier 1 uses) — a real independent OpenAI model, just not literally
branded "Codex."

**Governance-file conflict found and resolved**: both `agents/coding/
AGENTS.md` ("Loop prevention") and `agents/core/AGENTS.md` ("Delegation
boundaries") state, in two cross-referenced places, that specialists never
delegate directly to each other — everything routes through CoreBot. The
requested design (CodingBot → `codex-review` directly) conflicts with that
rule's letter, though not its spirit, since `codex-review` is a provably
loop-safe leaf. Resolved (owner's choice) with a narrow, explicitly-scoped
exception in both files: CodingBot may reach `codex-review` specifically,
for this specific gate, and nothing else about the no-direct-delegation
rule changed.

**Verified live**: a real (non-`--deliver`, foreground) test — "design a
plan to add a new Discord bot for a hypothetical LegalBot specialist,
dry run only" — correctly classified as HIGH, correctly dispatched to
`codex-review` via `sessions_spawn`, and codex-review returned a genuine
`CONCERNS` verdict with six specific, substantive points (underspecified
legal-safety boundaries, loose Discord permission scoping, vague
credential handling, incomplete rollback disposition, missing negative
tests) rather than rubber-stamping the design. CodingBot correctly
surfaced both views without resolving the disagreement itself, and
confirmed nothing was applied. Nothing about CoreBot or the other 5
production specialists changed — verified programmatically (config diff),
not just assumed.

### Stage 7: job state machine + history, crash recovery, backups (2026-08-20)

Added on top of the Stage 5/6 Work Registry daemon, no changes to the
event parser or the visible-delegation pipeline:

- **State machine + history**: every job status transition is now logged
  to a new `job_events` audit table (previously only the current status
  was kept). Full design and verification in `registry/README.md`.
- **Crash recovery**, two real gaps closed: (1) the old fixed 5-minute
  "is this live or backfill" window meant a real outage longer than 5
  minutes silently dropped Discord delivery for anything that finished
  during it — replaced with a heartbeat-based cutoff so a crash still
  gets a full, correct catch-up on restart, while a normal deploy/restart
  gets none (verified live, both cases); (2) a new 60-second sweep detects
  jobs stuck in `created`/`in_progress` with no completion signal for 20+
  minutes (specialist session died, daemon restarted mid-job) and marks
  them `orphaned` with an owner notice — verified live against two real
  jobs actually stuck since 2026-08-18 testing.
- **Backups**: a daily systemd timer (`openmt-backup.timer`, 14-day
  retention) snapshots the registry SQLite DB and `openclaw.json` (live
  config + credentials — not in git) to `~/openmt-backups/`. Verified
  live: a real backup ran, both files present and independently readable.

Everything here is additive to the existing daemon/schema — no agent,
model, or delegation config touched. Full detail: `registry/README.md`.

### Stage 7 continued: leases, retry, commands, and why versioning/queueing were scoped down (2026-08-20)

Closing out the rest of the Stage 7+ bucket, working through it one piece
at a time:

- **Leases, formalized**: the stale-job sweep above used to recompute
  staleness from `created_at` + a constant. Replaced with an explicit
  `lease_expires_at` column, set when a job is created and reset when it
  enters `in_progress` (so the clock starts when the specialist actually
  begins, not when the packet was written). The sweep just queries expired
  leases directly — same default duration (20 min) as before, but now a
  real, inspectable, per-job field instead of an implicit calculation.
- **Resume/retry, as a real `/retry <job id>` Discord command**: two new
  read-only MCP tools, `work_registry_job_history` (backs a new
  `/history <job id>` command — the state-machine history above is now
  actually visible, not just SQL-queryable) and `work_registry_get_retry_data`.
  On `/retry`, CoreBot fetches the failed/orphaned job's original task
  packet from the tool and re-delegates it verbatim via `sessions_spawn`
  with a fresh job ID — the registry has no delegation authority of its
  own (correctly — only an agent can decide to redispatch work), so retry
  is CoreBot doing what it already does, just re-triggered. **Verified
  live, full loop**: `/retry coding_001` (one of the two orphaned jobs
  from the crash-recovery test above) → CoreBot pulled the original
  packet → spawned `coding_002` to CodingBot with the same request →
  daemon tracked it through created → in_progress → completed with full
  `job_events` history and a real lease → all three visible-delegation
  Discord messages delivered correctly.
- **Fallback**: already substantively covered by the 9router 3-tier chain
  (2026-08-19) — nothing new needed here.
- **Artifact versioning — investigated, intentionally not built**: checked
  how each specialist that could produce a durable artifact actually
  delivers it, using real session data rather than assuming:
  - **PictureBot** does persist real files, at
    `~/.openclaw/media/tool-image-generation/<slug>---<uuid>.<ext>` — the
    daemon now captures this path onto the job row (`artifact_path`,
    surfaced in `/usage job <id>`) whenever it can see the `MEDIA:` line
    an image job's reply carries, on a best-effort basis (same underlying
    race as specialist cost capture — reliable for direct-mode sessions,
    not guaranteed for a delegated child session that gets cleaned up
    before we read it).
  - **FileBot** — its Word/Excel/PowerPoint generation tool has **never
    actually been called** in any real session on this deployment (zero
    tool calls across all its historical sessions). This means FileBot's
    core stated purpose may not actually be wired up yet — that's a real
    finding, separate from Stage 7, worth checking before relying on
    FileBot for anything. Filed here rather than silently worked around.
    **Fixed the same day** — see "FileBot fixed" further down.
  - **CodingBot** has no separate artifact concept — it edits this repo
    directly, and git already versions that.
  - Given one specialist's tool appears unbuilt and the other has no
    version-chaining signal yet (nothing today marks "this job is a new
    revision of that prior artifact" — would need a task-packet
    convention CoreBot doesn't have), building a general versioning
    scheme now would mean versioning a single specialist's output with no
    real chaining logic behind it. Captured the artifact link (real,
    useful on its own) and stopped there rather than build the rest on an
    unverified foundation.
- **Queueing — deliberately not built**: the current design is
  synchronous, single-delegator (CoreBot spawns and yields per request,
  no worker pool or backlog). There's no contention problem to solve for
  a single owner today. Confirmed with the owner this is about future
  multi-user support, not a current need — scoped down rather than built
  against a hypothetical, so nothing here should be read as multi-tenant-safe
  yet (the owner-mention delivery logic in particular is still
  single-owner-only, per Stage 6).

Nothing about `agents/coding/AGENTS.md`, the codex-review gate, or any
other agent's model/delegation config was touched by any of this — only
`registry/`, `agents/core/AGENTS.md` (new `/history`/`/retry` sections),
and this README.

### Security review (2026-08-20)

A real system-wide audit, not a diff review — secrets handling, file
permissions, network exposure, Discord bot permission scoping, and
whether anything in the original 9router risk-acceptance had regressed.

**Real finding, fixed**: `~/.9router/db/data.sqlite` — 9router's own
credential store (the OAuth tokens/API keys backing the whole 3-tier
fallback chain) — was **world-readable** (`644`). This is the most
serious finding of the review: on a compromised or shared box, any local
user could have read every provider credential 9router holds. Fixed
(`chmod 600`), and closed durably rather than just patched once:
`UMask=0077` added to `9router.service`, `openmt-registry.service`,
`openmt-backup.service`, and `openclaw-gateway.service` (all four
restarted live to apply it — verified all 7 Discord bots reconnected
cleanly afterward, including a real CoreBot round-trip test post-restart).

**Related findings, also fixed**: `registry/registry.sqlite` (job/usage
data, including verbatim user request text) and every OpenClaw agent
session `.jsonl` file under `~/.openclaw/agents/*/sessions/` (full
conversation transcripts, 60 files) were also `644`. Fixed retroactively
(one-time `chmod`) and durably: `registry/db.js`'s `openDb()` now
self-heals permissions to `600` on every daemon start regardless of what
created the file, and `backup.js` explicitly writes its DB snapshot at
`600` rather than relying on inherited/umask-derived permissions. Lower
severity than the 9router finding since this box currently has exactly
one local user account, but fixed anyway — defense in depth is cheap here
and the box's user population isn't a security boundary worth relying on.

**Checked, no issues found:**
- `openclaw.json` (real provider API keys, Discord bot tokens) was
  already `600` — correct, no action needed.
- No secrets in git history — scanned all commits for API-key-shaped
  strings and Discord token patterns; only the intended
  `${DISCORD_*_BOT_TOKEN}` env-var placeholders were found, never a real
  value. `.gitignore` correctly excludes `.env*`, `secrets/`,
  `*.local.json(5)`, `.openclaw/`, and `registry/*.sqlite*`.
- Network exposure: only SSH (22) is bound to a public interface. The
  OpenClaw gateway (18789) and 9router (20128) are both loopback-only —
  confirmed via `ss -tlnp`, no regression from how they were set up.
- 9router's dashboard still requires authentication (confirmed via a live
  unauthenticated API probe returning `401`) — the password set back in
  the 9router setup stage hasn't been reset or bypassed.
- `codex-review`'s tool restriction (`tools.allow: ["read"]`, no write/
  shell/delegation) is intact — re-verified directly against the live
  config, not assumed from memory.
- Discord bot OAuth2 scope, per `docs/02-discord-bots-setup.md`, is
  already least-privilege by design: `Send Messages`, `Read Message
  History`, `View Channels`, `Use Slash Commands` only — no admin/manage-
  server permissions requested for any of the 7 bots. (This checks the
  documented setup procedure; it doesn't re-verify the *live* Discord-side
  grant for each bot, which would need Discord's own admin API.)
- 9router's other previously-documented risks (TLS verification disabled
  to upstream providers, reversible admin password storage, unsigned
  auto-updates) are unchanged from the original risk acceptance
  (2026-08-19) — this review didn't find anything new there, and no
  world-readable CA key was found on this deployment (that specific
  StationX finding doesn't appear to apply to how we're using it —
  loopback-only, no local TLS interception in play).

No code changes beyond `registry/db.js` and `registry/backup.js` (the two
self-healing permission fixes) — everything else was file-permission and
systemd-unit remediation on the live host, not a repo change.

### FileBot fixed — it never had a way to actually generate a file (2026-08-20)

The Stage 7 artifact-versioning investigation (above) surfaced a real bug:
FileBot's core purpose — Word/Excel/PowerPoint creation — had **zero tool
calls in any real session ever**. Root cause, confirmed against the
installed OpenClaw tool catalog: there is no built-in document-generation
tool. `image_generate`/`video_generate`/`music_generate` exist natively;
nothing equivalent exists for office documents. FileBot's `AGENTS.md` had
always described *what* it owned, never *how* to actually produce
anything — so it had been silently unable to do its job since Stage 2.

Fixed with the same shape as PictureBot's real capability, minus the
native tool: three pure-JS libraries (`docx`, `exceljs`, `pptxgenjs` — no
native compilation, verified) installed at `filebot-tools/` in this repo;
`agents/file/TOOLS.md` (new) gives FileBot a concrete recipe — write a
scratch script inside `filebot-tools/` so `require()` resolves, generate
the file into `~/.openclaw/media/tool-document-generation/` (mirroring
PictureBot's own media-dir convention), verify it's real before calling
the job done, delete the scratch script, and reply with a `MEDIA:` line
so OpenClaw actually attaches it to the Discord message. `AGENTS.md` gets
a short pointer to it.

**Verified live, two full round trips, no assistance**: asked FileBot for
a real Word doc — it wrote the script, ran it, listed the output file to
confirm it existed, deleted the scratch script, and replied with a
correct `MEDIA:` line; the generated `.docx` parsed back as valid OOXML
with the right text inside. Asked for an Excel file with a `SUM` formula
specifically to test the trickiest Definition-of-Done requirement (live
formulas, not precomputed values) — the generated cell held a real
`{formula: "SUM(A1:A3)"}`, not a static `60`. Both deliveries confirmed
`succeeded: true` with a real `mediaUrl` in the delivery payload, not
just posted text.

`npm audit` flags 4 DoS-class (infinite-loop-on-malformed-input)
vulnerabilities in transitive deps (`image-size` via `pptxgenjs`, `uuid`
via `exceljs`) — accepted rather than force breaking downgrades, since
this only ever parses content FileBot itself generates or the owner
explicitly supplies, never arbitrary untrusted input, and nothing here is
network-exposed.

## Repo layout

```
config/
  openclaw.config.template.json5   agent + model + Discord roster (template — no real secrets)
agents/
  core/       CoreBot   — manager, direct specialist, fallback executor (model: ChatGPT)
  finance/    FinanceBot — DCF & financial analysis (model: Claude)
  picture/    PictureBot — image generation/editing (model: Gemini)
  coding/     CodingBot  — software + controlled internal systems engineer (model: Claude)
  file/       FileBot    — Word/Excel/PowerPoint creation & editing (model: Claude)
  marketing/  MarBot     — marketing/content/events (model: Gemini)
  research/   ResearchBot — quick web search & data gathering (model: Gemini)
  codex-review/  internal-only — independent HIGH/CRITICAL review gate for
                 CodingBot's self-change work (model: OpenAI, no Discord bot)
docs/
  01-server-setup.md              provision the Hetzner VPS + install OpenClaw on it
  02-discord-bots-setup.md        create the 7 bots + company server in Discord's Developer Portal
  03-provider-api-keys.md         get OpenAI / Anthropic / Google API keys
  04-cost-and-token-discipline.md deterministic-vs-model rules that keep API spend down
registry/                         Stages 5-7: Work Registry daemon, MCP /usage tool, backups — see registry/README.md
filebot-tools/                    Node libraries (docx/exceljs/pptxgenjs) backing FileBot's actual document generation — see agents/file/TOOLS.md
```

Each `agents/<id>/` folder holds the files OpenClaw reads to build that
agent's identity: `SOUL.md` (who it is, its persona), `AGENTS.md` (its
operating rules — what it owns, what it must never silently take on, and
its delegation rights), and, where an agent needs one, `TOOLS.md` (concrete
"how" instructions for something OpenClaw has no native tool for — so far
just FileBot). These get copied into `~/.openclaw/workspace/<id>/` on the
server during setup (confirmed live — not `agents/<id>/workspace/` as
earlier drafts of this README assumed).

## What to do next (you)

Stage 4 is done, all three original provider issues are resolved, and the
9router fallback layer is live on all 7 agents — nothing is blocked on you
right now. Say the word when you want to start Stage 5 (Job IDs + Work
Registry).
