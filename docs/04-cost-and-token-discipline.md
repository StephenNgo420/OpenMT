# 4. Cost & token discipline

**Principle:** every credit-consuming model call has to earn its cost. If a
byte of output can be produced correctly by plain code reading the Work
Registry, it must be produced that way — never sent to a model just
because that's the easier thing to build. This page is the single source
of truth for that rule; every stage of the build checks against it rather
than each agent inventing its own judgment call.

This is a discipline, not a feature cut. Every capability in the project
brief still exists in full — this page only decides *which* execution path
(deterministic code vs. a model call, and if a model call, which tier)
handles it.

## Already required by the brief — enforced here structurally

| Feature | Rule | Where |
|---|---|---|
| Accept/assign/complete messages | deterministic templates, no model call | §35, §56 |
| `/company` dashboard | real provider/runtime state, never guessed | §38 |
| Owner escalation alert | fires with zero model calls, works even if every provider is down | §33 |
| Duplicate Telegram deliveries / retries | deduped *before* reaching a model | §40 |
| `/resume` | Work-Registry-built brief, not a full chat replay | §23 |
| Inter-agent handoffs | structured packet, not resent conversation history | §14 |

None of these are new — they were already in the original spec. Calling
them out here means the routing/registry code (Stage 4+) is written
against this checklist instead of relying on someone remembering it later.

## Additional levers (still 100% inside the existing feature set)

### 1. Tiered model per CoreBot execution mode, not one model per agent

CoreBot's three modes have different cost profiles:

- **ROUTER** — classifying intent and writing a structured task packet is
  closer to formatting than deep reasoning. Use a smaller/cheaper model in
  the same family.
- **DIRECT_SPECIALIST** — this is CoreBot doing real work (research,
  analysis, planning). Full model.
- **FALLBACK_EXECUTOR** — continuing a failed specialist's job. Full model
  (the job's substance doesn't get cheaper because the primary specialist
  failed).

This doesn't touch §4 ("model, agent, responsibility are different
concepts") — it's the same separation carried one level further: *mode*
is also independently configurable from *agent identity*.

We haven't picked exact cheap-tier model strings for OpenAI/Google yet —
same reasoning as the OpenClaw version check earlier: I'd rather confirm
current pricing/tier names at the point we actually wire real keys (Stage
3) than hardcode a guess now that could be stale by the time you read
this.

### 2. Prompt-cache the static personas

`SOUL.md` + `AGENTS.md` are sent as part of the system prompt on every
call to that agent, and they don't change between messages. Both Anthropic
and OpenAI support marking a prompt segment as cacheable so you pay full
input-token price once per session instead of once per message. This is a
config/implementation detail in the Stage 4 routing code, not a change to
what's in those files.

### 3. Mechanical Definition-of-Done checks before LLM judgment

Some §10 acceptance criteria are objectively checkable by code:

- FileBot: "file opens," "expected sheets/slides/pages exist," "formulas
  remain formulas" → open the file with a library and check structure
  directly, no model call needed to answer these.
- CodingBot: "program executes," "tests pass" → run it, read the exit
  code.

Criteria that are genuinely judgment calls (do the assumptions look
reasonable, does the copy match the brief) still go through the
responsible agent — this only removes the mechanically-checkable half from
the token bill, it doesn't weaken the check (arguably strengthens it,
since a library check can't be talked into a false pass).

### 4. Cache job one-liners at completion

§19's history browser reads one-sentence job summaries. Generate that
sentence once, when a job hits COMPLETED, and store it on the job record.
Browsing `/history` later is a pure Work Registry read — zero model calls
per browse, no matter how many times you check.

### 5. Dedup before the call

Mechanically the same as idempotency (§40), stated separately because the
consequence of getting this wrong is specifically financial: a retried
Telegram delivery or a double-tapped button must be caught by the
`operation_id`/`event_id` check *before* anything reaches a model, not
after the fact.

## Default posture: Balanced

You chose **Balanced**: the cheap model tier is reserved strictly for pure
classification/routing work (CoreBot's ROUTER mode). Every specialist
(FinanceBot, PictureBot, CodingBot, FileBot, MarBot, ResearchBot) defaults
to its **mid-tier** model, not the cheapest and not the strongest —
trading a bit of per-job cost for more consistent output quality than the
cheap tier would give, without paying top-tier prices while you're still
testing the system end-to-end.

Concretely, once real keys are wired (Stage 3):
- CoreBot ROUTER mode → cheap tier
- CoreBot DIRECT_SPECIALIST / FALLBACK_EXECUTOR, and every specialist's
  primary model → mid-tier for that provider
- Escalation to a stronger model happens deliberately (e.g. a Definition-
  of-Done check keeps failing on the mid-tier output), not by default

We haven't pinned exact mid-tier model IDs for OpenAI/Anthropic/Google in
the config template yet — same reasoning as the OpenClaw version check:
I'd rather confirm current tier names/pricing when we actually wire keys
than hardcode a guess now that may already be stale.

## Not solved yet — needs a number from you, not more code

§41's per-job/provider budgets (`max_cost`, `warning_threshold`) need an
actual dollar figure to be meaningful, and that's a preference call, not
something inferable from the repo. We'll set sane defaults when we reach
that stage; if you already know your comfort level, mention it whenever
and I'll bake it in early instead of waiting for Stage 14.
