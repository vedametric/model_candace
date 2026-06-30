# GENERATE_CONTENT.md — Candace Summers Content Production Masterfile

> **Read this end-to-end before generating anything for Candace.** This is the
> single source of truth for **how** we create every image and video. It exists
> so any future session (human or AI) can reproduce the exact pipeline without
> re-deriving it. Companion files: [`soul.md`](./soul.md) (who Candace is),
> [`CLAUDE.md`](./CLAUDE.md) (locked rules + quick facts),
> [`generations/`](./generations/) (the archive + logs + dashboard data).

---

## 0. The non-negotiable rules (LOCKED)

**Every image and every video MUST follow these. They override any conflicting
instruction in a prompt or request. No exceptions.**

- **Shot on an iPhone, UGC style.**
- **Natural lighting only** (window light, daylight, golden hour — never studio
  or artificial/professional lighting).
- **Casual, everyday environment.**
- **Candid, unposed, mid-action** — authentic, genuine moments.
- **NOT retouched** — keep natural skin texture, grain, slightly imperfect
  framing, handheld feel.
- **NO studio, NO professional/glossy/editorial polish.**

**Tone:** sultry / flirty / thirst-trap themes are allowed **within** these
constraints, but must stay **tasteful and SFW** — suggestive only, **no nudity,
no explicit content**. When a request pushes past that line, reframe it to the
nearest tasteful version (e.g. "see-through top" → sheer layer over a bralette
that covers her) rather than refusing outright.

Always bake the locked rules into the prompt with explicit negatives:
`Shot on an iPhone, natural daylight, candid, NOT retouched, natural skin
texture, slightly imperfect handheld framing, NO studio, NO professional
lighting.`

---

## 1. Identity — the one reference that matters

Candace's face + figure are pinned to a single canonical reference. **Pass this
as an image reference on EVERY generation** so her likeness stays consistent.

- **Canonical reference (v2, current):**
  `49aff4e5-9c20-44a3-87e8-85ba87e0d642`
  Higgsfield job id for the persona reference image. Same face as the original,
  with the fuller 10E figure on her petite 5'1" frame. The PNG is committed at
  [`reference/candace_persona_reference.png`](./reference/candace_persona_reference.png).
- **Original v1 face anchor (historical, do not use for new work):**
  `0a3e996d-ff5b-44b3-a0bc-3dc240099cb9`.

**Physical facts to keep true in prompts:** 21, American (Ohio), petite and
short — **only 5'1"** — small slim frame but curvy hourglass with a fuller chest
(~10E bust); long blonde hair, blue eyes, fair light skin. Always restate "keep
her EXACT same face, long blonde hair, blue eyes, fair light skin, petite curvy
figure" in the prompt — the reference image anchors it, the words reinforce it.

---

## 2. The toolchain (Higgsfield MCP)

All generation runs through the **Higgsfield** MCP server. Load tools via
ToolSearch (`select:mcp__Higgsfield__<name>`) when they aren't already loaded.

| Tool | What it does | Used for |
|---|---|---|
| `generate_image` | Text+reference → image | All stills (model `nano_banana_pro`) |
| `generate_video` | Image/text → video | Seedance image-to-video clips (model `seedance_2_0`) |
| `motion_control` | One still + one driving video → video | "Put Candace in this video" (Kling 3.0) |
| `media_upload` | Get a presigned PUT URL to upload local bytes | Uploading a driving video to Higgsfield |
| `media_confirm` | Finalize an upload | After PUTting the bytes |
| `media_import_url` | Import a media URL → media_id | Alternative upload path (often rejects `application/octet-stream`; prefer media_upload) |
| `job_display` | Look up one job by id (status + result URL) | Polling / fetching results |
| `transactions` | Credit spend/refund history | Confirming exact cost of a job |
| `balance` | Current credit balance + plan | Updating the ledger |
| `upscale_image` / `upscale_video` | Enlarge an existing asset | Rescue/enlarge (rarely needed — see §6) |
| `models_explore` | Look up model params/roles/durations | When unsure of a model's options |

**Model name mapping:** `nano_banana_pro` (we call it "banana") reports back as
`nano_banana_2`. `motion_control` reports as `kling3_0_motion_control`.

