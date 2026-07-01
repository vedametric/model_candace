# n8n/ — the workflow JSONs

Exported n8n workflows for Candace's auto-DM system. For the full architecture
and node-by-node walkthrough, see [`../README.md`](../README.md). This file is
just a map of what's in this folder.

## Production

| File | What it is |
|---|---|
| **`candace_manychat_async.json`** | **The live responder.** Async: random human delay, rapid-message debounce, duplicate-delivery dedup, buyer profiling, and replies sent via the ManyChat Send API. Webhook path `candace-manychat-async`. |
| `candace_queue_api.json` | Read-only API (`/webhook/candace-queue`) that serves the queue events for the dashboard. |

The dashboard page itself (`test/candace_queue.html`) is served by a small
page-serving workflow at `/webhook/candace-queue-page`.

## Telegram (talk & retain)

| Workflow (in n8n) | What it is |
|---|---|
| **Candace Telegram BUSINESS** (`/webhook/candace-business`) | **The LIVE Telegram responder.** Sends **as the real account** via the `candace_auto_bot` Telegram **Business** bot (`sendMessage` with `business_connection_id` + `chat_id`) — NOT the bridge. Adds photo vision + voice transcription + a "Spark" re-engage branch. Same engine as ManyChat (delay/debounce/classifier/troll gate/director note/profiler). |
| `candace_telegram_async.json` | **Deprecated.** Old Telethon-**bridge** version (`/webhook/candace-telegram-async`, inactive). Reference only. |
| `candace_admin_api.json` | Admin API for the console: list fans (`/candace-admin-fans`) + `dm_link_person` (`/candace-admin-link`) + `dm_unlink_fan` (`/candace-admin-unlink`) for manual cross-platform sync; troll-detector config read/write (`/candace-admin-config`, `/candace-admin-config-set`); and **`/candace-admin-send`** (dashboard "Send as Candace"). |

**Troll / zero-intent detector:** the ManyChat responder has a stateful **Troll
Gate** (config in `bots.settings.troll`, seeded by
`../supabase/troll_detector.sql`, shipped in `shadow_mode`). See
`../troll_detector_design.md` for the full design and how to arm it.

**Telegram send = Business bot, not the bridge.** The live Telegram responder
sends via `POST api.telegram.org/bot<candace_auto_bot>/sendMessage` with
`{ business_connection_id, chat_id, text }`, so replies appear from the real
account. The Telethon **bridge** (`automation/telegram/bridge/`) and the
`candace_telegram_async` workflow are **deprecated / inactive**. Full overview:
`automation/telegram/README.md`.

**Why async:** the webhook is fire-and-forget (`responseMode: onReceived`), so
ManyChat gets an instant 200 and n8n owns everything after — the delay, the
debounce, and the send. The reply goes out via `sendContent` keyed by
`subscriber_id`.

> **Send API gotcha:** the body must set `content.type: "tiktok"`. Without it
> ManyChat targets the Messenger channel and fails the 24h-window check (error
> `3011`) even right after the fan messages. Message tags don't apply to TikTok,
> so the reply always goes out inside the normal post-interaction window — which
> it does, since she's replying to someone who just messaged.

## Legacy / reference (not live)

Earlier synchronous versions, kept for reference. They return the reply in the
webhook response and let ManyChat send it (no delay/debounce/dedup). The
production async workflow supersedes all of them.

| File | What it was |
|---|---|
| `candace_tiktok_responder_supabase.json` | Synchronous OpenAI + Supabase-memory responder. Still used by the in-browser **tester** page. |
| `candace_tiktok_responder_openai_memory.json` | Synchronous, OpenAI + n8n-static-data memory (no Supabase). |
| `candace_tiktok_responder_openai.json` | Synchronous, OpenAI, stateless. |
| `candace_tiktok_responder.json` | Synchronous, Anthropic (Claude), stateless. |

## Credentials

All workflows reference n8n **credentials**, never inline keys — nothing secret
is committed. The async workflow uses:
- `supabaseApi` — Supabase REST (memory, logs, queue events),
- an OpenAI **Bearer-auth** cred — replies + classifier + profiler,
- a `httpHeaderAuth` cred holding the ManyChat token (`Authorization: Bearer ...`).

If a key was ever shared in plaintext, rotate it.

## Cost note

The big Candace personality is always `messages[0]` and byte-identical every
call, so OpenAI prompt caching (50% off cached input, automatic) stays hot. The
fan's name + message go in the *user* turn, never the system block. Reply model
is DB-driven (`bots.model`, default `gpt-4o`); the classifier and profiler use
`gpt-4o-mini`.
