# 1. Setting up your server (plain-language version)

This guide assumes you've never done anything like this before. Every
technical word gets explained in plain English the first time it shows
up. Go slowly — there's no rush, and nothing here is undoable.

## First, four words you'll keep seeing

- **Server** — a computer that isn't yours, sitting in a company's
  building somewhere, that never turns off. You're going to "rent" one
  (a few dollars a month) so it can run your bots all day and night,
  instead of needing your own device to stay on.
- **Terminal** — a plain window where you type instructions as text and
  press Enter, instead of clicking buttons. That's the only "app" you'll
  use for most of this. Every computer already has one built in — you
  don't install anything new to get it.
- **SSH** — the method that lets the terminal on *your* device talk
  securely to the *server*, over the internet, as if you were typing
  directly on it. Think of it like a phone call that only your device and
  the server can hear.
- **Command** — one line of text you type into the terminal and press
  Enter to run. Every gray box below is something you type or paste,
  exactly as written, one box at a time.

That's it — those four words cover almost everything below.

## Before you start: open a terminal on your own device

You'll use this same window for this entire guide.

- **Mac**: press `Cmd + Space`, type `Terminal`, press Enter.
- **Windows**: press the Windows key, type `PowerShell`, press Enter.
- **Phone**: you'll need an app for this — search your app store for
  "Termius" (free), which does the same job with buttons instead of
  typed commands. Tell me if you're on a phone and I'll give
  Termius-specific steps instead of the ones below.

You should now see a plain window, probably black or white, with some
text and a blinking cursor. That's the terminal. Nothing to type yet.

---

## Part 1 — Rent the server

1. On your device, open a web browser (like you would for any website)
   and go to **hetzner.com/cloud**.
2. Sign up like you would for any other website — email, password.
3. It will ask for a payment card. This is a real, small, ongoing charge
   (about €4.35/month, roughly $5) — it's not a free trial. Add a card
   the same way you would on any shopping site.
4. Once signed in, click **"New Project"**. Name it anything, e.g.
   "AI Company". This is just a folder to keep this server organized —
   nothing technical about it.

Stop here — don't create the actual server yet. We need one more thing
ready first (Part 2), because it saves a step.

---

## Part 2 — Create your "key" (so you can log in without a password)

**What this is, in plain terms:** instead of a password, we're going to
create two matching files — like a lock and a key. One (the "key") stays
on your device forever and you never share it. The other (the "lock")
gets given to the server. When they match, you get in. This is more
secure than a password and, once set up, means you never have to type a
password again.

In your terminal, type this exactly and press Enter:

```bash
ssh-keygen -t ed25519
```

It will ask a couple of questions — for all of them, just press Enter
without typing anything (this accepts the sensible default answer).

**What you'll see when it's done:** a short message mentioning
`id_ed25519` and `id_ed25519.pub` — these are your two files (the key and
the lock). You don't need to find or open them yourself; the next command
does that for you.

Now run this, which prints the "lock" half so you can copy it:

```bash
cat ~/.ssh/id_ed25519.pub
```

**What you'll see:** one long line of text starting with `ssh-ed25519`.
Select that entire line with your mouse/trackpad and copy it (however you
normally copy text on your device — right-click → Copy, or Cmd/Ctrl+C).
Keep it copied, you'll paste it in the next step.

---

## Part 3 — Give the "lock" to Hetzner and create the server

Back in your browser, on the Hetzner website:

1. In your project, find **Security** in the left menu → **SSH Keys** →
   **Add SSH key**.
2. Paste the line you copied (the one starting with `ssh-ed25519`) into
   the box. Give it any name, e.g. "my key". Save it.
3. Now find **Servers** in the left menu → **Add Server** (or **Create
   Server**).
4. You'll be asked a few choices — here's what each means and what to
   pick:
   - **Location**: pick whichever city is closest to you. Doesn't matter
     much beyond that.
   - **Image**: this is the server's operating system — like choosing
     Windows or macOS, except this one is called **Ubuntu**. Pick
     "Ubuntu" and whichever version is marked as the newest/recommended
     one (usually labeled "LTS").
   - **Type**: pick the one labeled **CX22**. This is the size/power of
     the server — CX22 is small and cheap but enough for what we're
     doing.
   - **SSH Key**: select the key you just added by name (e.g. "my key").
     Do not set a password instead — the key is what the rest of this
     guide expects.
5. Click **Create & Buy now** (or similar). Within a few seconds, you'll
   see your new server in the list, along with an **IP address** — a
   string of numbers like `95.216.xxx.xxx`. This number is your server's
   "phone number" — copy it somewhere, you'll need it constantly.

