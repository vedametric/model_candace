# automation/ — how Candace's auto-DM system works

End-to-end documentation of the TikTok/ManyChat → AI → reply pipeline.

> **TL;DR of the data flow (async — the production path)**
> ```
> fan DMs Candace on TikTok
>    -> ManyChat trigger fires, calls the n8n webhook (External Request)
>       -> n8n responds INSTANTLY (fire-and-forget) so ManyChat never waits
>       -> n8n: dedup re-deliveries -> log message to Supabase
>          -> pick a random human delay (2-10 min) and WAIT
>          -> after the wait, re-check: is this still his latest message?
>             - no  -> abort (a newer message will answer the whole burst)
>             - yes -> load memory -> classify -> OpenAI (gpt-4o) -> reply
>                   -> SEND the reply via the ManyChat Send API (TikTok)
>                   -> log reply + update buyer profile/stage
> ```

The live production workflow is **`n8n/candace_manychat_async.json`**. It adds a
random human delay, message debouncing, duplicate-delivery protection, a live
queue dashboard, and sends replies via the ManyChat API instead of the webhook
response. The older **`n8n/candace_tiktok_responder_supabase.json`** is the
**synchronous** version (n8n returns the reply in the webhook response and
ManyChat sends it) — still used by the in-browser tester page, and a simpler
reference. The other JSONs are simpler variants kept for reference.

---

## 1. The pieces

| Piece | Role |
|---|---|
| **TikTok** | where fans DM Candace (`candace_summers`). |
| **ManyChat** | watches the inbox, fires on a new message, calls n8n, and (async path) receives her reply back via the ManyChat Send API. |
| **n8n** | the orchestrator: dedup, memory, delay, debounce, classify, OpenAI, profile, send. |
| **Supabase (Postgres)** | durable memory + her personality + full logs + the queue events. Multi-bot. |
| **OpenAI** | the reply (`gpt-4o`), plus the per-message classifier and buyer profiler (`gpt-4o-mini`). |

---

## 2. ManyChat side (async cutover)