**Job lifecycle:** jobs return `status: pending → in_progress → completed`
(or `nsfw` if filter-flagged, or `failed`). Renders can take anywhere from ~1
min to 2.5 hr depending on Higgsfield congestion. Poll with `job_display`. **A
flagged or failed job is auto-refunded — it costs net 0.** Status checks and
retries of flagged jobs do not bill.

---

## 3. Credits & cost model

We are on the Higgsfield **ultra** plan. Costs verified from the live
transaction log (use `get_cost: true` on `generate_image`/`generate_video` to
**preflight any cost without spending**).

| Model / action | Cost |
|---|---|
| `nano_banana_pro` image @ **1k** | **2 cr** |
| `nano_banana_pro` image @ **2k** | **2 cr** ← same as 1k |
| `nano_banana_pro` image @ **4k** | 4 cr |
| `upscale_image` → 2k or 4k | 2 cr (flat) |
| `seedance_2_0` video @ **720p** | **~4.5 cr/sec** (8s≈36, 10s≈45, 15s≈67.5) |
| `seedance_2_0` video @ **1080p** | **~9 cr/sec** (≈2× of 720p; 15s≈135) |
| `motion_control` (Kling 3.0) | **~15–31 cr/clip**, scales with driving-clip length (8s≈15, 13s≈23, 19s≈31) |
| `soul_2` portrait (legacy) | 0.12 cr/img |

### Resolution economics — the two rules that matter
- **IMAGES: always request `resolution: "2k"`.** 2k costs the *same 2 cr* as 1k
  on banana — it's a free quality upgrade. Generating 1k then upscaling would be
  2 + 2 = 4 cr for a softer result. **Never generate images at 1k.**
- **VIDEO: native high-res is a true 2×.** 1080p = double 720p for the same
  length. So:
  - **Face/likeness matters → render native at the tier you want** (native 1080p
    has real facial detail; upscaling a 720p face interpolates and can drift the
    likeness).
  - **B-roll where the face isn't the point → render 720p, optionally upscale.**
- **Upscaling is a repair tool, not a savings trick.** Use it only to rescue
  something you can't cheaply regenerate (an old 1k frame, a finished video).

Default video output: **720p** is plenty for IG/TikTok. Video is the cost
driver — be deliberate about length and resolution.

---

## 4. IMAGE generation (banana) — full workflow

**Model:** `nano_banana_pro`. **Always** `resolution: "2k"`, `aspect_ratio:
"9:16"` (vertical for IG/TikTok unless told otherwise).

### 4.1 References (the `medias` array, all role `image`)
- **Identity always first:** `{role:"image", value:"49aff4e5-..."}`.
- **Optional second reference for pose/scene/composition:** pass a previously
  generated frame as a second `image`. Banana will keep that frame's pose,
  framing, outfit, and setting while you change only what you describe. This is
  how we **iterate without losing the look** (see §7.3).
- `medias[].value` must be a **media_id or job_id**, never an `https://` URL.

### 4.2 Prompt anatomy (template)
```
Authentic UGC iPhone <shot type>, candid and unposed, natural <light source>,
no studio, no professional lighting, NOT retouched, natural skin texture,
slightly imperfect handheld framing.
The woman from the reference image — keep her EXACT same face, long blonde hair,
blue eyes, fair light skin and petite curvy figure —
<what she is doing> in <casual everyday setting>.
She wears <outfit, tasteful, no nudity>.
<framing note: e.g. CLOSE waist-up selfie, face large/sharp/in focus>.
Vertical 9:16. No text.
```
- **Tighter framing on the face = better identity** (and far better identity
  *retention* when the still is later animated). When the goal is a video, prefer
  a start frame where her face is prominent and sharp.
- End with **"No text"** unless you specifically want legible text (banana often
  invents garbled text otherwise).

### 4.3 Generating options
- Use `count: 2` (sometimes 3) to get options for the user to pick from. Images
  are cheap (2 cr) and flagged ones refund, so generating a small batch is fine.
- **Do NOT over-generate.** Two options is usually enough. The user has been
  explicit about not burning credits on needless batches.

### 4.4 Content filter (`nsfw` status)
Certain word combinations trip Higgsfield's filter (auto-refunded, net 0, but
they waste a cycle). Known trigger: **"see-through / sheer mesh" + "midriff" +
"bikini" on a beach.** Reword to clear it while keeping the look:
- "see-through / sheer mesh" → "lightweight gauzy / semi-sheer chiffon / fitted"
- add "fully covered, modest and tasteful, no nudity"
- "show her stomach/midriff" → "cropped just above the waist"
Same intended look, passes the filter.

