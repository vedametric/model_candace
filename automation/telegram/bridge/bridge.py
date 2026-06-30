#!/usr/bin/env python3
"""
Candace Telegram bridge
=======================
The connector that lets Candace run as a REAL Telegram user account (not a
BotFather bot), so she never shows a "bot" badge and the illusion holds.

It mirrors exactly what ManyChat does for TikTok:

  incoming DM  -> POST to the n8n Telegram webhook  (n8n owns delay/brain/memory)
  n8n reply    -> POST /send here  -> sent to the person AS Candace

Design notes / account safety (this is a real account, treat it gently):
  * REPLY-ONLY. It never cold-DMs anyone. It only forwards messages people send
    first, and only sends replies n8n asks it to. No mass messaging.
  * It honors the human delay that n8n picks (n8n waits, THEN calls /send).
  * Optional per-day send cap (SAFETY_DAILY_CAP) as a backstop.
  * A short "typing" action before sending so it feels human.

Nothing secret is hard-coded. All config is env vars (see .env.example).
"""

import os
import asyncio
import logging
from datetime import date

from aiohttp import web, ClientSession, ClientTimeout
from telethon import TelegramClient, events
from telethon.sessions import StringSession

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("candace-bridge")

# ---- config (env) ----------------------------------------------------------
API_ID        = int(os.environ["TG_API_ID"])
API_HASH      = os.environ["TG_API_HASH"]
SESSION       = os.environ["TG_SESSION"]              # string session (see login.py)
N8N_WEBHOOK   = os.environ["N8N_WEBHOOK_URL"]         # .../webhook/candace-telegram-async
BRIDGE_SECRET = os.environ["BRIDGE_SECRET"]           # shared secret for /send + outbound header
BIND_HOST     = os.environ.get("BRIDGE_HOST", "127.0.0.1")
BIND_PORT     = int(os.environ.get("BRIDGE_PORT", "8081"))
DAILY_CAP     = int(os.environ.get("SAFETY_DAILY_CAP", "0"))   # 0 = no cap

client = TelegramClient(StringSession(SESSION), API_ID, API_HASH)
_http: ClientSession | None = None

# crude daily send counter (resets on date change) — backstop against runaways
_sent = {"day": date.today(), "n": 0}


def _cap_ok() -> bool:
    today = date.today()
    if today != _sent["day"]:
        _sent["day"], _sent["n"] = today, 0
    if DAILY_CAP and _sent["n"] >= DAILY_CAP:
        log.warning("daily send cap %s reached; dropping send", DAILY_CAP)
        return False
    return True


# ---- inbound: telegram -> n8n ----------------------------------------------
@client.on(events.NewMessage(incoming=True))
async def on_message(event):
    # reply-only: private, incoming, human messages only
    if not event.is_private:
        return
    sender = await event.get_sender()
    if getattr(sender, "bot", False):
        return
    payload = {
        "telegram_user_id": str(event.sender_id),
        "username": (getattr(sender, "username", None) or str(event.sender_id)),
        "display_name": " ".join(
            x for x in [getattr(sender, "first_name", None), getattr(sender, "last_name", None)] if x
        ) or (getattr(sender, "username", None) or "him"),
        "text": event.raw_text or "",
        "message_id": str(event.id),
    }
    try:
        async with _http.post(
            N8N_WEBHOOK, json=payload, headers={"X-Bridge-Secret": BRIDGE_SECRET}
        ) as r:
            await r.read()
        log.info("forwarded msg from %s (%s)", payload["username"], payload["telegram_user_id"])
    except Exception as e:  # noqa: BLE001
        log.error("forward to n8n failed: %s", e)


# ---- outbound: n8n -> telegram (POST /send) --------------------------------
async def handle_send(request: web.Request) -> web.Response:
    if request.headers.get("X-Bridge-Secret") != BRIDGE_SECRET:
        return web.json_response({"ok": False, "error": "unauthorized"}, status=401)
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        return web.json_response({"ok": False, "error": "bad json"}, status=400)

    uid, text = body.get("telegram_user_id"), (body.get("text") or "").strip()
    if not uid or not text:
        return web.json_response({"ok": False, "error": "missing telegram_user_id or text"}, status=400)
    if not _cap_ok():
        return web.json_response({"ok": False, "error": "daily cap"}, status=429)

    try:
        entity = await client.get_entity(int(uid))
        # brief human-feeling typing indicator, scaled to message length
        async with client.action(entity, "typing"):
            await asyncio.sleep(min(6, 1.5 + len(text) / 25))
        await client.send_message(entity, text)
        _sent["n"] += 1
        log.info("sent to %s: %s", uid, text)
        return web.json_response({"ok": True})
    except Exception as e:  # noqa: BLE001
        log.error("send to %s failed: %s", uid, e)
        return web.json_response({"ok": False, "error": str(e)}, status=500)


async def handle_health(_request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "sent_today": _sent["n"]})


async def main():
    global _http
    _http = ClientSession(timeout=ClientTimeout(total=15))

    await client.start()
    me = await client.get_me()
    log.info("logged in as %s (@%s) — reply-only bridge up", me.first_name, me.username)

    app = web.Application()
    app.router.add_post("/send", handle_send)
    app.router.add_get("/health", handle_health)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, BIND_HOST, BIND_PORT)
    await site.start()
    log.info("send endpoint listening on http://%s:%s/send", BIND_HOST, BIND_PORT)

    await client.run_until_disconnected()


if __name__ == "__main__":
    asyncio.run(main())
