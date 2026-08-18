# 1. Install OpenClaw on your laptop

**What this is:** OpenClaw's "Gateway" is the program that actually stays
running, talks to Telegram, and calls the AI models. It has to run on a
machine that stays on — for a first test, your laptop is fine (just know
the bots go offline when your laptop sleeps or is closed; that's a known
limitation, not a bug, and we can move it to a small always-on server later
if you want 24/7 uptime).

You do not need to know how to code to do this — it's copy/pasting commands
into a terminal and reading what comes back. I'll tell you what each command
does and what "it worked" looks like.

## Step 1 — Open a terminal

- **Mac:** press `Cmd+Space`, type `Terminal`, hit Enter.
- **Windows:** press the Windows key, type `PowerShell`, hit Enter.
- **Linux:** you know how already.

## Step 2 — Check/install Node.js

OpenClaw needs Node.js version 22.22.3+ (or 24.15+, or 25.9+). Check what
you have:

```bash
node --version
```

- If it prints something like `v24.x.x` or higher and matches the ranges
  above, skip to Step 3.
- If it says "command not found" or the version is too old, install Node
  from **https://nodejs.org** (pick the current/LTS installer for your OS
  and run it like any other installer), then re-run `node --version` to
  confirm.

## Step 3 — Install OpenClaw

**Mac / Linux:**
```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

**Windows (PowerShell):**
```powershell
iwr -useb https://openclaw.ai/install.ps1 | iex
```

**What this does:** downloads and installs the `openclaw` command onto your
machine, the same way installing any other app does.

**How to tell it worked:**
```bash
openclaw --version
```
should print a version number, not an error. Tell me what it prints — the
exact version matters because OpenClaw's config format can change between
versions, and I want to double-check anything version-specific before we
rely on it.

## Step 4 — Run first-time setup

```bash
openclaw onboard --install-daemon
```

**What this does:** creates `~/.openclaw/openclaw.json` (the main config
file) and a background service so the Gateway can run continuously instead
of only while a terminal window is open. It will ask you some interactive
questions (default model, etc.) — reasonable defaults are fine for now,
since this repo's config will override the agent-specific parts anyway.

**How to tell it worked:**
```bash
openclaw status
```
should show the Gateway as running, not errored.

## Step 5 — Get this repo onto your laptop

```bash
git clone https://github.com/StephenNgo420/OpenMT.git
cd OpenMT
git checkout claude/openclaw-telegram-ai-company-2a38q1
```

This pulls down everything built in this session — the seven agent
personas, the config template, and these docs.

## Stop here for now

Don't wire in real secrets yet. Once you've also completed
`02-telegram-bots-setup.md` and `03-provider-api-keys.md`, come back and
we'll fill in `config/openclaw.config.template.json5` together and merge it
into your real `~/.openclaw/openclaw.json` — I'll walk through exactly what
changes and why before you run anything that touches the live config.