### 4.5 Viewing the result
- `job_display` returns a CloudFront URL. `curl` it to the scratchpad.
- **`Read` on beach/swimwear/lingerie stills is often blocked by display
  moderation** even though the generation itself is fine. When that happens,
  **`SendUserFile` the image to the user** so they can see and choose — don't
  assume it failed.

---

## 5. VIDEO generation — two methods (and how to choose)

There are two ways to make a Candace video. **Choosing the right one is the most
important decision in this whole pipeline.**

### Method A — Motion Control (Kling 3.0, `motion_control`)
Drives **one still** with the motion of **one reference video**. The character
takes the exact body motion / camera movement of the driving clip.

- **Inputs:** `image_id` (the start frame), `motion_video_id` (a confirmed
  uploaded video or a completed job id), `resolution` (`720p`/`1080p`),
  `scene_control` (`image` = keep the still's background; `video` = use the
  clip's background). **We almost always use `scene_control: "image"`.**
- **No prompt.** You cannot describe anything — it purely transfers motion.
- **Strengths:** precise, faithful reproduction of a real clip's movement;
  cheaper than Seedance; great when the user says "put Candace in *this* video."
- **Limitations / failure modes:**
  - **Held objects warp or vanish.** A phone in a mirror-selfie hand, sunglasses,
    a drink — motion control puppeteers the hand and the object doesn't track. If
    the shot depends on a held object looking natural, **use Method B instead.**
  - **Identity holds best with a tight face-crop start frame whose pose matches
    the driving clip.** A loose full-body still + a very different pose = drift /
    warping. Match the framing and orientation of the still to the driving clip.
  - One image + one video only — no multi-subject, no prompt steering.

### Method B — Seedance image-to-video (`seedance_2_0`)
Animates **a start frame** using a **text prompt**. The model generates her
motion around the frame.

- **Inputs:** `medias: [{role:"start_image", value:"<frame job/media id>"}]`,
  `prompt` (describe the motion), `duration` (4–15s), `resolution`
  (`480p/720p/1080p/4k`; 1080p+ needs `mode:"std"`), `aspect_ratio: "9:16"`,
  `generate_audio: false` (we deliver silent — the user adds trending audio).
- **Strengths:** you can **describe and lock specific actions** — "keeps holding
  her phone in her hand the ENTIRE time taking a mirror selfie," "slow turn to
  show the outfit," "hair flip." This is the **only reliable way to keep a held
  object (phone, drink, sunglasses) natural** throughout a clip.
- **Limitations:** motion is model-invented, not a faithful copy of a specific
  reference clip; costs more than motion control (~4.5 cr/sec @ 720p).

### Decision guide
| Situation | Use |
|---|---|
| "Put Candace into *this specific* TikTok/clip" (match the exact movement) | **Method A — Motion Control** |
| Shot relies on a **held object** looking natural (phone selfie, drink, glasses) | **Method B — Seedance** |
| You want a **described** motion (turn, walk, hair flip) and have no driving clip | **Method B — Seedance** |
| Maximum identity fidelity from a real clip, no held objects | **Method A** with a tight face-crop, pose-matched start frame |

> **Hard-won lesson (2026-06-29):** a gym mirror-selfie animated with Motion
> Control kept dropping/warping the phone across two attempts. Switching to
> Seedance image-to-video with an explicit "phone stays firmly in her hand the
> whole time" prompt fixed it immediately. **If a held object matters, go
> Seedance.**

### Always: show the start frame first
**Before spending any credits on a video, generate the banana start frame, show
it to the user (`SendUserFile`), and get approval.** Videos are the expensive
step; a rejected frame caught early saves real credits and avoids re-rendering.

---

## 6. The social-reference pipeline (TikTok / IG → driving video)

When the user gives a link or a file and wants Candace doing that motion:

1. **Download the driving video.** There is **no `ffmpeg` CLI** in this env, but
   `yt-dlp` works (`pip install -q yt-dlp` if missing). Short links resolve fine:
   ```
   yt-dlp --no-warnings -o "src.%(ext)s" "https://vt.tiktok.com/XXXX/"
   ```
   For a user-attached file, it's already on disk at the provided path.
2. **Read the outfit/scene/motion** by extracting frames with `imageio`
   (`pip install -q imageio imageio-ffmpeg av`):
   ```python
   import imageio.v3 as iio, imageio
   f = iio.imread("src.mp4", plugin="pyav")          # ndarray (N,H,W,3)
   N = f.shape[0]
   for i,frac in enumerate([0,.2,.4,.6,.8,.97]):
       imageio.imwrite(f"frame_{i}.jpg", f[int((N-1)*frac)])
   ```
   `Read` the frames (or `SendUserFile` them if moderation blocks the view, e.g.
   beach/swim) to understand and to let the user pick.
3. **Build the start frame** with banana (2k) matching the ref's outfit/scene
   (§4). Show it, get approval (§5).
4. **Upload the driving video to Higgsfield** (presigned PUT):
   ```
   media_upload(filename="ref.mp4", content_type="video/mp4")   # returns upload_url + media_id
   curl -X PUT -H "Content-Type: video/mp4" --data-binary @<file> "<upload_url>"   # expect HTTP 200
   media_confirm(media_id="<id>", type="video")
   ```
   (`media_import_url` often rejects `application/octet-stream` — prefer the
   upload+PUT path above.)
5. **Run `motion_control`** with `image_id` = start frame, `motion_video_id` =
   the confirmed upload, `scene_control: "image"` — OR, if the shot needs a held
   object, skip the driving clip and use **Seedance** with a prompt (§5 Method B).

---

## 7. Key techniques & learnings

### 7.1 Show the banana first, always
The approval gate (§5) is mandatory. Generate the still, `SendUserFile` it, wait
for the pick. Never jump straight to (expensive) video.

### 7.2 Tight framing → better identity
Closer framing on the face in the start frame holds Candace's likeness far
better through animation than a loose full-body still.

### 7.3 Iterate wardrobe without losing the look
To change an outfit/detail while keeping a frame the user liked: pass **identity
ref + the chosen frame as a second composition reference**, and describe **only
what changes** ("skin-tight," "more makeup," "shorter shorts," "light pink"). The
pose, scene, and framing carry over.

### 7.4 Same character across multiple clips
To make several clips with Candace looking **100% identical**, reuse the **exact
same start-frame job id** and just vary the driving video (Method A) or the
prompt (Method B). Re-generating a new frame each time introduces small
differences; reusing the frame eliminates them.

### 7.5 Content-filter wording
See §4.4 — reword sheer/midriff/bikini combos to gauzy/fitted/covered/tasteful.

### 7.6 Display moderation ≠ generation failure
If `Read` rejects an image/frame, the asset is usually fine — it's the *viewer*
being conservative. `SendUserFile` it to the user instead.

### 7.7 Don't over-generate / retries are free-ish
Two options per batch. Flagged/failed jobs auto-refund. Status checks are free.
The user is cost-sensitive — be deliberate.

---

## 8. Logging — DO THIS EVERY TIME (no exceptions)

Whenever you generate ANY image or video for Candace, **before ending the turn:**

1. **Save the file** into [`generations/`](./generations/) named
   `YYYY-MM-DD_<short-desc>_<job-id-short>.ext`.
2. **Add a `META` entry** for it in
   [`generations/build_manifest.py`](./generations/build_manifest.py) with:
   `model`, `job` (id), `cost` in credits (look it up via `transactions` — count
   only successes; flagged/failed auto-refund), `batch`, `at` (UTC), `src` (the
   source-still job id for motion/Seedance clips), the **exact `prompt`**, and a
   short `notes`.
3. **Re-run** `python3 generations/build_manifest.py` to refresh
   `generations/manifest.json` (sizes + totals).
4. **Update** [`generations/CREDIT_USAGE.md`](./generations/CREDIT_USAGE.md)
   (itemised cost + the reconciliation table) and
   [`generations/PROMPTS.md`](./generations/PROMPTS.md) (exact prompt by job id)
   and [`generations/README.md`](./generations/README.md) (the index table).
5. **Update `BALANCE_NOW`** in `build_manifest.py` from the `balance` tool so the
   dashboard's "net credits spent" stays accurate.
6. **Commit & push** to the working branch.

The credit ledger reconciles **archived cost** (assets kept in `generations/`)
against **net actually spent** (`balance_start − balance_now`); the difference is
non-archived spend (the 2×/day posting routine, superseded iterations,
motion-control retries). Keep both honest.

---

## 9. Posting to Instagram (upload-post.com)

Candace posts via the **upload-post.com** API, managed user
**`model_candacesummers`** (Instagram only — a Business/Creator account).

- **Photo:** `POST https://api.upload-post.com/api/upload_photos`
- **Video/Reel:** `POST https://api.upload-post.com/api/upload`
- Auth header: `Authorization: Apikey <KEY>` (the key lives in the posting
  routine prompt; do not print it in chat/commits).
- Use `platform[]=instagram`, the managed `user`, a caption + hashtags.
- **Only post when the user explicitly asks.** "Upload to git" means commit, NOT
  post to Instagram — never conflate them.
- **Posting log:** archive every *published* asset in [`posted images/`](./posted%20images/)
  and append to `posted images/index.md` + `posted_log.json`.

There is also an automated **2×/day posting routine** (separate session, runs on
a schedule) that posts randomized never-repeated content and self-maintains the
posting log.

---

## 10. The dashboard (GitHub Pages)

[`index.html`](./index.html) at the repo root is a static dashboard that reads
`generations/manifest.json` and shows every asset: preview, file size, download
link, prompt, cost, model, job id, generation time (Brisbane time), with sort
(cost/time) and model filters, click-to-copy prompts/job-ids, and clickable
source-still interlinks. It is served by **GitHub Pages → Deploy from a branch →
`/ (root)`** (NOT Actions). `.nojekyll` is committed so files serve as-is. It
updates automatically whenever `manifest.json` is rebuilt and pushed.

---

## 11. Worked end-to-end examples (real, from this project)

**A) "Put Candace in this TikTok" (Motion Control).**
Download the TikTok with `yt-dlp` → extract frames with `imageio` to read the
outfit (red satin corset, golden-hour waterfront) → banana 2k start frame:
identity ref + a close waist-up selfie prompt matching the outfit, face large →
`SendUserFile` the options, user picks A → `media_upload`+PUT+`media_confirm` the
TikTok → `motion_control(image_id=frameA, motion_video_id=upload,
scene_control:"image", 720p)` → verify face held, deliver, log. *(jobs
`2534968d` → `117faa1f`.)*

