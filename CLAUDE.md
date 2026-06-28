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

- **Face/identity reference:** `reference/candace_persona_reference.png` — v2,
  Higgsfield job id `49aff4e5-9c20-44a3-87e8-85ba87e0d642` (same face as the
  original, with the fuller 10E figure on her petite 5'1" frame). Pass this job
  id as the `image` reference and match this face + figure on every generation.
  (Original v1 face anchor: `0a3e996d-ff5b-44b3-a0bc-3dc240099cb9`.)
- **Generation:** Higgsfield MCP — `nano_banana_pro` (image), `seedance_2_0`
  (video, pass the reference as `image` role for identity).
- **Image resolution: ALWAYS request `resolution: "2k"` from nano_banana
  ("banana") on every image generation moving forward.** 2K costs the same 2
  credits as 1K, so it's a free quality upgrade — never generate at 1K.
- **Posting:** upload-post.com API, managed user `model_candacesummers`
  (Instagram). Photo endpoint `POST /api/upload_photos`.
- **Posting log:** archive every published asset in `posted images/` and append
  to `posted images/index.md` + `posted_log.json`.

## 📒 Generation logging — DO THIS EVERY TIME (no exceptions)

Whenever you generate ANY image or video for Candace, before ending the turn:

1. **Save the file** into `generations/` named
   `YYYY-MM-DD_<short-desc>_<job-id-short>.ext`.
2. **Add a `META` entry** for it in `generations/build_manifest.py` with: model,
   job id, **cost in credits** (look it up via the Higgsfield `transactions`
   tool — flagged/failed jobs auto-refund, so only count successes), batch,
   `generated_at` (UTC), the **exact prompt**, and a short note.
3. **Re-run** `python3 generations/build_manifest.py` to refresh
   `generations/manifest.json` (sizes + totals).
4. Also keep `generations/CREDIT_USAGE.md` and `generations/PROMPTS.md` current.
5. **Commit & push.** The dashboard (`/index.html`, served by GitHub Pages from
   this branch root) reads `manifest.json` and updates automatically.

The dashboard shows every asset with preview, file size, download link, prompt,
cost, model, job id, and time. GitHub Pages must be set to **Deploy from a
branch → this branch → `/ (root)`** (no Actions). `.nojekyll` is committed so
files are served as-is.
