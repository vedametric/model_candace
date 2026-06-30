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

## The live auto-DM system

Candace replies to her TikTok DMs automatically, in her own voice, and funnels
interested men toward her private Telegram. Full node-by-node docs in
[`automation/README.md`](./automation/README.md).

```
fan DMs Candace on TikTok
  -> ManyChat -> n8n webhook (responds instantly)
     -> dedup re-deliveries -> log to Supabase
     -> pick a random human delay (2-10 min) and wait
     -> debounce: only his LAST message in a burst replies (with full context)
     -> classify -> OpenAI (gpt-4o) reply in her voice -> send via ManyChat API
     -> update his buyer profile / funnel stage
```

- **Personality lives in the database** (`bots.system_prompt`) — edit
  `automation/supabase/candace_prompt.sql` to change how she talks, no workflow
  change needed.
- **Human, not botty:** random aloof delay, rapid-message debouncing, and
  duplicate-delivery protection so she never double-texts.
- **Live queue dashboard** to watch what's come in, the delay she picked, and
  when it sent: `https://automations.vedametric.com.au/webhook/candace-queue-page`.

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
automation/              the live auto-DM system (ManyChat -> n8n -> Supabase -> OpenAI)
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
