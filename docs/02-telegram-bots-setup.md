# 2. Create the 7 Telegram bots + the company group

**What this is:** each AI "employee" needs its own Telegram bot account so
messages in the group visibly come from "FinanceBot" or "CodingBot" rather
than one generic account. You create these through Telegram's own bot
manager, **@BotFather** — a bot itself, not a website.

You need the regular Telegram app for this (phone or desktop), logged in as
you (the owner).

## Step 1 — Talk to BotFather

1. In Telegram, search for `@BotFather` (verified, blue checkmark).
2. Open a chat with it, send `/start`.

## Step 2 — Create each bot

Repeat this **7 times**, once per bot below. Send `/newbot` to BotFather
each time.

| # | Name to give BotFather | Username to give BotFather (must end in `bot`) |
|---|---|---|
| 1 | CoreBot | `YourCompanyName_core_bot` |
| 2 | FinanceBot | `YourCompanyName_finance_bot` |
| 3 | PictureBot | `YourCompanyName_picture_bot` |
| 4 | CodingBot | `YourCompanyName_coding_bot` |
| 5 | FileBot | `YourCompanyName_file_bot` |
| 6 | MarBot | `YourCompanyName_mar_bot` |
| 7 | ResearchBot | `YourCompanyName_research_bot` |

Replace `YourCompanyName` with anything short and unique to you (Telegram
usernames are globally unique, so a generic name like `core_bot` will
already be taken). Example flow for one bot:

```
You:       /newbot
BotFather: Alright, a new bot. How are we going to call it?
You:       CoreBot
BotFather: Good. Now let's choose a username for your bot.
You:       StephenAICo_core_bot
BotFather: Done! Congratulations on your new bot. Use this token to
           access the HTTP API:
           123456789:AAExampleTokenStringHere
```

**Save that token somewhere safe as you go** (a notes file is fine for now
— not this repo, and not pasted into our chat). You'll end up with 7
tokens, one per bot. Label each one clearly (which bot it belongs to) —
they look identical and it's easy to mix them up.

## Step 3 — Turn off "privacy mode" for every bot

By default, Telegram bots in a group can only see messages that are
commands (`/like_this`) or that directly mention them. We need each bot to
see the group's conversation (so CoreBot can read your plain request, and
specialists can see CoreBot's assignment message). For **each** of the 7
bots, tell BotFather:

```
/mybots
→ select the bot
→ Bot Settings
→ Group Privacy
→ Turn off
```

**How to tell it worked:** BotFather will confirm "Privacy mode is
disabled." If you skip this step, the bots will only react to
`/commands`, not plain conversation — which actually matches the plan's
requirement to use structured `/task@FinanceBot` commands for reliable
targeting, so if you'd rather leave privacy mode ON everywhere, that also
works — tell me and I'll design the routing around commands-only instead
of also reading plain messages. Default recommendation: turn it off, since
it gives us more flexibility later without cost.

## Step 4 — Create the company group

1. In Telegram, create a new group (New Group → give it a name, e.g. "My
   AI Company").
2. Add yourself (already a member) — you don't need to add the bots by
   search yet; a bot must have privacy/interaction enabled and you invite
   it by username same as a person: **Add Member → search each bot's
   username → add**. Do this for all 7.
3. Make sure each bot is **not** demoted/muted — leave default permissions
   for now.

## Step 5 — Get the group's chat ID

We'll need this later to configure Telegram bindings precisely. Easiest
way once the bots are in: send any message in the group, then (once we
wire up CoreBot in a later stage) it can report the chat ID back to you.
For now, skip this — it's not needed until Stage 3.

## What to send back to me

Once done, just confirm "bots created" — **do not paste the actual tokens
into our chat.** When we get to Stage 3 (wiring the real config), I'll tell
you exactly which file to paste them into on your own laptop, which stays
local and out of git.
