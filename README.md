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

- **This repository** — edited from a cloud session (or your own
  Claude Code / editor). It holds config, personas, and (later) the Work
  Registry code. Nothing here runs anything by itself.
- **A small Hetzner VPS** (decided on over a laptop or Raspberry Pi — see
  the setup guide for why) — where the OpenClaw *Gateway* actually runs,
  24/7, so the Discord bots stay online. Nobody can provision or SSH into
  that server from this cloud session — you (or a local Claude Code CLI
  you run yourself) have to execute the setup steps there. See
  `docs/01-server-setup.md`.

## Current status

| Stage | What | Status |
|---|---|---|
| 1 | Environment audit | ✅ done |
| 2 | Seven-agent architecture (config-as-code) | ✅ done |
| 3 | Bind each agent to its own Discord bot | ✅ done — all 7 bots created, wired, and confirmed responding live in Discord. Three non-obvious fixes were needed along the way (Discord plugin trust, `group:messaging` tool grant, per-account guild registration) — see the "Gotchas" section in `docs/02-discord-bots-setup.md` and the corrected `config/openclaw.config.template.json5`. OpenAI and Anthropic billing still need to be funded before CoreBot/FinanceBot/CodingBot/FileBot give real answers instead of billing errors — Google/Gemini funding status (PictureBot/MarBot/ResearchBot) unconfirmed. |
| 4 | CoreBot routing (direct vs. delegate) | ⬜ not started |
| 5 | Job IDs + Work Registry (includes the per-job cost ledger + `/usage` — see `docs/04-cost-and-token-discipline.md`) | ⬜ not started |
| 6 | Visible delegation in the server | ⬜ not started |
| 7+ | State machine, history, versioning, resume, leases, fallback, commands, queueing, security, self-change governance, backups | ⬜ not started |

We are deliberately not building stages 5+ until 2–4 work end-to-end with
real Discord messages, per the project's own "don't overcomplicate the
MVP" rule.

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

1. **Fund OpenAI and Anthropic billing** — CoreBot (OpenAI) and FinanceBot/CodingBot/FileBot (Anthropic) are fully wired but currently reply with billing errors instead of real answers. `docs/03-provider-api-keys.md` covers where to add a payment method.
2. Check whether Google/Gemini needs the same — try `@PictureBot`, `@MarBot`, or `@ResearchBot` in the server and see whether they respond normally or also show a billing error.

Once providers are funded, we'll move to Stage 4 — CoreBot actually
deciding whether to handle a request directly or delegate it.
