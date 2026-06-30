# Candace TikTok Talker — n8n AI responder

Drop-in replacement for the static ManyChat auto-reply. It reads the incoming
DM, generates Candace's reply using her voice + conversation rules, and returns
it to ManyChat in the same `{ "message": "..." }` shape you already use.

**Versions (pick one):**
- **`candace_tiktok_responder_openai_memory.json`** — OpenAI + **per-fan memory
  (v2)**. Recommended. Remembers each fan, keeps a rolling window of recent
  turns, and auto-summarizes every ~8 messages. Details below.
- **`candace_tiktok_responder_openai.json`** — OpenAI, cache-optimized,
  **stateless** (no memory). Simplest.
- **`candace_tiktok_responder.json`** — Anthropic (Claude) version, condensed
  prompt, stateless.

All three keep your exact webhook path and the same OpenAI credential setup.

## Async version — `candace_manychat_async.json` (debounce + random delay + API send)

⚠️ **Status: built, NOT yet verified end-to-end.** The ManyChat *Send API* leg
(`api.manychat.com/fb/sending/sendContent`) has not yet successfully delivered a
message in testing — the one attempt failed on ManyChat's 24h messaging window.
Deploy + a live in-window test are still required before trusting it.

This is the production-grade flow that fixes two problems with the synchronous
webhook-return approach:

1. **Random, human-feeling delay** instead of ManyChat's fixed 4-minute wait.
   `Set Delay` picks ~45–300s most of the time, with a 15% chance of a quick
   10–40s burst.
2. **Debounce for rapid-fire messages.** ManyChat fires the webhook per message
   but only passes the *last* text, so consecutive messages used to clobber each
   other's context. Here every inbound message is logged to Supabase immediately
   (so the full burst is on record and in order), then after the delay the run
   re-reads `msg_count`. If it grew, a newer message arrived — this run aborts
   and lets the newest run answer with the **full batch** as context. Only one
   reply is ever sent per burst.

**Why it can't return the reply via the webhook:** the webhook is fire-and-forget
(`responseMode: onReceived`), so ManyChat gets an instant 200 and can't map a
reply back. The reply is therefore pushed out via the **ManyChat Send API**
(`ManyChat: send reply` node), keyed by `subscriber_id`.

**Flow:** Webhook → Extract Inbound (incl. `subscriber_id`) → DB: ingest →
Set Delay → Wait → DB: get fan → Check Latest (abort if newer) → Classify →
Build Messages → Candace AI → Format Reply → DB: log reply →
[ManyChat: send reply • Build Profile → Profiler → Apply Profile → DB: patch fan].

**ManyChat side (must change):**
- Pass `subscriber_id` (System Field) to the webhook as a body/query param.
- Point the External Request to the new webhook path `candace-manychat-async`.
- **Remove** the fixed 4-minute delay and remove the response-mapping step
  (she now replies via the Send API, not the request response).

**Credentials:** reuses `supabaseApi`, the OpenAI Bearer cred, and a
`httpHeaderAuth` cred holding the ManyChat token (`Authorization: Bearer <token>`).

## Memory version (v2) — how it works
- **Storage:** n8n's built-in static data (`$getWorkflowStaticData`). **Nothing
  external to set up.** Each fan is keyed by `tiktok_username`.
- **Per fan it stores:** name, a rolling window of the last 10 turns, a running
  summary note, and a message count.
- **Each reply:** loads his record, sends `[brain] + [his summary] + [recent
  turns]` to OpenAI, then saves her reply back to his window.
- **Auto-summary:** every 8th message it folds his thread into a 2-line memory
  note (a cheap `gpt-4o-mini` call) and stores it, so long threads stay cheap and
  she keeps remembering who he is even after old turns roll off the window.
- **Still cache-stable:** the big brain is always `system[0]` and byte-identical,
  so OpenAI prompt caching still applies; only the small summary + recent turns
  vary.
- **Scaling up:** static data is fine for low/medium volume. For high volume or
  multiple n8n workers, swap the two storage code-nodes to Postgres/Redis keyed
  by `tiktok_username` (same record shape). The rolling-window + summary pattern
  keeps token cost bounded no matter how long a thread runs.

> Still no selling: even with memory, this build only develops rapport (per the
> §3B pacing rule). Wiring memory to a funnel-stage + conversion step is the next
> layer.

