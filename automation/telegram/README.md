# automation/telegram/ — Candace on Telegram (talk & retain)

Candace on **Telegram**, reusing the same brain + memory as the TikTok auto-DM
system. Her job here: **talk to people and make them crave her** — more personal
than TikTok, **no funnel, no selling**. Spice stays **tasteful** for now (a dial
that can be raised later).

> TikTok pipeline (the shared brain): [`../README.md`](../README.md).

## ⚠️ How Telegram sends now (READ THIS)

Telegram sends through a **Telegram Business bot**, `candace_auto_bot`, connected
to the real Candace account via **Telegram Business**. It is **NOT** the Telethon
bridge anymore — the bridge (`bridge/`, and the `Candace Telegram ASYNC` workflow)
is **deprecated / inactive**, kept only for reference.

Because the bot is attached as a Business connection, its messages appear **from
the real account** (no "bot" badge). Every outbound reply is a Telegram Bot API
call:

```
POST https://api.telegram.org/bot<candace_auto_bot-token>/sendMessage
{ business_connection_id, chat_id, text }
```

Both `business_connection_id` and the numeric `chat_id` come from the inbound
`business_message` update — they are required to send *as the account*, and they
are currently only known live per-inbound (see "Out-of-band sends" below).

## Data flow (same engine as TikTok, different connector)
```
person DMs the real Candace account (which has candace_auto_bot connected)
  -> Telegram sends a `business_message` update to the n8n webhook
     POST /webhook/candace-business
     -> n8n: dedup -> dm_ingest (bot 'candace_telegram', platform 'telegram')
        -> per-platform delay -> debounce -> (photo vision / voice transcription
           if attached) -> classify -> troll gate -> Build Messages (system prompt
           + guards + director note) -> OpenAI reply -> style-enforce
              -> sendMessage via candace_auto_bot (business_connection_id + chat_id)
                 -> log reply + retention profiler + cross-platform memory refresh
```
Everything between `dm_ingest` and the send is the **same engine** as TikTok
(delay, debounce, dedup, classifier, profiler, **guards**, **troll gate**,
**director note**, prompt-caching, queue events).

## What's different from TikTok
- **Sends as the real account via `candace_auto_bot`** (Telegram Business), not
  ManyChat. No "bot" badge.
- **Rich inbound** — handles **photos** (getFile → vision describe) and **voice
  notes** (getFile → download → transcribe) so she can react to them.
- **"Spark"** — a proactive re-engagement branch that can open/re-open a chat.
- **Separate bot row** `candace_telegram` with its own `system_prompt` — TikTok
  stays locked. Funnel removed; objective re-aimed at **retention / attachment**.
- **Per-bot delay + pause** — pacing from `bots.reply_delay`, pause gate from
  `bots.automation_paused` (tuned from the dashboard). More present than TikTok's
  aloof 2–10 min.
- **Cross-platform memory** — `persons` links a Telegram fan to their TikTok
  history; the bot is fed the shared memory. Linking is **manual** in the console.

## Live workflows (n8n)
| Workflow | State | What |
|---|---|---|
| **Candace Telegram BUSINESS** (`/webhook/candace-business`) | **ACTIVE** | The live Telegram responder. Business-bot send + photo vision + voice transcription + Spark. |
| Candace Telegram ASYNC (`/webhook/candace-telegram-async`) | inactive | **Deprecated** Telethon-bridge version. Reference only. |
| Candace Telegram BOT test | inactive | Old native-bot experiment. Reference only. |

## Out-of-band sends (dashboard "Send as Candace")
The responder gets `business_connection_id` + `chat_id` live from each inbound.
For a **dashboard-initiated** send there is no inbound, so those IDs must be
recovered:
- `chat_id` = the fan's numeric Telegram id. `fans.username` holds the fan's
  `@username` if they have one, else the numeric id. So chat_id is only directly
  available for users **without** a public @username unless we persist it.
- `business_connection_id` is **constant** for the connected account (capture it
  once, store on the bot).

The clean approach (per the current plan): reuse the responder's **own send node**
by injecting the human's text as the reply and letting it go out on the existing
pathway (short delay), rather than duplicating the send. TikTok out-of-band sends
already work because `fans.manychat_id` (the ManyChat subscriber id) is stored.

## Files
| File | What |
|---|---|
| `candace_telegram_persona.md` | Human-readable Telegram brain (mirror of the SQL). |
| `../supabase/candace_telegram.sql` | Loads the brain + model + `settings` into the `candace_telegram` bot row. |
| `../supabase/schema.sql` | `persons`, `fans.person_id`, `bots.settings`, link/unlink RPCs, `dm_ingest`. |
| `../n8n/*` | The live workflows are edited **in n8n** and fetched/patched live (see `../n8n/README.md` §deploy) — the JSON exports here can lag production. |
| `bridge/` | **Deprecated** Telethon bridge (real-account connector). Not in use. |

## Manual cross-platform sync
Admin dashboard → fans → link a fan to the same person's other-platform row.
Linking merges their memory into a shared `persons.summary`, so Candace on
Telegram immediately knows what they talked about on TikTok. Unlink reverses it.

## Cost
Same model mix as TikTok (`gpt-4o` reply + `gpt-4o-mini` classifier/profiler),
~$5–8 per 1,000 DMs with prompt caching (plus vision/transcription when used).
