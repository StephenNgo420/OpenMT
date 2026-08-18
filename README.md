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

### Server memory discipline (2026-08-18)

The Hetzner VPS this all runs on has 2GB RAM and no swap. A background
script that tried to test multiple specialist agents in parallel via
`sessions_spawn` OOM-killed the Claude Code process and some `node`
processes mid-session. The gateway is a systemd user service and restarted
itself cleanly, but the lesson: **test agents one at a time, in the
foreground, never via a parallel/background sweep script.** A single
`openclaw agent --agent <id> --message "..."` call is cheap enough (the
gateway process gained ~50-70MB RSS per call, not cumulative); running
several concurrently is what caused the crash.

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
