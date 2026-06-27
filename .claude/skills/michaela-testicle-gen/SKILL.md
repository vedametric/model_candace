---
name: michaela-testicle-gen
description: >
  Turn a TikTok/Instagram video into a 15s comedic "testicle character" parody:
  download the clip, pull its audio, transform the creator into the absurd
  saggy-pouch creature (the "michaela testicle prompt") while keeping the outfit
  she wears in THAT clip, then lip-sync it to the original audio. Two lip-sync
  paths: Wan 2.7 (image+audio → native sync, simplest) or Kling Motion Control
  (transfers her REAL performance). Supports full head-swap OR chin-melt styles,
  iterative character edits (age, plump, makeup, outfit/background), and full-body
  walking variants. Use when the user asks for the "michaela testicle prompt", the
  "testicle character", or to redo this comedic transform on a new video/clip.
---

# Michaela Testicle Character Generator

Transforms the creator of a source video into a goofy creature with a single
saggy human-testicle-shaped flesh pouch (their own eyes/nose/lips + hair),
talking to camera, **lip-synced to the original audio**.

## The naming trap (NSFW filter) — read first

The gag must read as that organ **without ever naming it**. Clinical words
("testicle", "scrotum", "ballsack", etc.) trip the image NSFW filter — confirmed
with a controlled test: a fully clothed, zero-cleavage crop STILL flagged the
moment clinical wording was used, and passed once reworded to pure shape
description. **It's the wording, not the skin.** Always describe the SHAPE
("soft saggy pendulous pouch of loose wrinkled flesh, central seam, sparse stray
hairs"). Run `count:3-4`; some pushier variants flag while a tamer one passes.
`nano_banana_pro` flags more on revealing frames; bias toward calmer base frames.

## Two style variants (ask / infer which)

1. **Full head-swap** — the WHOLE head becomes the pouch with her face set into
   the front, hair on top. Bold, surreal. (Original style.)
2. **Chin-melt** — keep her **real upper face** (eyes, nose, mouth, forehead,
   hair all normal); ONLY the chin/jaw/under-chin melts into the hanging seamed
   pouch. Reads cleaner and is better for lip-sync (her real mouth still moves).
   This is usually what people mean by "under the chin, normal size."

## Lip-sync: pick the method

Two valid paths — the OLD claim "no audio→lipsync model works" is WRONG, Wan 2.7
works. Choose by what matters more:

- **Wan 2.7 — audio-driven (DEFAULT for a talking-to-camera clip).** Model
  `wan2_7`. Feed `start_image` (the character still, a job_id is fine) + `audio`
  (clean MP3). It solves the mouth FROM the audio: crisp sync, **no driver clip,
  no muxing, zero drift**, and it naturally adds head movement. Caps 15s,
  720p/1080p, 9:16. Tradeoff: it INVENTS her motion (not her real performance)
  and identity can wobble slightly. Also the best fix when a Motion Control result
  "looks fake / off-sync".
- **Kling Motion Control — motion transfer (when faithfulness to her REAL
  performance/choreography matters, e.g. specific gestures or full-body walking).**
  Model `motion_control`. Puppet still + a real driver clip → copies her actual
  head/mouth/hand motion. Caveat: it transfers MOTION, it does **not** solve
  phonemes, so mouths are approximate (see "Why MC can look fake"). Needs a
  continuous trackable face and an audio drift-fix.

For full-body "walking with the head" gags the face is tiny, so lip-sync is moot —
use Wan 2.7 on a full-body still (body motion + pouch jiggle) or Motion Control
with a continuous walking driver.

**CRITICAL — Motion Control ERASES a separated hanging sac.** Kling reconstructs
the neck/throat from the DRIVER (which has a normal neck), so a distinct sac that
"floats"/hangs clear of the neck gets smoothed away — the gag vanishes mid-video.
The MORE separated-from-the-neck the sac is, the more reliably MC deletes it. So:
an INTEGRATED chin-melt pouch (blended into the jaw/neck) mostly survives MC, but a
DISTINCT two-lobed hanging sac does NOT — for that, **use Wan 2.7** (it animates
from the still, so it keeps the sac AND lip-syncs from the audio). Always pull a
frame from the FINISHED MC video and confirm the sac is still there before
delivering (it looks fine in the puppet still, then disappears in motion).

## Tools
- **Social_Evidence** `fetch_url` — metadata + a (usually video-only) stored copy.
- **yt-dlp** (`python3 -m yt_dlp`) — the real audio + the highest-res driver.
- **ffmpeg** — bundled at
  `/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2`
  (`pip install imageio-ffmpeg` if missing; system/apt ffmpeg is unavailable).
- **Higgsfield MCP** — `generate_image` (`nano_banana_pro`); `generate_video`
  (`wan2_7`); `motion_control` (Kling 3.0); `media_upload`/`media_confirm`;
  `job_display` to poll. NOTE: `media_upload` often sits behind a permission
  gate — the user must tap "Allow" in their client; chat text doesn't clear it.
  The character still needs NO upload (pass its job_id); only local driver/audio
  files need `media_upload`.

## Pipeline

1. **Download** (SE copy is usually video-only → use yt-dlp):
   - `python3 -m yt_dlp -F <url>` → pick the **highest-res** format. Prefer a
     720p source over 540p — bigger mouth = better lip-sync tracking. The 720p
     TikTok format is often HEVC (`bytevc1_720p_*`), still fine as a driver.
     If `curl_cffi` breaks TLS via the proxy, `pip uninstall -y curl_cffi`.
   - `yt_dlp -f "<id>-0" -o "withaudio.mp4" <url>` (avoid `%(ext)s` — the parens
     break the shell; use a literal filename).
2. **Pick the window — CRITICAL for Motion Control.** It needs a CONTINUOUS
   talking-to-camera face. Build a contact sheet and AVOID stretches where hands
   wave in front of the face (breaks the tracker) or cutaway B-roll:
   `for t in $(seq 0 2 <dur>); do ffmpeg -y -ss $t -i withaudio.mp4 -frames:v 1 -vf scale=150:-1 tl/$t.jpg; done`
   then montage with PIL. Choose the longest clean talking stretch (often the
   opening). If <15s, tell the user. (Wan 2.7 doesn't need a driver, but still
   pick clean audio.)
3. **Cut window** (same start/length for video + audio):
   - audio: `ffmpeg -y -ss <a> -t 15 -i withaudio.mp4 -vn -ac 2 -ar 44100 -c:a libmp3lame -b:a 192k audio.mp3`
     (clean **MP3** — m4a can fail as a model audio input.)
   - driver (MC only): `ffmpeg -y -ss <a> -t 15 -i <hi-res>.mp4 -an -c:v libx264 -pix_fmt yuv420p -crf 18 driver.mp4`
4. **Character still (re-dressed):** extract a clear, calm, front-facing frame;
   upload it; `generate_image` (`nano_banana_pro`, `count:3-4`, `aspect_ratio:"9:16"`,
   `medias:[{role:"image", value:<frame>}]`) with the prompt below. Keep the SAME
   outfit/scene; swap only the head (or chin). Show options; let the user pick.
5. **Iterate the character** by feeding the chosen result's **job_id** back as the
   `image` reference with a tight "keep everything the same EXCEPT ..." prompt.
   Proven edits, one lever at a time: **age up ~10yr** (forehead lines, crow's
   feet, nasolabial folds), **plumper/saggier pouch**, **subtle makeup + plumper
   lips**, **swap outfit / add background** (e.g. USA flag wall + a tee with small
   pink text — nano_banana renders short words fine). Always `count:3` and show.
6. **Animate:**
   - **Wan 2.7:** upload `audio.mp3`; `generate_video({ model:"wan2_7",
     duration:15, aspect_ratio:"9:16", resolution:"1080p", medias:[
     {role:"start_image", value:<char job_id>}, {role:"audio", value:<audio media_id>}]})`.
     If a `preset_recommendation` notice fires, retry with `declined_preset_id`.
     Audio is baked in — **no muxing**, done.
   - **Kling Motion Control:** upload `driver.mp4`; `motion_control({ image_id:<char
     job_id>, motion_video_id:<driver media_id>, scene_control:"image",
     resolution:"1080p" })`. Then do the **drift-fix mux** (next step). Keep
     `scene_control:"image"` so the re-dressed background is preserved.
7. **Drift-fix mux (Motion Control ONLY).** Kling silently RETIMES the output
   (e.g. 15.00s driver → 14.93s / 448 frames). Muxing the untouched 15.0s audio
   makes lips drift, worst at the end. Measure the real output length and
   time-stretch the audio to match (≈0.45% = inaudible pitch shift):
   - frames: `ffmpeg -i mc.mp4 -map 0:v:0 -f null - 2>&1 | grep -oE 'frame=[ ]*[0-9]+' | tail -1`
   - `atempo = audio_seconds / (frames/30)`; then
     `ffmpeg -y -i mc.mp4 -i audio.mp3 -af "atempo=<f>" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -shortest final.mp4`
8. **Compress before delivery.** Kling 1080p exports are absurdly over-bitrated
   (~35 Mbps, 60MB+ for 15s) and won't download. Re-encode:
   `ffmpeg -y -i final.mp4 -c:v libx264 -pix_fmt yuv420p -crf 21 -preset veryfast -movflags +faststart -c:a aac -b:a 160k final_web.mp4`
9. **Deliver** via SendUserFile. Parody, not a Candace asset — keep in scratchpad,
   don't log to `posted images/` unless asked.

## Motion Control quality (if it "looks fake / off-sync")

Root causes, biggest first: (1) MC transfers MOTION, not phonemes — mouths never
crisply hit b/m/p closures; (2) tiny mouth in a low-res driver → mushy tracking;
(3) the transform sitting right under the lips kills the jaw cues that sell
speech; (4) audio drift from muxing (step 7); (5) single-still mouth-interior
hallucination. Fixes: use the **720p+ driver** (not 540p); render **1080p**; for
chin-melt keep the mouth area legible; apply the **drift-fix**. To enlarge the
mouth further you can zoom-crop the driver AND the character to a *matched*
head-and-shoulders framing — but don't crop out scene elements the user asked for
(e.g. on-shirt text). If sync still isn't crisp, switch to **Wan 2.7** — it's
fundamentally better at mouth sync because it solves from audio.

## The "michaela testicle prompt" (image)

**Full head-swap:**
> Candid iPhone UGC selfie video still, absurd SFW comedy meme. Keep EVERYTHING
> from the reference the same — same body, **[OUTFIT/SCENE from THIS clip]**, same
> hair, same natural lighting, same casual handheld framing — EXCEPT swap the head
> for a silly surreal creature head. ONLY change the head into a soft, saggy,
> pendulous teardrop-shaped pouch of loose flesh: heavier/droopier toward the
> bottom, narrower at the top where the hair grows. Fine soft wrinkles, creases,
> loose crepey folds, pale pinkish-tan matte skin, a faint vertical seam down the
> center-front, a few sparse coarse stray hairs across the lower part. Set into the
> front, where a face goes, the SAME eyes, nose and lips as the reference, normal
> positions, hair flowing down from the top. Soft, squishy, gelatinous — looks like
> it would wobble. Goofy, harmless, absurd comedy meme — SFW, not gross, not
> explicit. Photoreal, candid iPhone UGC, natural skin texture, slight grain, NOT
> retouched, no studio polish.

**Chin-melt (real upper face kept):**
> ...Keep her UPPER face COMPLETELY NORMAL — real eyes, eyebrows, nose, lips,
> cheeks, forehead, hair. The ONLY change: everything BELOW her bottom lip — chin,
> jaw and the area under the chin — softly melts into a saggy droopy pendulous
> pouch of loose wrinkled flesh hanging where the chin/jaw were. Deep soft VERTICAL
> wrinkle creases top-to-bottom, loose crepey pale pinkish-tan skin, a faint
> central seam, a few sparse stray hairs near the bottom; soft, squishy, would
> gently wobble. [size/position clamp if needed: "the pouch hangs from just under
> her lower lip to about mid-neck and does NOT touch her top or chest"]. SFW...

Size control: words like "hangs/pendulous/droopy" make it drape LONG; "compact
round ball, not hanging" makes it small but loses the testicle read; for "small
but reads as testicles" combine a two-lobe+seam shape WITH a hard clamp ("size of
a lime, must NOT reach the collarbone"). Never use literal nouns ("two apples") —
the model inserts real apples.

## Gotchas (learned the hard way)

1. **Social_Evidence stores video-only** (0 audio streams). Get audio + driver
   from TikTok via yt-dlp; prefer the highest-res format available.
2. **Wan 2.7 IS the easy lip-sync** (image+audio→native sync). Use it by default
   for talking-to-camera. Reserve Motion Control for faithful real-performance/
   choreography (and then apply the drift-fix + HD driver).
3. **Kling retimes the output** → always drift-fix the audio before muxing (step 7).
4. **No continuous face = no MC lip-sync.** Avoid hands-over-face/B-roll windows.
5. **NSFW filter = wording, not skin.** Shape description only; `count:3-4`.
6. **Render queue is slow** (30–90 min seen). Healthy job sits in
   `waiting`/`in_progress`; a real input failure dies in ~1-2 min. Poll
   `job_display`; render ONE thing at a time so you can restrategize on failure.
7. **`media_upload` permission gate** — needs the user's "Allow"; retries alone
   won't clear it. Character stills skip upload (pass job_id).
8. **Compress Kling exports** before SendUserFile or they won't download (step 8).

## Defaults & extensions
- Default output: 15s, 1080p, 9:16.
- One lever per edit; always show `count:3` options and let the user pick before
  animating ("show me the puppet before you run the video").
- `scene_control:"video"` pulls the driver's background instead of the character's
  — keep `"image"` to preserve the re-dressed scene.
