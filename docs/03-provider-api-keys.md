# 3. Get API keys for the three model providers

**What this is:** CoreBot talks to OpenAI's models, FinanceBot/CodingBot/FileBot
talk to Anthropic's (Claude), and PictureBot/MarBot/ResearchBot talk to
Google's (Gemini). Each provider needs its own API key — a secret string
that authorizes billing to your account per use. These are **pay-as-you-go**
(not your ChatGPT/Claude/Gemini consumer subscription) — you'll be billed
based on usage, typically cents to a few dollars while testing.

## OpenAI (for CoreBot)

1. Go to https://platform.openai.com and sign up / log in.
2. Add a payment method: **Settings → Billing**.
3. Create a key: **Settings → API keys → Create new secret key**. Copy it
   immediately — OpenAI only shows it once.
4. Consider setting a spend limit under **Billing → Limits** so testing
   can't run away in cost.

## Anthropic (for FinanceBot, CodingBot, FileBot)

1. Go to https://console.anthropic.com and sign up / log in.
2. Add a payment method under **Billing**.
3. Create a key: **API Keys → Create Key**. Copy it immediately.
4. Optionally set a monthly budget limit in the console.

## Google AI (for PictureBot, MarBot, ResearchBot)

1. Go to https://aistudio.google.com (Google AI Studio) and sign in with a
   Google account.
2. **Get API key → Create API key** (this can attach to a free Google Cloud
   project to start; image generation may require enabling billing on that
   project — Google AI Studio will tell you if a given model needs it).
3. Copy the key immediately.

## Where these keys go — and where they never go

- **Never** paste a real key into our chat, and **never** commit one to
  this git repo. If a key ever does leak into a commit or a chat, treat it
  as compromised and regenerate it from the provider's console.
- They belong in `~/.openclaw/openclaw.json` on your laptop (which stays
  local) or in a local `.env` file that OpenClaw reads at startup — this
  repo's `.gitignore` already excludes `.env` and any `*.local.json5` file
  so you can't accidentally commit one.
- When we reach Stage 3, I'll show you exactly which placeholder in
  `config/openclaw.config.template.json5` each key replaces, and you'll
  paste real values only into your local copy, not the tracked template.

## What to send back to me

Just confirm "keys created" for however many you've done (all three, or
tell me which ones are still missing) — no need to paste the values.
Missing a key for one provider only blocks the bots that use that
provider; the rest of the company can still come online.
