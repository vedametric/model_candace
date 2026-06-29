# automation/ — how Candace's auto-DM system works

End-to-end documentation of the TikTok/ManyChat → AI → reply pipeline.

> **TL;DR of the data flow**
> ```
> fan DMs Candace on TikTok
>    -> ManyChat trigger fires, calls n8n webhook (External Request)
>       -> n8n: read message -> load memory from Supabase -> build prompt
>          -> OpenAI (gpt-4o) generates Candace's reply
>       -> n8n: log reply to Supabase, respond { "message": "..." }
>    -> ManyChat sends that reply back to the fan on TikTok
>    (and in the background, every ~8 msgs, n8n updates a memory summary)
> ```

The live workflow is **`n8n/candace_tiktok_responder_supabase.json`** (OpenAI +
Supabase memory). The other JSONs are simpler variants kept for reference
(stateless, or n8n-static-data memory). Supabase is the production one.

---

## 1. The pieces

| Piece | Role |
|---|---|
| **TikTok** | where fans DM Candace (`candace_summers`). |
| **ManyChat** | watches the inbox, fires on a new message, calls n8n, and sends n8n's reply back to the fan. |
| **n8n** | the orchestrator: reads the message, talks to Supabase + OpenAI, returns the reply. |
| **Supabase (Postgres)** | durable memory + her personality + full logs. Multi-bot. |
| **OpenAI** | generates the actual reply (model `gpt-4o`) and the memory summaries (`gpt-4o-mini`). |

---

## 2. ManyChat side

- **Trigger:** "User sends a message." During testing it's gated so only *you*
  fire it (a keyword like a leading `.`, or a `tester` tag). For launch this
  becomes any-message (or a Default Reply).
- **Action 1 — External Request:** POST to the n8n webhook
  (`https://automations.vedametric.com.au/webhook/13efd976-...`). ManyChat sends
  the fan's message and identity. **Important: the message text arrives as the
  HTTP header `last_text_input`**, and identity as headers `tiktok_displayname` /
  `tiktok_username`. The response `{ "message": "..." }` is mapped to a custom
  field (`webook_replies`).
- **Action 2 — Send Message:** sends `{{webook_replies}}` back to the fan (with a
  short "typing" delay for realism).

**Testing trick:** messages are prefixed with `.` and ManyChat only proceeds if
the message begins with `.`. n8n strips that leading `.` so Candace sees the
clean text. Remove this gate at launch.

---

## 3. n8n workflow, node by node

Live workflow: `n8n/candace_tiktok_responder_supabase.json`.

1. **Webhook** — receives ManyChat's POST. (Path is fixed so ManyChat never needs
   reconfiguring.)
2. **Extract Inbound** (Code) — pulls the message from `last_text_input` (header)
   with several fallbacks, strips a leading `.`, and reads `display` + `username`
   from the TikTok headers. Outputs `{ username, display, msg }`.
3. **DB: ingest** (HTTP → Supabase RPC `dm_ingest`) — in ONE call: upserts the
   fan (keyed by bot + platform + username), logs the inbound message, bumps the
   counter, and returns context: `{ bot_id, fan_id, summary, stage, count,
   recent[], system_prompt, model }`.
4. **Build Messages** (Code) — assembles the OpenAI `messages` array:
   `system` = **her full personality from the DB** (`system_prompt`); then her
   private memory `summary`; then the last ~10 turns (`recent`). Picks the
   `model` from the DB (`gpt-4o`). The big personality is always `messages[0]`
   and identical every call, so OpenAI prompt-caching applies. Also flags
   `needSummary` every 8th message. (If the DB prompt is somehow empty, a short
   embedded fallback brain is used so she never replies with no personality.)
5. **Candace AI (OpenAI)** (HTTP) — calls `chat/completions` with the model +
   messages. Returns her reply.
6. **Format Reply** (Code) — extracts the text, strips stray quotes, safe
   fallback. Carries `fan_id`, `bot_id`, `needSummary`.