- **Trigger:** "User sends a message."
- **Action — External Request:** call the async webhook
  `https://automations.vedametric.com.au/webhook/candace-manychat-async`.
  ManyChat passes:
  - the message text as the header **`last_text_input`**,
  - identity headers `tiktok_username` / `tiktok_displayname`,
  - **`subscriber_id`** (the contact's ManyChat id) — **required**, this is how
    n8n sends the reply back,
  - `tiktok_lastinteraction` (used for duplicate detection — see §3).
- **No Smart Delay** — n8n owns the timing (random 2–10 min).
- **No response mapping / no Send Message node** — n8n pushes the reply out
  itself via the ManyChat Send API after the delay. The webhook returns
  immediately (`{"message":"Workflow was started"}`); that response is *not* used.

> **Send API gotcha:** the send body must set `content.type: "tiktok"`. Without
> it ManyChat defaults to the Messenger channel and fails the 24h-window check
> (`code 3011`). Message tags don't apply to TikTok, so the delay always stays
> inside TikTok's normal post-interaction window — which it does, since she's
> replying to someone who just messaged.

The synchronous tester path still uses the old webhook
(`/webhook/13efd976-...`) and the `webook_replies` custom field; leave that
alone if you use the browser tester.

---

## 3. The async n8n workflow, node by node

Workflow: `n8n/candace_manychat_async.json` (webhook path `candace-manychat-async`).

1. **Webhook (ManyChat)** — `responseMode: onReceived`, so it 200s instantly and
   the rest runs in the background. ManyChat is never left waiting.
2. **Extract Inbound** (Code) — pulls `msg` (from `last_text_input`), `username`,
   `display`, `subscriber_id`, and `interaction` (`tiktok_lastinteraction`).
3. **Dedup: read fan → Dedup: gate** — ManyChat/TikTok can **re-deliver the same
   inbound message** minutes apart. Each real message carries a
   `tiktok_lastinteraction` timestamp that repeats on a re-delivery. The gate
   reads the last interaction we handled for this fan and **drops** the message
   if it matches — so she never double-replies. Genuine repeats (new timestamp)
   pass through.
4. **DB: ingest** (Supabase RPC `dm_ingest`) — upserts the fan, logs the inbound
   message, bumps `msg_count`, returns context `{ bot_id, fan_id, summary, stage,
   count, recent[], system_prompt, model }`. **Logging happens immediately**, so
   every message in a burst is recorded in order even before she replies.
5. **Set Delay** (Code) — picks a random, aloof delay: mostly **120–600s
   (2–10 min)**, ~15% of the time a quicker **45–120s**. Stamps `queued_at` and
   `scheduled_for`, and captures `$execution.resumeUrl` (for "send now").
6. **Q: enqueue** (Supabase insert → `events` type `dm_queued`) — records the
   message, the picked delay, and the scheduled send time for the dashboard.
7. **Wait (human delay)** — resumes either when the delay elapses **or** when its
   resume webhook is called (that's the dashboard "send now" button).
8. **DB: get fan → Check Latest** (the **debounce**) — re-reads `msg_count`. If a
   newer message arrived during the wait, this run **aborts** (returns nothing)
   and the newest run answers — with the **whole burst** as context, because all
   the messages were logged in step 4. So rapid-fire messages collapse to a
   single reply that accounts for all of them; only the surviving run replies.
9. **Build Classify Request → Classify (gpt-4o-mini)** — a fast silent classifier
   reads his latest message + recent context and returns a JSON "read on him"
   (archetype, intent, effort, whether to funnel, whether to ask a question, and
   a one-line directive for this reply).
10. **Build Messages** (Code) — assembles the OpenAI `messages`: `system` = **her
    full personality from the DB** (`system_prompt`); then her private memory
    `summary`; then the classifier's directive; a stage note if she's already
    given the telegram; then the recent turns. The big personality is always
    `messages[0]` and byte-identical, so prompt-caching applies.
11. **Candace AI (OpenAI, gpt-4o)** → **Format Reply** (Code) — generates the
    reply, then deterministically enforces her style: lowercase, strips dashes,
    allows only `😏 🤭 🤍 👀` and at most one emoji, safe fallback.
12. **DB: log reply** (`dm_log_reply`) — saves her reply to the permanent log.
13. **ManyChat: send reply** (HTTP → `sendContent`, `content.type:"tiktok"`) —
    delivers the reply to the fan, keyed by `subscriber_id`.
14. **Q: sent** (Supabase insert → `events` type `dm_sent`) — records the sent
    reply for the dashboard.
15. **Profiler branch** (parallel, from step 12): **Build Profile Request →
    Profiler (gpt-4o-mini) → Apply Profile → DB: patch fan** — produces an honest
    buyer read (intent_score 0–100, stage, buyer_type, temperature, signals,
    technique, next_move) and a 2-line memory note, and stores them in
    `fans.summary` + `fans.metadata`. It also stamps `last_interaction_ts` into
    metadata (this is what the dedup gate in step 3 checks). If the reply gave the
    telegram, stage is bumped to `funnelled`.

---

## 4. The live queue dashboard

A read-only board to watch what's come in, the delay she picked, and when it sent.

- **Open:** `https://automations.vedametric.com.au/webhook/candace-queue-page`
- **Source files:** `test/candace_queue.html` (the page),
  `n8n/candace_queue_api.json` (the read API at `/webhook/candace-queue`), and a
  small page-serving workflow.
- **Columns:** queued time · user · incoming message · the **delay she picked** ·
  status · live countdown or her actual reply.
- **Status:** `waiting` (counting down) → `generating…` → `sent` (with reply);
  or `debounced` (a newer message replaced it); or `no reply` (aborted/errored —
  shown after a short grace, never a false "generating…").
- **"Send now"** button on waiting rows — resumes that run immediately (via the
  Wait node's resume URL, same-origin) so you don't wait out the delay.

It rides on the existing `events` table (`dm_queued` / `dm_sent`) — no schema
change.

---

## 5. Supabase side

Schema + RPCs: `supabase/schema.sql`. Personality: `supabase/candace_prompt.sql`.

**Tables**
- `bots` — registry of every bot. Holds each bot's `system_prompt` (personality),
  `model`, `telegram_handle`, `instagram_url`. Candace is one row.
- `fans` — one row per fan per bot per platform (keyed by `username`). Holds the
  running `summary`, funnel `stage`, `buyer_type`, counts, first/last seen, and
  `metadata` (intent_score, signals, technique, next_move, `last_interaction_ts`).
- `messages` — every inbound and outbound message, kept forever.
- `events` — audit + queue log (`inbound_message`, `reply_sent`, `dm_queued`,
  `dm_sent`, ...).

**RPCs** (called by n8n over the Supabase REST API)
- `dm_ingest(...)` — upsert fan + log inbound + return full context.
- `dm_log_reply(...)` — log Candace's reply.
- `dm_set_summary(...)` / `dm_set_stage(...)` — memory note / funnel stage.

Memory is durable: it lives in Postgres, survives restarts/redeploys, is backed
up by Supabase, and is queryable. Multi-bot is isolated by `bot_id`.

---

## 6. Where her personality lives (important)

Her **full personality is stored in the database** (`bots.system_prompt`), not
hard-coded in n8n. `dm_ingest` returns it and n8n uses it as the system prompt.

- **Edit her voice/behaviour:** change `supabase/candace_prompt.sql` and re-run
  it (or edit the row). No workflow change needed.
- **Change her model:** update `bots.model` (default `gpt-4o`).
- The short brain embedded in **Build Messages** is only a **fallback**, used if
  the DB prompt is empty.

### Confirm the FULL personality is the one running
```sql
select model, length(system_prompt) as chars, left(system_prompt, 80) as start
from bots where slug = 'candace_summers';
```
- **Loaded** → `chars` ≈ **9,500+**, `start` begins *"You are Candace Summers, a
  21 year old woman from columbus, ohio..."*, and the prompt contains
  `YOUR PRIMARY OBJECTIVE`, `THE TELEGRAM`, and a `FINAL CHECK` section.
- **Not loaded (fallback)** → `chars` null/short and replies feel generic. Fix:
  run `candace_prompt.sql`.

You can also verify live: open a run → **Build Messages** output →
`messages[0].content` should be the full personality.

---

## 7. Cost & models
- Reply: **`gpt-4o`** (~2k in + ~80 out ≈ ~$0.005/reply, less with caching).
- Classifier + profiler: **`gpt-4o-mini`** per message ≈ small.
- Roughly **$5–8 per 1,000 DMs** including the classifier/profiler passes. Model
  choice is the real cost lever.

---

## 8. Going-live checklist
- [x] Point the ManyChat External Request at `/webhook/candace-manychat-async`.
- [x] Pass `subscriber_id` (System Field) alongside `last_text_input`.
- [x] Remove the fixed Smart Delay and the response-mapping / Send Message node.
- [x] Send via `sendContent` with `content.type:"tiktok"`.
- [ ] Broaden the ManyChat trigger from any test gate (e.g. "begins with `.`") to
      any-message / Default Reply when you're ready for all fans.
- [ ] Confirm `candace_prompt.sql` has been run (see §6 check).
- [ ] Rotate any API keys / DB passwords shared in plaintext (ManyChat token,
      n8n API key, OpenAI key, Supabase password).

---

## 9. Live n8n workflows (reference)

| Workflow | Path | Role |
|---|---|---|
| **Candace ManyChat ASYNC** | `/webhook/candace-manychat-async` | production responder (delay + debounce + dedup + API send) |
| Candace Queue API | `/webhook/candace-queue` | read-only queue events (JSON) |
| Candace Queue Page | `/webhook/candace-queue-page` | the dashboard UI |
| TIkTok Talker (sync) | `/webhook/13efd976-...` | older synchronous responder; used by the browser tester |
| Candace Tester Page / API | `/webhook/candace-tester`, `/candace-history`, `/candace-users` | manual test chat + memory inspection |

Credentials used: `supabaseApi`, an OpenAI Bearer-auth cred, and a
`httpHeaderAuth` cred holding the ManyChat token (`Authorization: Bearer ...`).
None are committed to the repo.
