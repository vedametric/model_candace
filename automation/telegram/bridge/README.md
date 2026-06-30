# Candace Telegram bridge

The connector that lets Candace run as a **real Telegram user account** (not a
BotFather bot), so there's no "bot" badge and the illusion holds. It plays the
same role ManyChat plays for TikTok:

```
person DMs the Candace account
  -> bridge forwards it to the n8n Telegram webhook   (n8n owns delay/brain/memory)
     -> n8n generates her reply, waits the human delay
        -> n8n POSTs the reply to the bridge's /send
           -> bridge sends it to the person AS Candace
```

n8n and Supabase do all the thinking; the bridge is a thin pipe.

## Files
- `bridge.py` — the service (inbound listener + `/send` endpoint). Reply-only.
- `login.py` — one-time helper to mint the account's string session.
- `requirements.txt` — `telethon`, `aiohttp`.
- `.env.example` — copy to `.env` and fill in. **Never commit the real `.env`.**

## Setup
1. **Get API credentials.** Log in to https://my.telegram.org as the Candace
   account → *API development tools* → note the **api_id** and **api_hash**.
2. **Install deps.** `pip install -r requirements.txt`
3. **Mint a session string** (once, interactively):
   ```
   TG_API_ID=... TG_API_HASH=... python3 login.py
   ```
   Enter the Candace phone number + the code Telegram sends (+ 2FA password if
   set). Copy the printed string into `TG_SESSION`.
   > The string session is **full access to the account** — treat it like a
   > password. Keep it in a secret store / env, never in git.
4. **Fill `.env`** from `.env.example` (the api id/hash, the session, the n8n
   webhook URL, and a long random `BRIDGE_SECRET`).
5. **Run it** (supervised — systemd / pm2 / docker so it restarts):
   ```
   set -a; . ./.env; set +a
   python3 bridge.py
   ```
6. **Point n8n at it.** In the workflow's **Telegram: send reply (bridge)** node,
   set the URL to the bridge's `/send` (env `CANDACE_BRIDGE_URL`, default
   `http://127.0.0.1:8081/send` if co-hosted with n8n), and create an
   **httpHeaderAuth** credential with header `X-Bridge-Secret` = your
   `BRIDGE_SECRET`. The inbound POST carries the same secret so n8n can verify
   the bridge if you choose to check it.

## Account safety (it's a real account — don't get it limited)
- **Reply-only by design.** It never initiates a conversation; it only forwards
  messages people send first and only sends what n8n asks. No mass DMs.
- **Human pacing.** n8n picks the delay (per-platform `settings.delay`); the
  bridge adds a short "typing" pause before sending.
- **Warm up slowly.** New/idle accounts that suddenly send a lot get flagged.
  Ramp volume gradually; set `SAFETY_DAILY_CAP` as a backstop while you do.
- Keep the `/send` endpoint private (localhost or firewalled); the shared secret
  is a guard, not a substitute for network controls.

## Health
`GET /health` → `{ "ok": true, "sent_today": N }`. The bridge also logs every
forward and send; n8n logs the rest to Supabase (`events`), so the dashboard
shows Telegram traffic alongside TikTok.
