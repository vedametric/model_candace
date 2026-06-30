# Candace on Telegram — implementation plan (v1: talk & retain)

> Status: **PLAN — awaiting final approval.** Nothing below is built yet.
> Goal for v1: Candace talks to people on Telegram in her own voice — **more
> personal than TikTok**, aimed at **retention / making them crave her**. No
> selling, no funnel (they're already here). Same tasteful/SFW spice level as
> TikTok *for now*; the NSFW dial is designed-in but left off.

### Decisions locked (from review)
- **Transport: real Candace user account** driven by a self-hosted **Telethon
  bridge** (not a BotFather bot). Preserves the "real girl, never a bot" illusion.
- **Cross-platform memory sync: MANUAL via the admin dashboard** for v1 (you link
  a Telegram person to their TikTok history by hand). Auto-matching is future work.
- **Admin dashboard, logs, and message-queue system must cover Telegram too**,
  working the same as TikTok — **except Telegram has its own delay settings**
  (pacing is configured per-platform, not shared).
- **TikTok stays fully locked** — no edits to any TikTok prompt/workflow/file.

---

## 0. Guiding principles

1. **Reuse the brain, not rebuild it.** n8n stays the orchestrator; Supabase
   stays the memory. The Telethon bridge is just the Telegram *connector* — the
   same role ManyChat plays for TikTok. n8n/Supabase don't care which side a
   message came from.
2. **TikTok stays locked.** `candace_prompt.sql`, `candace_system_prompt.md`,
   `talking_style.md`, `conversation_master.md`, and the TikTok n8n workflow are
   untouched. Telegram gets its own files and its own bot row.
3. **One source of truth per surface.** TikTok brain → `bots(slug=candace_summers)`.
   Telegram brain → `bots(slug=candace_telegram)`.
4. **Config is data, not code.** Per-platform settings (delay pacing, model,
   spice level) live in the DB so they're tunable without editing workflows.
5. **Memory is about the *person*, not the *handle*.**

---

## 1. Transport — real account via Telethon bridge (decided)

A thin, self-hosted **bridge** service logs in *as the Candace account* over
MTProto (Telethon) and mirrors exactly what ManyChat does for TikTok:

```
person DMs the Candace account on Telegram
  -> Telethon bridge receives the message (event handler)
     -> POST it to the n8n Telegram webhook   (== ManyChat's External Request)
        -> n8n: dedup -> dm_ingest -> delay -> debounce -> classify -> reply
           -> n8n calls the bridge's  POST /send  with the reply
              -> bridge sends it to the person AS Candace (real account)
```

**Bridge spec** (`automation/telegram/bridge/`, ~150 lines Python):
- Login via a **session string** stored in an env var — **never committed**.
  (API id/hash from my.telegram.org; one-time interactive login to mint the
  session string.)
- Inbound: on new private message → POST `{telegram_user_id, username,
  display_name, text, message_id}` to the n8n webhook with a shared secret.
- Outbound: `POST /send {telegram_user_id, text}` → bridge sends as Candace.
- **Account safety (important — this is a real account):**
  - **Reply-only.** Never cold-DMs anyone; only responds to people who message
    first (same posture as TikTok today).
  - Honors the n8n human-delay pacing (no instant machine-gun replies).
  - Slow ramp / sane daily caps while the account warms up.
  - One bridge process; restart-safe; logs to the same `events` table so the
    dashboard sees Telegram health.
- Hosting: same box as n8n is fine (small always-on process).
- Ships with a `README.md`: minting the session string, env vars, run/supervise,
  and the ban-safety rules above.

---

## 2. Database changes (Supabase)

All additive and safe to re-run. New file: `automation/supabase/candace_telegram.sql`
(bot row + brain), plus a small additive bump to `schema.sql`.

### 2a. New Telegram bot row + brain
```sql
insert into public.bots (slug, display_name, platform_account, model)
values ('candace_telegram', 'Candace (Telegram)', 'candace_summers', 'gpt-4o')
on conflict (slug) do nothing;

update public.bots
   set system_prompt = $$ ...telegram brain (see §3)... $$
 where slug = 'candace_telegram';
```
Telegram fans are created with `p_bot='candace_telegram'`, `p_platform='telegram'`
— isolated from TikTok by `bot_id`, per your existing multi-bot design.

### 2b. Per-platform settings (so Telegram delay ≠ TikTok delay)
Today the human delay is **hard-coded** in the workflow's `Set Delay` node
(120–600s, ~15% chance 45–120s). To give Telegram its own pacing **without
editing the workflow**, move the knobs into the bot row:

```sql
alter table public.bots add column if not exists settings jsonb not null default '{}'::jsonb;

-- TikTok keeps today's aloof pacing
update public.bots set settings = jsonb_build_object(
  'delay', jsonb_build_object('min_s',120,'max_s',600,'fast_pct',0.15,'fast_min_s',45,'fast_max_s',120)
) where slug = 'candace_summers';

-- Telegram gets its own (example: more present/attentive for a 1:1 vibe — tune freely)
update public.bots set settings = jsonb_build_object(
  'delay', jsonb_build_object('min_s',45,'max_s',240,'fast_pct',0.30,'fast_min_s',15,'fast_max_s',60),
  'spice', 'tasteful'
) where slug = 'candace_telegram';
```
`dm_ingest` returns `settings`; the `Set Delay` node reads pacing from it instead
of hard-coded numbers. **TikTok pacing is preserved exactly** by seeding its row
with today's values. (Telegram numbers above are a starting suggestion — you set
the final feel.)

