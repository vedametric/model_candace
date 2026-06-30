# automation/telegram/ — Candace on Telegram (talk & retain)

Candace on **Telegram**, reusing the same brain + memory as the TikTok auto-DM
system. Her job here (v1): **talk to people and make them crave her** — more
personal than TikTok, **no funnel, no selling**. Spice stays **tasteful** (same
as TikTok) for now; it's a dial that can be raised later.

> Full design + decisions: [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).
> TikTok pipeline (the shared brain): [`../README.md`](../README.md).

## Data flow (same shape as TikTok, different connector)
```
person DMs the Candace Telegram ACCOUNT
  -> Telethon bridge forwards it to the n8n Telegram webhook   (bridge == ManyChat)
     -> n8n: dedup -> dm_ingest (candace_telegram / telegram) -> per-platform delay
        -> debounce -> classify -> OpenAI reply -> style-enforce
           -> n8n POSTs the reply to the bridge /send
              -> bridge sends it AS Candace (real account, no "bot" badge)
                 -> log reply + retention profiler (Supabase)
```
Everything between `dm_ingest` and the send is the **same engine** as TikTok
(delay, debounce, dedup, classifier, profiler, prompt-caching, queue events).

## What's different from TikTok
- **Real user account, not a bot** — driven by the Telethon **bridge/** so there's
  no "bot" badge. (TikTok uses ManyChat.)
- **Separate bot row** `candace_telegram` with its own `system_prompt` — TikTok
  stays locked. Funnel removed; objective re-aimed at **retention / attachment**.
- **Per-platform delay** — pacing comes from `bots.settings.delay`, so Telegram is
  more present than TikTok's aloof 2–10 min, without editing the workflow.
- **Cross-platform memory** — `persons` table links a Telegram fan to their TikTok
  history; the bot is fed that shared memory. Linking is **manual** in the admin
  console (v1).

## Files
| File | What |
|---|---|
| `candace_telegram_persona.md` | Human-readable Telegram brain (mirror of the SQL). |
| `../supabase/candace_telegram.sql` | Loads the brain + model + `settings` into the `candace_telegram` bot row. |
| `../supabase/schema.sql` | (extended) `persons` table, `fans.person_id`, `bots.settings`, `dm_ingest` returns `settings` + `person_summary`, link/unlink RPCs. |
| `../n8n/candace_telegram_async.json` | The Telegram responder workflow (clone of the ManyChat async flow, retargeted). |
| `../n8n/candace_admin_api.json` | Admin API: list fans + `dm_link_person` / `dm_unlink_fan`. |
| `../test/candace_queue.html` | Admin console: queue (platform-aware) + cross-platform sync UI. |
| `bridge/` | Telethon bridge (real-account connector) + login helper + README. |

## Setup (once)
1. **DB:** run `../supabase/schema.sql` (additive, safe to re-run), then
   `../supabase/candace_telegram.sql`. Verify:
   ```sql
   select slug, model, settings, length(system_prompt) as chars
   from bots where slug = 'candace_telegram';   -- chars ~6000+
   ```
2. **Bridge:** see [`bridge/README.md`](./bridge/README.md) — mint a session
   string for the Candace account, set env, run it (reply-only).
3. **n8n:** import `candace_telegram_async.json` and `candace_admin_api.json`,
   select the existing `supabaseApi` + OpenAI Bearer creds, and add an
   `httpHeaderAuth` cred (`X-Bridge-Secret`) for the send node. Set the send
   node URL to the bridge `/send` (`$env.CANDACE_BRIDGE_URL`).
4. **Go live:** activate the workflows; warm the account up slowly.

## Manual cross-platform sync
Open the admin console → **cross-platform sync** tab. Pick a fan, then
**link with selected** on the same person's other-platform row. Linking merges
their memory into a shared `persons.summary`, so Candace on Telegram immediately
knows what they talked about on TikTok. **Unlink** reverses it.

## Cost
Same model mix as TikTok (`gpt-4o` reply + `gpt-4o-mini` classifier/profiler),
~$5–8 per 1,000 DMs with prompt caching.