Both keep your exact webhook path and return the same `{ "message": "..." }`.

## ⚠️ Security
The OpenAI version references your key via an n8n **credential** — the key is NOT
stored in the JSON. If you ever shared a key in plaintext, **rotate it** in the
OpenAI dashboard.

## Cheapest setup (OpenAI version)
- **Model `gpt-4o-mini`** — change in the *Candace AI (OpenAI)* node's JSON body.
- **Automatic prompt caching** — OpenAI caches identical prompt prefixes over
  ~1024 tokens at **50% off input**, no config. The workflow keeps the ~1k-token
  Candace brain **byte-identical on every call** (the fan's name + message go in
  the *user* turn, never the system block), so the cache stays hot across all
  fans. This is the main cost lever and it's automatic.
- **`max_tokens` 300** — her replies are short.
- Credential: create a **Header Auth** credential → Name `Authorization`, Value
  `Bearer sk-...`, and select it on the *Candace AI (OpenAI)* node.

---

## (Anthropic version) File: `candace_tiktok_responder.json`

## Flow
```
Webhook  ->  Extract Message & Build Prompt  ->  Candace AI (Anthropic)  ->  Format Reply  ->  Respond to Webhook
```
- **Webhook** — same path/id as your current workflow (`13efd976-…`), so your
  ManyChat integration keeps working with no change.
- **Extract Message & Build Prompt** — pulls the user's message and display name
  out of the ManyChat/TikTok payload and builds Candace's system prompt (her
  voice rules + prize-frame + no-sell, distilled from `talking_style.md` and
  `conversation_master.md`).
- **Candace AI (Anthropic)** — calls Claude with that system prompt + the user's
  message.
- **Format Reply** — extracts the text, strips stray quotes, falls back safely.
- **Respond to Webhook** — returns `{ "message": "<her reply>" }`.

## Setup (5 minutes)
1. **Import** `candace_tiktok_responder.json` into n8n (Workflows → Import from
   File).
2. **Add the Anthropic credential.** On the *Candace AI (Anthropic)* node →
   Credential → create a **Header Auth** credential:
   - **Name:** `x-api-key`
   - **Value:** your Anthropic API key (`sk-ant-...`)
   (The `anthropic-version: 2023-06-01` header is already set on the node.)
3. **Activate** the workflow.
4. **Tell ManyChat to send the message (REQUIRED — easy to miss).** In the
   ManyChat External Request that hits this webhook, add a request **parameter**
   named **`last_text_input`** with the value set to the system field **Last Text
   Input**. Without this, no message text reaches the workflow and every reply
   treats the input as empty.
   (The workflow also accepts `message`, `text`, `last_input_text`,
   `last_input`, `user_message`, `msg`, and the same names as query params.)
   The fan's display name + username are read from the `tiktok_displayname` /
   `tiktok_username` headers ManyChat already sends.
5. **Map the response** in ManyChat to `message` (same as your current setup) and
   send it back to the user.

## Tuning
- **Model:** edit the `model` in the *Candace AI* node's JSON body. Default
  `claude-sonnet-4-6` (fast + cheap for chat). Swap to `claude-opus-4-8` for
  maximum quality.
- **Length / cost:** `max_tokens` is 320 (her replies are short anyway).
- **Voice:** the system prompt lives in the *Extract Message & Build Prompt* node
  and mirrors the repo's voice rules (lowercase, short, **no dashes**, minimal
  emojis, prize-frame, no interviewing, no selling). Keep it in sync with
  `talking_style.md` / `conversation_master.md` if those change.

## Important: this is the "build rapport" stage only
By design it **never sells** — no links, no money, no paid-content talk. It only
builds the conversation and the attraction (per the §3B pacing rule: no money
signal until he's genuinely hooked). Converting to paid is a separate,
memory-aware step.

## Next steps (not in v1)
- **Conversation memory.** v1 replies to the single incoming message (stateless).
  To make her remember the thread, pass recent history from ManyChat (a custom
  field) or add a datastore (Redis/Postgres/n8n static data) keyed by
  `tiktok_username`, and feed prior turns into the `messages` array.
- **Stage + per-fan dossier.** Once memory exists, track the funnel stage and a
  `conversation_name`-style profile per fan so she can adapt and (only when he's
  hooked) move toward conversion.