**How to tell it worked:** the server shows up in your Hetzner dashboard
with a green "running" indicator and that IP address next to it.

---

## Part 4 — Connect to your new server for the first time

Back in your terminal (on your own device), type this — replacing
`YOUR_SERVER_IP` with the actual numbers you copied, keeping everything
else exactly as written:

```bash
ssh root@YOUR_SERVER_IP
```

The first time, it'll ask something like "are you sure you want to
continue connecting?" — type `yes` and press Enter. That's just your
device confirming it's talking to the right server the first time; it
won't ask again after this.

**How to tell it worked:** your terminal's prompt changes — it'll now
start with something like `root@your-server-name`. That means you are now
typing directly on the server, not your own device anymore. Everything
you type from here runs *there*.

---

## Part 5 — Create your everyday account on the server

**Why:** `root` (who you just logged in as) is the server's all-powerful
account — it can do absolutely anything, including break things badly by
accident. We're going to create a normal, safer account for everyday use,
the same way your own computer has "you" as a limited account rather than
always running as an all-powerful administrator.

Still connected to the server (prompt starts with `root@...`), type each
of these one at a time, pressing Enter after each:

```bash
adduser openmt
```
This asks a few questions (a password for this new account — pick one
and remember it; you can press Enter through the rest). This creates the
new account, named `openmt`.

```bash
usermod -aG sudo openmt
```
This gives the `openmt` account permission to temporarily act as an
admin when needed (by typing `sudo` before a command), without being
all-powerful all the time.

```bash
rsync --archive --chown=openmt:openmt ~/.ssh /home/openmt
```
This copies your "key" access (from Part 2) over to the new `openmt`
account, so you can log in as `openmt` the same key-based way.

**How to tell it worked:** open a **second, separate** terminal window on
your own device (keep this current one open too), and type:
```bash
ssh openmt@YOUR_SERVER_IP
```
If it connects without asking for a password, it worked. From now on,
always connect using this `openmt` line, never the `root` one.

---

## Part 6 — Basic safety steps

Back in a window connected as `openmt` (prompt starts with
`openmt@...`), run these one at a time:

```bash
sudo passwd -l root
```
This turns off the ability to log in directly as the all-powerful `root`
account — nobody (including you) can use it as a way in anymore, only
your safer `openmt` account.

```bash
sudo ufw allow OpenSSH
sudo ufw enable
```
This turns on the server's **firewall** — think of it as a locked door
with exactly one keyhole. These two lines say "only allow the one
connection type we're actually using (SSH, what you're using right now),
block everything else." When it asks to confirm, type `y` and press
Enter.

**How to tell it worked:**
```bash
sudo ufw status
```
should print something showing `OpenSSH` as allowed, and say the
firewall is active.

---

## Part 7 — Install OpenClaw itself

Still connected as `openmt`:

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```
This downloads and installs the OpenClaw software — same idea as
installing an app, just through text instead of an app store.

```bash
openclaw --version
```
**How to tell it worked:** this should print a version number (like
`1.4.2`) rather than an error. Send me exactly what it prints — I want to
double-check a couple of settings against that specific version before we
rely on them.

```bash
openclaw onboard --install-daemon
```
This sets OpenClaw up to run continuously in the background, and asks a
few setup questions — reasonable default answers are fine for all of
them, since we'll adjust the important parts together later.

---

## Part 8 — Make sure it keeps running even after you log out

**Why this step exists:** without it, your bots would quietly stop the
moment you close your terminal window — which would defeat the entire
reason we rented a server instead of using your own device.

```bash
sudo loginctl enable-linger openmt
```

**How to actually prove it worked** (this is the one check worth not
skipping):
```bash
openclaw gateway status
```
should say it's running. Now completely close your terminal window (not
just switch tabs — actually quit it), wait about a minute, then open a
fresh terminal and reconnect:
```bash
ssh openmt@YOUR_SERVER_IP
openclaw gateway status
```
If it still says running, your server is genuinely working 24/7 now, with
nobody connected to it.

---

## Part 9 — Bring this project's files onto the server

Still connected as `openmt`:

```bash
git clone https://github.com/StephenNgo420/OpenMT.git
cd OpenMT
git checkout claude/openclaw-telegram-ai-company-2a38q1
```
This copies everything we've built in this chat (the bot personalities,
the guides, the settings template) onto the server itself.

---

## You can stop here

Nothing past this point needs doing yet. When you're ready to continue,
either keep going with the Telegram and API key guides, or just tell me
you're stuck on any specific part above — including "I did Part 4 but I
don't know what I'm looking at," that's a completely fine thing to say
and I'll walk through it with you directly instead of pointing at the doc
again.
