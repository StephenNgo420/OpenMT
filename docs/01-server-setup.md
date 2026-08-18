# 1. Set up your Hetzner server

**What this is:** you decided on a small Hetzner VPS (~€4.35/mo, 2 vCPU /
4GB RAM) as the always-on machine that runs OpenClaw's Gateway 24/7. This
guide gets you from "no server" to "OpenClaw running and surviving reboots"
on that machine.

**A device you still need, but only briefly:** setting this up requires
typing commands into the server over SSH — from your phone, a borrowed
computer, a library machine, whatever you have access to. It does **not**
need to be powerful and it does **not** need to stay on afterward — only
the Hetzner server itself needs to stay running 24/7. Once setup is done,
you can check in from any device whenever you like.

## Step 1 — Create a Hetzner account and a server

1. Go to **https://www.hetzner.com/cloud** and sign up.
2. Add a payment method (Hetzner is pay-as-you-go, billed hourly up to a
   monthly cap — expect roughly €4.35/month for what we're setting up).
3. Create a new project (any name, e.g. "AI Company").

We'll create the actual server in Step 3, after the SSH key is ready —
Hetzner lets you attach the key at creation time, which saves a step.

## Step 2 — Create an SSH key

This is a matched pair of files: a private key that stays only on your
device, and a public key you give to Hetzner. It's how you prove it's you
connecting, without typing a password every time.

**Mac/Linux (or Windows using WSL/PowerShell with OpenSSH, which ships
built-in on modern Windows):**
```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
```
Press Enter through the prompts (default file location is fine; a
passphrase is optional but recommended). This creates two files, typically
`~/.ssh/id_ed25519` (private — never share this) and
`~/.ssh/id_ed25519.pub` (public — this one goes to Hetzner).

**Print the public key so you can copy it:**
```bash
cat ~/.ssh/id_ed25519.pub
```
Copy the whole line it prints (starts with `ssh-ed25519`).

**If you're on a phone:** an SSH app like Termius can generate a key pair
for you in its interface — same idea, just through a GUI instead of a
terminal command.

## Step 3 — Add the key to Hetzner, then create the server

1. In the Hetzner Cloud Console, open your project → **Security → SSH
   Keys → Add SSH key**. Paste the public key line, give it a name.
2. **Servers → Add Server**:
   - Location: whichever is closest to you.
   - Image: **Ubuntu**, latest LTS version offered in the list.
   - Type: **CX22** (2 vCPU / 4GB RAM / shared).
   - SSH Key: select the key you just added — do **not** set a root
     password instead; the key is more secure and is what the rest of
     this guide assumes.
3. Create it. Hetzner shows you the server's public IP address — copy
   that, you'll need it constantly.

## Step 4 — Connect and create a non-root user

Never leave `root` as your everyday login — it's the account with zero
restrictions, so a mistake or a compromised credential does maximum
damage. First connection only, then we switch away from it.

```bash
ssh root@YOUR_SERVER_IP
```

Once connected:
```bash
adduser openmt          # creates a new user — pick any username, follow the prompts
usermod -aG sudo openmt # gives it permission to run admin commands via `sudo`
rsync --archive --chown=openmt:openmt ~/.ssh /home/openmt   # copies your SSH key to the new user
```

**How to tell it worked:** open a new terminal tab/window (keep the root
session open until this is confirmed) and run:
```bash
ssh openmt@YOUR_SERVER_IP
```
You should connect without a password prompt. From now on, always connect
as `openmt` (or whatever you named it), never `root`.

## Step 5 — Lock down root login and add a firewall

Still logged in as `openmt` (using `sudo` for anything that needs it):

```bash
sudo passwd -l root   # locks the root password so it can't be used to log in directly
```

Now the firewall. We only need one port open — SSH — because OpenClaw
never needs to accept inbound web traffic: Telegram bots poll outward for
messages, and the model providers are all outbound calls too.

```bash
sudo ufw allow OpenSSH
sudo ufw enable
```
Confirm with `y` when prompted. **How to tell it worked:**
```bash
sudo ufw status
```
should show `OpenSSH` as the only allowed rule, status active.

## Step 6 — Install OpenClaw

Same install method as any Linux machine:

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
openclaw --version
```
Tell me the version it prints, same reason as always — I want to confirm
it against current docs before we rely on version-specific config.

```bash
openclaw onboard --install-daemon
```
This creates `~/.openclaw/openclaw.json` and installs the Gateway as a
**systemd user service** so it survives crashes and reboots.

## Step 7 — Make it survive you logging out (the easy-to-miss step)

By default, a systemd *user* service like this one only keeps running
while you have an active login session — the moment your SSH connection
closes, it could stop. "Enable lingering" tells the server to keep your
user's services running even with nobody logged in, which is the entire
point of putting this on a VPS instead of a laptop:

```bash
sudo loginctl enable-linger openmt
```

**How to verify this actually worked:** check status, then disconnect
completely and reconnect to confirm it's still running.
```bash
openclaw gateway status   # should show running
exit                      # disconnect entirely
```
Wait a minute, then:
```bash
ssh openmt@YOUR_SERVER_IP
openclaw gateway status   # should STILL show running
```
If it does, the Gateway is genuinely 24/7 now — not dependent on you
staying connected.

## Step 8 — One security note for later, not now

`openclaw onboard` also starts a local Control UI on port 18789 — it's
only reachable from the server itself, not from the internet, and it must
stay that way. Never open port 18789 in the firewall. We don't need it for
the Telegram-based flow this project is built around, so there's nothing
to do here now — just don't be tempted to expose it "to check on things
remotely" without an SSH tunnel.

## Step 9 — Get this repo onto the server

```bash
git clone https://github.com/StephenNgo420/OpenMT.git
cd OpenMT
git checkout claude/openclaw-telegram-ai-company-2a38q1
```

## Stop here for now

Same as before — don't wire in real secrets yet. Once you've also
completed `02-telegram-bots-setup.md` and `03-provider-api-keys.md`, come
back and we'll fill in the real config together, on this server, over SSH.
