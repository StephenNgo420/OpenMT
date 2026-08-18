# OpenMT — an AI company running on OpenClaw + Telegram

This repo is the **source of truth** for a persistent, multi-agent "AI company"
that lives in a Telegram group. One manager bot (CoreBot) receives requests,
routes them to specialist bots (FinanceBot, PictureBot, CodingBot, FileBot,
MarBot, ResearchBot), and everything is visible in the group chat as it
happens.

It is built on [OpenClaw](https://github.com/openclaw/openclaw), a self-hosted
personal-AI-assistant Gateway. OpenClaw already provides the pieces we need
for the *agent* layer (per-agent identity, workspace, model, Telegram
bindings, controlled sub-agent delegation). What OpenClaw does **not**
provide — and what this repo adds on top — is the *company* layer: a
persistent Work Registry, job IDs, a formal job state machine, artifact
versioning, execution leases, fallback/failback, and change-risk governance
for self-modification. Those are described in full in the original project
brief; we are building them incrementally.

## Two machines, one repo

Important, because it's easy to get confused:

- **This repository** — edited from a cloud session (or your laptop's
  Claude Code / editor). It holds config, personas, and (later) the Work
  Registry code. Nothing here runs anything by itself.
- **Your laptop** — where the OpenClaw *Gateway* actually runs, 24/7, so the
  Telegram bots stay online. That process has to live somewhere that stays
  powered on and connected. Nobody can install software on your laptop from
  a cloud session — you (or a local Claude Code CLI you run yourself) have
  to execute the setup steps there. See `docs/01-laptop-setup.md`.

## Current status

| Stage | What | Status |
|---|---|---|
| 1 | Environment audit | ✅ done |
| 2 | Seven-agent architecture (config-as-code) | 🟡 in progress |
| 3 | Bind each agent to its own Telegram bot | ⬜ blocked on you creating bots — see `docs/02-telegram-bots-setup.md` |
| 4 | CoreBot routing (direct vs. delegate) | ⬜ not started |
| 5 | Job IDs + Work Registry | ⬜ not started |
| 6 | Visible delegation in the group | ⬜ not started |
| 7+ | State machine, history, versioning, resume, leases, fallback, commands, queueing, security, self-change governance, backups | ⬜ not started |

We are deliberately not building stages 5+ until 2–4 work end-to-end with
real Telegram messages, per the project's own "don't overcomplicate the
MVP" rule.

## Repo layout

```
config/
  openclaw.config.template.json5   agent + model + Telegram roster (template — no real secrets)
agents/
  core/       CoreBot   — manager, direct specialist, fallback executor (model: ChatGPT)
  finance/    FinanceBot — DCF & financial analysis (model: Claude)
  picture/    PictureBot — image generation/editing (model: Gemini)
  coding/     CodingBot  — software + controlled internal systems engineer (model: Claude)
  file/       FileBot    — Word/Excel/PowerPoint creation & editing (model: Claude)
  marketing/  MarBot     — marketing/content/events (model: Gemini)
  research/   ResearchBot — quick web search & data gathering (model: Gemini)
docs/
  01-laptop-setup.md              install OpenClaw on your machine
  02-telegram-bots-setup.md       create the 7 bots + company group in BotFather
  03-provider-api-keys.md         get OpenAI / Anthropic / Google API keys
  04-cost-and-token-discipline.md deterministic-vs-model rules that keep API spend down
```

Each `agents/<id>/` folder holds the two files OpenClaw reads to build that
agent's identity: `SOUL.md` (who it is, its persona) and `AGENTS.md` (its
operating rules — what it owns, what it must never silently take on, and
its delegation rights). These get copied into
`~/.openclaw/agents/<id>/workspace/` on your laptop during setup.

## What to do next (you)

Three things, in any order, none of which need any code from me:

1. **Get 3 API keys** (OpenAI, Anthropic, Google) — `docs/03-provider-api-keys.md`.
2. **Create 7 Telegram bots + 1 group** via @BotFather — `docs/02-telegram-bots-setup.md`.
3. **Install OpenClaw on your laptop** — `docs/01-laptop-setup.md`.

Once you've done those, come back and we'll wire the real tokens/keys into
the config and get CoreBot actually live in the group (Stage 3).
