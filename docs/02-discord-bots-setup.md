# 2. Create the 7 Discord bots + the company server

**What this is:** each AI "employee" needs its own Discord bot account, so
messages visibly come from "FinanceBot" or "CodingBot" rather than one
generic account. This happens on Discord's own website — the **Developer
Portal** — not inside the regular Discord app.

## First, a few words explained

- **Application** — Discord's container for a bot. One application = one
  bot. You'll create 7, one per company employee.
- **Bot token** — a secret string, like a password, that lets our server
  log in *as* that bot. Same idea as the Telegram tokens we almost set up
  — copy it somewhere safe, never share it, never paste it into our chat.
- **Server (in Discord's sense)** — this is what Discord calls a
  community/workspace (their equivalent of a Telegram "group" or a Slack
  "workspace"). You'll create one, e.g. "My AI Company," and all 7 bots
  will live inside it.
- **Guild ID** — Discord's internal ID number for a server. We need this
  one specific number later to tell OpenClaw which server the bots belong
  to — Discord requires this explicitly (Telegram didn't need anything
  equivalent).
- **Intent** — a permission a bot has to explicitly request to see certain
  things, like the actual text of messages. We need one specific one
  turned on, explained in Step 3.

## Step 1 — create the company server

1. Open Discord (desktop app, or discord.com in a browser).
2. Bottom-left, click the **+** icon → **Create My Own** → **For me and my
   friends** (or similar wording) → name it something like "My AI
   Company."
3. That's it — you now have a server with one default channel (usually
   `#general`), which is where the company chat will happen.

## Step 2 — turn on Developer Mode (needed to copy the Server ID)

1. In Discord, click the gear icon (**User Settings**, bottom-left).
2. Go to **Advanced** (left sidebar).
3. Turn on **Developer Mode**.

**How to tell it worked:** right-click your new server's icon (left
sidebar) — you should now see a **"Copy Server ID"** option that wasn't
there before. Click it, then paste that number somewhere safe (a notes
app) labeled "Guild ID" — you'll need it once, later, when we wire the
config.

## Step 3 — create each bot (repeat this 7 times)

Go to **https://discord.com/developers/applications** (sign in with the
same Discord account).

For **each** of the 7 bots below:

| # | Name to give it |
|---|---|
| 1 | CoreBot |
| 2 | FinanceBot |
| 3 | PictureBot |
| 4 | CodingBot |
| 5 | FileBot |
| 6 | MarBot |
| 7 | ResearchBot |

1. Click **"New Application"** (top right), type the name (e.g.
   `CoreBot`), click **Create**.
2. In the left sidebar of that application, click **"Bot"**.
3. Click **"Reset Token"** (or it may show a **"Copy"** button directly if
   this is the first time) — this reveals the bot's token. **Copy it
   immediately somewhere safe** (a notes app), clearly labeled which bot
   it belongs to — you can't view it again later without resetting it.
4. On the same page, scroll down to **"Privileged Gateway Intents"** and
   turn ON **"Message Content Intent"**. This is required — without it,
   the bot can technically be online but won't be able to read what
   anyone actually types. Click **Save Changes** if prompted.
5. Now, in the left sidebar, click **"OAuth2"** → **"URL Generator"**.
   - Under **Scopes**, check: `bot`
   - Under **Bot Permissions** (a new section appears once you check
     `bot`), check: `Send Messages`, `Read Message History`,
     `View Channels`, `Use Slash Commands`
   - Copy the URL it generates at the bottom of the page.
6. Paste that URL into a new browser tab and press Enter. It'll ask you to
   pick which server to add the bot to — choose the one you made in Step
   1 ("My AI Company") — then **Authorize**.

**How to tell it worked:** back in your Discord server, open the member
list (right side, or the members icon) — the bot should now appear there
(shown as offline/gray is expected — it only comes "online" once our
server is actually running and connected to it later).

Repeat all of Step 3 for the remaining 6 bots. Yes, this means clicking
"New Application" 7 times — a bit repetitive, but each one is quick once
you've done the first.

## What to send back to me

Once all 7 are created and added to the server, just confirm "bots
created" — **do not paste the actual tokens into our chat.** When we get
to wiring the real config, I'll tell you exactly which file to paste each
one into on your own server, which stays local and out of git — same as
we did for the API keys.

## Wiring a bot's token in (once you have it)

Skip the interactive `openclaw agents add <id>` wizard for this part — it
looped unpredictably during our own setup. Use a direct config patch
instead, one bot at a time:

```bash
openclaw config patch --stdin <<'EOF'
{
  channels: {
    discord: {
      accounts: {
        <id>: {
          enabled: true,
          token: "PASTE_THE_BOT_TOKEN_HERE",
          guilds: {
            "YOUR_GUILD_ID": {}
          }
        }
      }
    }
  }
}
EOF
```

replacing `<id>` with the agent's id (`core`, `finance`, `picture`,
`coding`, `file`, `marketing`, or `research`) and `YOUR_GUILD_ID` with your
server's numeric ID (Developer Mode → right-click server icon → Copy
Server ID). Then bind it:

```bash
openclaw agents bind --agent <id> --bind discord:<id>
```

Once all 7 are patched and bound, restart once to apply everything:
```bash
openclaw gateway restart
```

## Gotchas we actually hit (in case they recur)

Three separate, non-obvious things had to all be true before a single bot
would respond — worth knowing since they're easy to miss and produce
**zero errors anywhere** when missing (not in Discord, not in the logs):

1. **The Discord plugin needs explicit trust.** Without
   `plugins.entries.discord.enabled: true` in the config, the gateway logs
   a warning about the plugin running "without explicit trust" and some
   things behave unpredictably. This is a one-time, global fix.
2. **Agents need the messaging tool group.** Without
   `tools.alsoAllow: ["group:messaging"]` (global), an agent can receive a
   Discord message but has no way to reply, upload a file, or react —
   it fails completely silently. `openclaw doctor` actually flags this
   one directly if you run it.
3. **The single biggest time sink: a Discord account needs its guild
   registered.** Adding a bot's token is not enough — without
   `channels.discord.accounts.<id>.guilds.<guildId>: {}`, the bot connects,
   shows online, and Discord-level transport even acknowledges receiving
   the message (`openclaw channels status` shows `in: Xm ago`) — but the
   message is never routed to the agent. No session ever gets created, no
   error is logged anywhere, even at `debug`/`trace` log level. Registering
   the guild ID (an empty `{}` is enough — no need to also list specific
   channels to get a basic response working) was the actual fix.

If a bot ever goes silent again, check these three first, in this order:
`openclaw doctor` (catches #1 and #2), then `openclaw channels status`
(shows whether `in:` is updating — if it is but the bot still doesn't
respond, it's almost certainly #3).
