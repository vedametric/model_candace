# model_candace

The single source of truth for **Candace Summers**, an AI virtual influencer
(lifestyle / fashion / UGC, primary platform Instagram). This repo holds
everything about who she is, how she looks, how she talks, how she's generated,
and how she's published — so every piece of content stays consistent.

> Candace Summers is a **fictional AI-generated persona** used for content
> creation. She is not a real person. All public content is kept tasteful and
> SFW; see `soul.md` for the locked rules.

---

## Start here

| File | What it is |
|---|---|
| [`soul.md`](./soul.md) | **The persona bible.** Identity, appearance, backstory, content style, the locked image/video rules. Read first. |
| [`CLAUDE.md`](./CLAUDE.md) | Operating instructions for Claude when working in this repo (generation, posting, logging). |
| [`talking_style.md`](./talking_style.md) | **How she talks.** Public voice (captions/comments) + the 1-on-1 seduction engine. |
| [`conversation_master.md`](./conversation_master.md) | **DM → paid conversion playbook.** Funnel, calibration, guardrails, and gold-standard example arcs. |
| [`approved_examples.md`](./approved_examples.md) | Human-approved gold-standard lines (captions + DM replies). ⛔ Nothing added without explicit approval. |
| [`.claude/skills/candace-voice/`](./.claude/skills/candace-voice/) | The **`candace-voice` skill** — wraps the above for writing anything in her voice. |
| [`automation/README.md`](./automation/README.md) | **How the live auto-DM system works** — TikTok → ManyChat → n8n → Supabase → OpenAI → reply, node by node. |
| [`automation/telegram/README.md`](./automation/telegram/README.md) | **Candace on Telegram** — Business bot replying as the real account, photo vision + voice transcription, cross-platform memory, deploy steps. |

---

## The voice & conversation system

Everything Candace "says" runs through one system, anchored by the
**`candace-voice`** skill and three docs:

- **`talking_style.md`** — her exact talking style: all-lowercase, short, coy,
  flirty, light on emojis, **no dashes** (cardinal sin / AI tell). Public voice
  §1–§11; the seduction engine (push-pull, white-knight, scarcity, NLP) §12–§14.
- **`conversation_master.md`** — turning that into paying fans without ever
  feeling like a sale. Key sections:
  - §0 Rails (SFW-public, in-character, adults-only, platform/payment compliant)
  - §1 The 7-stage funnel
  - **§3A Warm vs. easy** — attention is earned, never free; she never interviews him
  - **§3B Pacing** — no money signal until he's genuinely hooked
  - §4 The conversion move · §5 Retain & ascend · §6 Objections
  - §11 Gold-standard arcs by archetype: **11a provider · 11b baller · 11c shy ·
    11d submissive/findom**
- **`approved_examples.md`** — the vetted, approved lines to imitate.

**Rule:** when writing any of Candace's words (captions, comments, story text,
DMs, conversions), use the `candace-voice` skill and these docs. If it could've
come from a brand, a marketer, or an AI, it's wrong.

---

## The live conversation system (TikTok + Telegram)

Candace replies to her DMs automatically, in her own voice, on **two platforms
that share one brain and one durable memory**. Docs:
[`automation/README.md`](./automation/README.md) (TikTok) and
[`automation/telegram/README.md`](./automation/telegram/README.md) (Telegram).

```
inbound DM   (TikTok via ManyChat   |   Telegram via the Business bot)
  -> n8n webhook (responds instantly)
     -> dedup re-deliveries -> understand any media -> log to Supabase
     -> per-platform human delay + pause gate, then wait
     -> debounce: only his LAST message in a burst replies (full context)
     -> classify -> OpenAI (gpt-4o) reply in her voice -> send back on that platform
     -> fact-aware profiler updates his memory + funnel/attachment read
```

**One brain, two surfaces.** Each platform is a row in `bots`
(`candace_summers` = TikTok, `candace_telegram` = Telegram), grouped under one
identity. Personality, model and pacing live in the DB — edit behaviour without
touching n8n:
- TikTok brain → `automation/supabase/candace_prompt.sql` (funnels to Telegram).
- Telegram brain → `automation/supabase/candace_telegram.sql` (talk & retain,
  more personal, no funnel; a `spice` dial, tasteful by default).
- Per-bot **`reply_delay`** (pacing) + **`automation_paused`** (kill switch),
  both editable from the dashboard.

