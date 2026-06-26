# CLAUDE.md — model_candace

This repo manages **Candace Summers**, an AI virtual influencer. The full
persona bible is in [`soul.md`](./soul.md). Read it before generating anything.

## ⛔ CANDACE SYSTEM INSTRUCTIONS — LOCKED (DO NOT OVERRIDE)

**EVERY image and EVERY video generated for Candace MUST follow these rules.**
They override any conflicting styling in a prompt or request. No exceptions.

- **Shot on an iPhone, UGC style.**
- **Natural lighting only** (no studio / artificial lighting).
- **Casual, everyday environment.**
- **Candid, unposed, mid-action** — authentic, genuine moments.
- **NOT retouched** — keep natural imperfections (skin texture, grain,
  imperfect framing, handheld feel).
- **NO studio, no professional/glossy/editorial polish.**

Sultry / thirst-trap / flirty themes are allowed **within** these constraints,
and must stay tasteful/SFW (suggestive, no nudity — no explicit content).

## Key facts

- **Face/identity reference:** `reference/candace_persona_reference.png`
  (Higgsfield job id `0a3e996d-ff5b-44b3-a0bc-3dc240099cb9`) — match this face
  on every generation.
- **Generation:** Higgsfield MCP — `nano_banana_pro` (image), `seedance_2_0`
  (video, pass the reference as `image` role for identity).
- **Posting:** upload-post.com API, managed user `model_candacesummers`
  (Instagram). Photo endpoint `POST /api/upload_photos`.
- **Posting log:** archive every published asset in `posted images/` and append
  to `posted images/index.md` + `posted_log.json`.
