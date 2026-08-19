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
| 5 | Job IDs + Work Registry (includes the per-job cost ledger + `/usage` — see `docs/04-cost-and-token-discipline.md`) | ⬜ not started |
| 6 | Visible delegation in the server | ⬜ not started |
| 7+ | State machine, history, versioning, resume, leases, fallback, commands, queueing, security, self-change governance, backups | ⬜ not started |

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

### 9router fallback layer (2026-08-19) — CoreBot only, proven

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

**Only CoreBot is wired to it** (`agents.list[core].model` =
`ninerouter/openmt-tier-fallback`, added as a custom provider under
`models.providers.ninerouter` in `openclaw.json`). Verified 2026-08-19: a
direct CLI turn and a live Discord message both answered correctly through
`ninerouter/openmt-tier-fallback`, resolving to the Tier 1 ChatGPT
subscription with no fallback needed. Rollback if 9router causes problems:
`openclaw config set 'agents.list[1].model' 'openai/gpt-5.6'` (CoreBot's
original direct OpenAI connection — index `1` in `agents.list`). The other
6 agents are untouched and still on their direct provider connections.

9router now runs as a systemd user service (`~/.config/systemd/user/9router.service`,
same pattern as `openclaw-gateway.service`: `Restart=always`, lingering
already enabled so it survives reboots and logouts without an active SSH
session). Verified 2026-08-19: service starts clean, the one-time
`better-sqlite3` install attempt runs harmlessly under `--ignore-scripts`
(no compile, exits on its own), and CoreBot answered correctly through it
end-to-end in Discord after the service came up. CoreBot still has no
automatic fallback to its old direct connection if 9router's service
itself is down — the rollback command above is the manual recovery path.

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
docs/
  01-server-setup.md              provision the Hetzner VPS + install OpenClaw on it
  02-discord-bots-setup.md        create the 7 bots + company server in Discord's Developer Portal
  03-provider-api-keys.md         get OpenAI / Anthropic / Google API keys
  04-cost-and-token-discipline.md deterministic-vs-model rules that keep API spend down
```

Each `agents/<id>/` folder holds the two files OpenClaw reads to build that
agent's identity: `SOUL.md` (who it is, its persona) and `AGENTS.md` (its
operating rules — what it owns, what it must never silently take on, and
its delegation rights). These get copied into
`~/.openclaw/workspace/<id>/` on the server during setup (confirmed live —
not `agents/<id>/workspace/` as earlier drafts of this README assumed).

## What to do next (you)

Stage 4 is done and all three provider issues are resolved — nothing is
blocked on you right now. Say the word when you want to start Stage 5
(Job IDs + Work Registry).
