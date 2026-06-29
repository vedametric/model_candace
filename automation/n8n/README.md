# Candace TikTok Talker — n8n AI responder

Drop-in replacement for the static ManyChat auto-reply. It reads the incoming
DM, generates Candace's reply using her voice + conversation rules, and returns
it to ManyChat in the same `{ "message": "..." }` shape you already use.

**File:** `candace_tiktok_responder.json`

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
4. **Tell ManyChat to send the message.** In the ManyChat External Request that
   hits this webhook, set the body to JSON and include the user's last message,
   e.g.:
   ```json
   { "message": "{{last_text_input}}" }
   ```
   (The workflow also checks `text`, `last_input_text`, `last_input`,
   `user_message`, `msg`, and query params, so most field names just work.)
   The fan's display name is already read from the `tiktok_displayname` header
   ManyChat sends.
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