7. **DB: log reply** (HTTP → `dm_log_reply`) — saves Candace's reply to the
   permanent message log.
8. **Respond to Webhook** — returns `{ "message": "<reply>" }` to ManyChat
   **immediately** (fires right after step 7, so ManyChat never waits).
9. **Background summary branch** (runs after responding, only every 8th msg):
   **Summary due?** → **Build Summary Request** → **Summarize (OpenAI, gpt-4o-mini)**
   → **Extract Summary** → **DB: set summary** (`dm_set_summary`). This folds the
   thread into a 2-line memory note so long conversations stay cheap and she
   keeps remembering who he is after old turns roll off the window.

---

## 4. Supabase side

Schema + RPCs: `supabase/schema.sql`. Personality: `supabase/candace_prompt.sql`.

**Tables**
- `bots` — registry of every bot. Holds each bot's `system_prompt` (personality)
  and `model`. Candace is one row; other bots just add rows.
- `fans` — one row per fan per bot per platform (keyed by `username`). Holds the
  running `summary`, funnel `stage`, `buyer_type`, counts, first/last seen,
  `metadata`.
- `messages` — every inbound and outbound message, kept forever.
- `events` — audit log (inbound, replies, summary updates).

**RPCs** (called by n8n over the Supabase REST API)
- `dm_ingest(...)` — upsert fan + log inbound + return full context (incl.
  personality + model + recent window).
- `dm_log_reply(...)` — log Candace's reply.
- `dm_set_summary(...)` — update the memory note.
- `dm_set_stage(...)` — set funnel stage / buyer type (for future monetization).

**Why memory is durable:** it lives in Postgres, survives restarts/redeploys,
is backed up by Supabase, and is queryable. Multi-bot is isolated by `bot_id`.

---

## 5. Where her personality lives (important)

Her **full personality is stored in the database** (`bots.system_prompt`), not
hard-coded in n8n. `dm_ingest` returns it and n8n uses it as the system prompt.

- **Edit her voice/behaviour:** change `supabase/candace_prompt.sql` and re-run
  it (or edit the row). No workflow change needed.
- **Change her model:** update `bots.model` (default `gpt-4o`).
- The short brain embedded in the **Build Messages** node is only a **fallback**,
  used if the DB prompt is empty (e.g. you never ran `candace_prompt.sql`).

### How to confirm the FULL personality is the one running
Run in the Supabase SQL Editor:
```sql
select model, length(system_prompt) as chars, left(system_prompt, 120) as start
from bots where slug = 'candace_summers';
```
- **Full personality loaded** → `chars` ≈ **6,500–6,800**, `start` begins with
  *"You are Candace Summers, a 21 year old woman from columbus, ohio..."* and the
  prompt contains `YOUR ONE GOAL` and a `FINAL CHECK` section.
- **Not loaded (running the fallback)** → `chars` is null or much shorter
  (~4,000), and replies will feel more generic. Fix: run `candace_prompt.sql`.

You can also verify live: in n8n open a run → **Build Messages** output →
`messages[0].content` should be the ~6,700-char personality, not the short one.

---

## 6. Cost & models
- Reply model: **`gpt-4o`** (DB-driven per bot). ~2k input tokens (personality +
  history) + ~80 output ≈ **~$0.005 per reply** (~$0.004 with prompt caching).
- Summary model: **`gpt-4o-mini`**, every 8th message ≈ negligible (~$0.0002).
- Roughly **$4–6 per 1,000 DMs**. The personality size is a rounding error; model
  choice is the real cost lever.

---

## 7. Going live checklist
- [ ] Change the ManyChat trigger from the test gate to any-message (or remove
      the `.` condition / `tester` tag).
- [ ] Confirm the External Request Response Mapping writes `message` →
      `webook_replies`, and the Send Message uses `{{webook_replies}}`.
- [ ] Confirm `candace_prompt.sql` has been run (see §5 check).
- [ ] (Optional realism) add variable delay + "awake hours" so she doesn't reply
      like a machine.
- [ ] Rotate any API keys / DB passwords shared in plaintext.