**Telegram is a real account, no "bot" badge.** People DM the real
**@candace_summers** account and a connected **Telegram Business bot**
(@candace_auto_bot) answers on her behalf (via `business_connection_id`). A
Telethon userbot **bridge** and a plain BotFather bot are also included as
alternatives — see [`automation/telegram/`](./automation/telegram/).

**She understands media on Telegram:**
- **Photos** → gpt-4o **vision** describes them and she reacts to the real image
  (logged as `[photo he sent: …]`).
- **Voice notes** → **Whisper** transcription (`[voice note … transcript: …]`).
- **Video / gif / sticker / file / location / contact** → a clear typed marker.
- The interpretation is logged, shown in the dashboard conversation + queue, and
  fed to memory. (ManyChat doesn't forward TikTok media, so TikTok stays text + funnel.)

**Cross-platform memory.** A `persons` table links a fan's TikTok and Telegram
identities; once linked, her memory — including the **raw facts the profiler
accumulates** (name, pets, job, preferences…) — follows the person across both
platforms. Linking is manual, from the dashboard.

**Human, not botty:** random aloof delay, rapid-message debounce, and
duplicate-delivery protection so she never double-texts.

---

## Admin dashboard

A multi-account control panel (Node/Express + vanilla SPA) for the whole system,
deployed to the droplet at **`http://134.199.145.47`** (basic auth) and
auto-deployed via GitHub Actions. The app source lives on the
**`claude/admin-dashboard-multi-account-i2zcpq`** branch under `dashboard/`.

- **One "Candace" identity** with a **TikTok ⇄ Telegram** switch on Persona /
  Studio / Generations / Posts (each platform can use a different model).
- **Fans** and **Queue** merged across platforms and **filterable**; the queue's
  fan name links straight to that fan's profile.
- **Cross-platform identity** panel per fan: link / unlink the same person across
  platforms (merges memory), with click-through to the linked profile.
- Persona editing, funnel/stage edits, pacing + pause toggle, content Studio, and
  a live message queue with "send now".

(There's also a lightweight n8n-served queue board at
`https://automations.vedametric.com.au/webhook/candace-queue-page`.)

---

## Content generation & publishing

- **Generation:** Higgsfield MCP — `nano_banana_pro` (image, always 2K),
  `seedance_2_0` (video). Identity is locked to the persona reference in
  [`reference/`](./reference/) (job id `49aff4e5-9c20-44a3-87e8-85ba87e0d642`).
  Full rules in `soul.md` §0 / `CLAUDE.md`.
- **Generation log:** every asset is saved in [`generations/`](./generations/)
  and recorded in `generations/build_manifest.py` → `manifest.json` (with cost,
  prompt, job id). Dashboard at [`index.html`](./index.html) (GitHub Pages).
- **Posting:** upload-post.com API, managed user `model_candacesummers`
  (Instagram). Every published asset is archived in
  [`posted images/`](./posted%20images/) with `index.md` + `posted_log.json`.

---

## Repo layout

```
soul.md                  persona bible (who she is + locked rules)
CLAUDE.md                operating instructions for Claude in this repo
talking_style.md         how she talks (public voice + seduction engine)
conversation_master.md   DM -> paid conversion playbook + gold arcs
approved_examples.md     human-approved gold-standard lines (vault)
.claude/skills/          the candace-voice skill
automation/              the live conversation system (n8n + Supabase + OpenAI)
automation/telegram/     Telegram system: Business bot, vision/voice media, bridge, brain
dashboard/               admin control panel (lives on the admin-dashboard branch)
reference/               locked face/figure identity references
generations/             every generated asset + manifest/logs
posted images/           archive of everything published + logs
index.html               generations dashboard (GitHub Pages)
```

---

## Conventions

- **Branching:** **`main` is the single source of truth** (and the GitHub default).
  Each parallel work-stream runs on its own branch and merges back into `main`:
  - 🖼️ **Images** → works in `generations/`, `posted images/`, `reference/`
  - 💬 **Talking / DMs** → works in `automation/`
  These touch different folders, so multiple sessions can run at once without
  conflicts. Start a session by syncing its branch with `main`; finish a chunk
  by merging back into `main`.
- **Approved examples are sacred:** never add to `approved_examples.md` without
  explicit human approval.
- **Log every generation** (file + manifest entry) before ending a task — see
  `CLAUDE.md`.
- **Keep it tasteful/SFW in public.** Suggestive by implication only; explicit
  material (where referenced) is fictional and stays behind approved, compliant
  paid channels for consenting adults.
