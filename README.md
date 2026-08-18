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
| 4 | CoreBot routing (direct vs. delegate) | 🟡 in progress — CoreBot now delegates via OpenClaw's native `sessions_spawn` sub-agent mechanism: `agents.defaults.subagents.requireAgentId=true` plus a per-agent `allowAgents` list enforces the responsibility registry in `agents/core/AGENTS.md` at the config level (not just in prose). CoreBot's own `image_generate`/`video_generate` tools are denied (`agents.list[core].tools.deny`) so it structurally can't silently do PictureBot's job instead of delegating — that gap was found and fixed by live testing. Verified: direct math question answered directly (no delegation); image-generation request correctly spawned a PictureBot sub-agent with a proper structured task packet. Not yet verified end-to-end for finance/coding/file (Anthropic) or actual image output (Google) — see the two live provider issues below. |
| 5 | Job IDs + Work Registry (includes the per-job cost ledger + `/usage` — see `docs/04-cost-and-token-discipline.md`) | ⬜ not started |
| 6 | Visible delegation in the server | ⬜ not started |
| 7+ | State machine, history, versioning, resume, leases, fallback, commands, queueing, security, self-change governance, backups | ⬜ not started |

We are deliberately not building stages 5+ until 2–4 work end-to-end with
real Discord messages, per the project's own "don't overcomplicate the
MVP" rule.

### Live provider issues found while testing (2026-08-18)

OpenAI billing (CoreBot) was unfunded as of the Stage 3 commit earlier
today; it's since been funded and is confirmed working (CoreBot answers
directly and uses `web_search` successfully). Two others remain, both
needing action in a provider console, not code:

- **Anthropic (FinanceBot/CodingBot/FileBot)**: API is returning
  `"Your credit balance is too low to access the Anthropic API"`.
  OpenClaw auto-disables that auth profile on a rolling 4-hour cooldown
  after each failed retry. Fix: add credits at
  console.anthropic.com → Plans & Billing.
- **Google (PictureBot's image generation specifically)**: actual image
  generation on `gemini-3.1-pro-preview` is hitting
  `Quota exceeded ... free_tier_input_token_count, limit: 0` — the free
  tier allows text chat on this model but not image generation. Text-only
  Gemini calls (MarBot, ResearchBot, PictureBot's own replies) are
  unaffected. Fix: enable billing on the Google Cloud project behind the
  AI Studio key (docs/03-provider-api-keys.md already flagged this as a
  possibility), or point PictureBot at a Flash-tier model that has free
  image-gen quota, if one exists.

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

1. Top up Anthropic credits and check the Google Cloud project's billing
   for image generation — see the live provider issues above. Nothing
   else in Stage 4 is blocked on you right now.
