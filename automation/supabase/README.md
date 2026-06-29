# Supabase backend — multi-bot DM memory

Durable, multi-bot memory + full logging for the DM responders. Replaces the
n8n static-data store with a real Postgres database (backed up, queryable,
concurrency-safe, scalable).

## Files
- `schema.sql` — run once in Supabase to create everything.

## What it stores
- **`bots`** — master registry of every bot (Candace is one row; add more with no
  schema change).
- **`fans`** — one row per fan per bot per platform, keyed by `tiktok` username.
  Holds the running `summary`, funnel `stage`, `buyer_type`, counts, first/last
  seen, and a free-form `metadata` jsonb.
- **`messages`** — every inbound and outbound message, kept forever.
- **`events`** — audit log of inbound messages, replies, summary updates ("log as
  much as possible").

Multi-bot is enforced by `bot_id` on every fan/message, so the same TikTok
username under two different bots stays completely separate. There's also a
`candace_fans` view for convenience.

## RPCs (used by the n8n workflow)
- `dm_ingest(bot, platform, username, display, user_msg, window)` → upserts the
  fan, logs the inbound message, bumps counters, and returns
  `{ bot_id, fan_id, summary, stage, count, recent[] }` in one round-trip.
- `dm_log_reply(fan_id, bot_id, reply)` → logs Candace's reply.
- `dm_set_summary(fan_id, summary)` → updates the running memory note.
- `dm_set_stage(fan_id, stage, buyer_type)` → for the v3 funnel layer.

## Her personality lives in the database
The bot's **full personality** is stored in `bots.system_prompt` (and the model
in `bots.model`), and `dm_ingest` returns them on every message. This means:
- The reply quality comes from the **full spec**, not a summary baked into n8n.
- To tweak her voice or upgrade her model, edit `candace_prompt.sql` and re-run
  it (or edit the row directly). No workflow change needed.
- Default model is **`gpt-4o`** for quality. Change the `model` value to trade
  cost/quality (e.g. `gpt-4o-mini`).

## Setup
1. **Run the schema.** Supabase dashboard → SQL Editor → paste `schema.sql` →
   Run. (Verified to apply cleanly on Postgres 16. Safe to re-run to upgrade.)
1b. **Load Candace's personality.** Paste `candace_prompt.sql` → Run. This sets
   her full system prompt + model on the `candace_summers` bot row. Re-run any
   time you edit her personality.
2. **Create the n8n Supabase credential.** In n8n → Credentials → **Supabase API**:
   - **Host:** `https://vvnefkexzhfgvuusavvl.supabase.co`
   - **Service Role Secret:** your Supabase service_role key (Project Settings →
     API → `service_role`). This key is server-side only; never expose it
     client-side.
3. Import the workflow `../n8n/candace_tiktok_responder_supabase.json` and select
   that Supabase credential on the three `DB:` nodes (they use it automatically).

## Security
- The DB password / service key are **never** stored in the repo or the workflow
  JSON — only in the n8n credential.
- **Rotate any password/key shared in plaintext** (Supabase → Project Settings →
  Database → Reset password; and rotate API keys if needed).

## Adding another bot later
Just call the RPCs with a different `p_bot` slug (e.g. `'mybot'`) — `dm_ingest`
auto-creates the bot row on first message. Duplicate the workflow, change the
`p_bot` value in the `DB: ingest` node, give it its own webhook + brain, and it
shares the same database, fully isolated by `bot_id`.

## Querying your data (examples)
```sql
-- candace's most active fans
select username, display_name, msg_count, stage, last_seen
from candace_fans order by msg_count desc limit 20;

-- full transcript with one fan
select m.role, m.content, m.created_at
from messages m join fans f on f.id = m.fan_id
where f.username = 'kunalmiind'
order by m.created_at;
```
