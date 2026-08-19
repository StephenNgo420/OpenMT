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
| 5 | Job IDs + Work Registry (includes the per-job cost ledger + `/usage` — see `docs/04-cost-and-token-discipline.md`) | 🟡 in progress — daemon built and verified against real live data (job lifecycle, completion detection, zero-LLM Discord delivery). Per-job specialist cost capture has a known limitation — see `registry/README.md`. Not yet a systemd service; `/usage` MCP tool not yet built. |
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

Stage 4 is done, all three original provider issues are resolved, and the
9router fallback layer is live on all 7 agents — nothing is blocked on you
right now. Say the word when you want to start Stage 5 (Job IDs + Work
Registry).