### 2c. Cross-platform identity layer (powers manual sync)
```sql
create table if not exists public.persons (
  id          bigint generated always as identity primary key,
  label       text,                       -- best-known name/handle
  summary     text not null default '',   -- cross-platform running memory
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
alter table public.fans add column if not exists person_id bigint references public.persons(id);
create index if not exists idx_fans_person on public.fans(person_id);
```
Two memory layers, both fed to the model on Telegram:
- `fans.summary` — what happened **on this surface**.
- `persons.summary` — the **cross-platform truth** ("has a cat named Milo").

`dm_ingest` gets one optional, backward-compatible change: when the fan has a
`person_id`, it also returns `person_summary`. TikTok is unaffected (it simply
ignores the extra field).

---

## 3. The Telegram persona (separate, retention-tuned)

Two new files mirroring the TikTok pair:
- `automation/telegram/candace_telegram_persona.md` — human-readable brain.
- `automation/supabase/candace_telegram.sql` — same text → `bots.system_prompt`.

**Kept (her core voice is identical):** lowercase, short, no dashes, ≤1 emoji from
`😏 🤭 🤍 👀`, never AI, never break character; the prize frame, push-pull,
warm-not-easy, never-interview, archetype reads, and the "sound like a real girl /
vary replies / FINAL CHECK" anti-bot rules.

**Removed (TikTok-only):** the entire **THE TELEGRAM** funnel section, the "give
username" examples, and the `funnelled` stage. There's nowhere to funnel — she's
home.

**Added / re-aimed (retention & craving — the new objective):**
- **PRIMARY OBJECTIVE rewrite:** "funnel him" → *"deepen the bond; make him think
  about you when you're not talking; become a little addictive; you're building
  something ongoing, not closing anything."*
- **More personal register:** shares small real-feeling pieces of herself — still
  selectively, still the prize.
