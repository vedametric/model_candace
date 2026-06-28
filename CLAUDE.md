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

## 🎬 Motion-control / "put Candace in this video" workflow

When the user gives a reference video (a file or a TikTok/IG link) and wants
Candace doing that motion:

1. **Get the driving video.** For a social link (incl. `vt.tiktok.com` short
   URLs), `yt-dlp -o src.%(ext)s "<url>"` downloads it. Extract preview frames
   with `imageio` (`pip install imageio imageio-ffmpeg av`; there's no ffmpeg
   CLI) to read the outfit/scene/motion. `Read` on beach/swimwear stills is
   often blocked by display moderation even though the generation is fine —
   `SendUserFile` the frames so the user can see and pick.
2. **Build the start frame** with banana (2k): identity ref `49aff4e5` + a
   prompt matching the ref's outfit/scene. **Tighter framing on the face = the
   motion holds her likeness far better.** Always show the start frame and get
   approval BEFORE running motion control.
3. **Upload the driving video** to Higgsfield: `media_upload` → `curl -X PUT`
   the bytes → `media_confirm` (type `video`). Then `motion_control`
   (image_id = start frame, motion_video_id = upload, `scene_control:"image"`).
4. **Iterate wardrobe** without losing the look: pass identity ref **+ the
   chosen frame as a second "scene/pose/composition" reference**, and only
   describe what changes (skin-tight, more makeup, shorter shorts, etc.).
5. **Same character across multiple clips:** reuse the **exact same start-frame
   job id** with different driving videos — that keeps Candace 100% identical
   clip-to-clip (only the motion changes).
6. **Content filter:** "see-through / sheer mesh + midriff + bikini" on a beach
   trips the `nsfw` flag (auto-refunds, net 0). Reword to "fitted / lightweight
   gauzy / fully covered / tasteful, no nudity" to clear it — same look, passes.

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