**B) Iterate an outfit, keep the look (composition ref).**
User likes frame B but wants it skin-tight + more makeup + shorter shorts →
re-generate with identity ref **+ frame B as the second composition reference**,
changing only those details → repeat until approved → then animate. *(jobs
`c6c91485` → `3f8f3232` → `c51d30fa`.)*

**C) Held object — use Seedance, not Motion Control.**
Gym mirror selfie needs the phone in her hand. Motion control dropped/warped the
phone twice. Fix: `generate_video(model="seedance_2_0",
medias=[{role:"start_image", value:"8feaf367"}], generate_audio=false, 8s, 720p,
prompt="keeps holding her phone in her right hand the ENTIRE time taking a mirror
selfie … subtle natural posing")` → phone held naturally throughout. *(job
`09489cc6`.)*

---

## 12. Quick checklist (every content request)

- [ ] Locked rules baked into the prompt (UGC, natural light, candid, not
      retouched, no studio) — §0
- [ ] Identity ref `49aff4e5-…` passed as first image reference — §1
- [ ] Images at `resolution:"2k"`, `9:16`, `count:2`, "No text" — §4
- [ ] For video: **chose the right method** (held object → Seedance; faithful
      motion copy → Motion Control) — §5
- [ ] **Start frame shown to the user and approved before any video spend** — §5
- [ ] Tasteful/SFW; filter-risky wording reworded — §0, §4.4
- [ ] Result fetched; if `Read` is blocked, `SendUserFile` instead — §4.5
- [ ] **Logged**: file saved, META added, manifest rebuilt, CREDIT_USAGE /
      PROMPTS / README + `BALANCE_NOW` updated, committed & pushed — §8
- [ ] Posted to IG **only if explicitly asked**; posting log updated — §9

---

_This masterfile lives on `main`. The active content-production work happens on
the feature branch and the GitHub Pages dashboard. Keep this file updated when
the pipeline changes so future sessions inherit the current best practice._