- **Memory callbacks:** explicitly told to *use the cross-platform memory* ("ask
  how the cat's vet visit went") — this is what makes Telegram feel like a real
  continuing relationship, and the payoff of the manual-sync link.
- **Retention mechanics:** intermittent reward, open loops / "tell you later,"
  future-pacing ("text me when you're up late"), making him feel *chosen*.
- **NSFW dial built, OFF:** a single marked block keyed off `settings.spice`
  (`tasteful` → `flirty-intimate` → `explicit`). v1 ships on `tasteful` (identical
  to TikTok). Raising it later is a one-line `settings` update + SQL re-run.

(Drafted with the `candace-voice` skill so it's genuinely in her voice.)

---

## 4. Cross-platform memory sync — manual via admin dashboard (v1)

The `persons` layer (§2c) is the foundation. For v1, **linking is a human action
you take in the admin dashboard** — no auto-guessing:

- The dashboard lists fans across both platforms with their summaries.
- When you recognize "this Telegram person = that TikTok person," you click
  **Link** — this creates/attaches a `person`, points both `fans.person_id` at
  it, and **merges their memory into `persons.summary`** (so Telegram-Candace
  immediately "knows" the TikTok history; TikTok keeps working too).
- An **Unlink** action reverses it.
- From then on, every Telegram reply is fed `persons.summary`, so she remembers
  cross-platform.

Backed by a tiny n8n admin API (e.g. `POST /webhook/candace-admin-link` /
`/unlink`) writing the `persons` rows. **No changes to the locked TikTok prompt.**

> Future (not v1, noted so we don't design ourselves out of it): Tier-2
> auto-matching on identical handles, and Tier-1 deterministic deep links
> (`t.me/<candace>?start=tk_<fan_id>` handed out on TikTok) for 100% automatic
> linking — the latter would need a tweak to the locked TikTok handoff, so it
> stays off until you ask.

---

## 5. The n8n Telegram workflow

New file `automation/n8n/candace_telegram_async.json`, **cloned from
`candace_manychat_async.json`**. Reused verbatim: dedup, `dm_ingest`, the Wait /
human-delay, the burst debounce, the classifier, Build Messages, OpenAI reply,
Format Reply, `dm_log_reply`, the profiler, and **the queue `events`**. Changes:

| Node | TikTok (today) | Telegram (new) |
|---|---|---|
| **Inbound** | ManyChat webhook | webhook fed by the **Telethon bridge** (text, telegram_user_id, username, display) |
| **bot / platform** | `candace_summers` / `tiktok` | `candace_telegram` / `telegram` |
| **Set Delay** | hard-coded 120–600s | reads **`settings.delay`** from the bot row (Telegram's own pacing) |
| **Build Messages** | system + `summary` + classifier + recent | + **`person_summary`** (cross-platform memory) |
| **Outbound** | ManyChat `sendContent` (`content.type:"tiktok"`) | HTTP `POST` to the **bridge `/send`** (keyed by telegram_user_id) |
| **Funnel/stage** | bumps `funnelled` | removed (no funnel) |

Everything else is identical — same prompt-caching (big personality as
`messages[0]`), same dedup/debounce, same profiler writing `fans.summary` +
`fans.metadata`.

---

## 6. Admin dashboard, logs & queue — extended to Telegram

The dashboard, logs, and message-queue system **work for Telegram the same as
TikTok**, since they all ride the shared `events` + `messages` tables. Work:

- **Platform-aware:** add a **platform column/filter** (tiktok / telegram) to the
  queue + logs views so you can watch each surface separately or together.
- **Queue** (`waiting → generating → sent`, with the delay it picked and the
  live countdown / actual reply) works for Telegram out of the box — and now
  shows **Telegram's own delay** because pacing is per-bot (§2b). The "send now"
  button works the same.
- **Logs:** full inbound/outbound transcript per person, already in `messages`;
  just surface the platform.
- **Admin / manual sync (new):** the **Link / Unlink** UI from §4 lives here —
  list fans across platforms, link a Telegram person to their TikTok history,
  merge memory. This is the v1 sync mechanism.
- Source files touched: `automation/test/candace_queue.html` (platform column +
  link UI), `automation/n8n/candace_queue_api.json` (return platform), and a new
  small admin API workflow for link/unlink. No schema churn beyond §2.

---

## 7. Files this plan adds (no locked files touched)
```
automation/telegram/IMPLEMENTATION_PLAN.md         (this doc)
automation/telegram/candace_telegram_persona.md    (Telegram brain, human-readable)
automation/telegram/bridge/  (+ README.md)         (Telethon user-account connector)
automation/supabase/candace_telegram.sql           (bot row + brain + Telegram settings)
automation/n8n/candace_telegram_async.json         (cloned, retargeted workflow)
automation/n8n/candace_admin_api.json              (link/unlink persons — manual sync)
```
Additive, backward-compatible bumps (TikTok unaffected):
```
automation/supabase/schema.sql   -> persons table, fans.person_id, bots.settings,
                                    dm_ingest returns settings + person_summary
automation/test/candace_queue.html + candace_queue_api.json -> platform column + link UI
```

## 8. Build order once approved
1. **SQL** — `persons` + `fans.person_id` + `bots.settings` + `dm_ingest` bump;
   seed TikTok's existing delay into its row (preserves today's pacing exactly).
2. **Telegram persona** — draft with `candace-voice`, load via
   `candace_telegram.sql`; verify with the `length(system_prompt)` check.
3. **n8n workflow** — clone, retarget ends + `p_bot`/`p_platform`, read delay
   from `settings`, add `person_summary` to Build Messages.
4. **Telethon bridge** — build + README (session string, env, ban-safety).
5. **Dashboard/admin** — platform column + Link/Unlink UI + admin API.
6. **Test** in the tester harness, then go live (reply-only, slow ramp).

---

## Still-open knobs (small; can decide at build time)
- **Telegram delay numbers** — §2b has a "more present" starting suggestion;
  tell me if you want it more aloof or more attentive.
- **Reply model on Telegram** — keep `gpt-4o`, or go stronger for these
  higher-value retention chats? (Easy to change; default `gpt-4o`.)
