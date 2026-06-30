#!/usr/bin/env python3
"""
One-time helper to mint a Telethon STRING SESSION for the Candace account.

Run this once, interactively, on a trusted machine:

    TG_API_ID=...  TG_API_HASH=...  python3 login.py

It will ask for the Candace account's phone number and the login code Telegram
sends (and the 2FA password if the account has one). It prints a string session.
Put that string into TG_SESSION (env / secret store) for bridge.py.

NEVER commit the printed session string — it is full access to the account.
"""

import os
from telethon import TelegramClient
from telethon.sessions import StringSession

api_id = int(os.environ["TG_API_ID"])
api_hash = os.environ["TG_API_HASH"]

with TelegramClient(StringSession(), api_id, api_hash) as client:
    print("\n=== your string session (store as TG_SESSION, keep it secret) ===\n")
    print(client.session.save())
    print("\n=== done ===")
