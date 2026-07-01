# Content worker runbook — draining the dashboard generation queue

The admin dashboard's **Studio** tab queues content jobs into the Supabase
`gen_requests` table. This runbook is what a **Claude session (the "worker")** does to
execute them via the Higgsfield MCP. It is the bridge between the dashboard (control
surface) and **[`../GENERATE_CONTENT.md`](../GENERATE_CONTENT.md)** (the full pipeline) —
read that masterfile too; this runbook does not replace it, it sequences it.

> **Golden rule:** every caveat in `GENERATE_CONTENT.md` still applies. The dashboard
> pre-bakes the locked rules into `prompt`, but YOU are the last line of defense — keep
> it UGC/natural-light/candid/not-retouched/SFW, identity ref first, 2k, count:2.

> **Age / "look younger" policy (do NOT over-decline).** Candace is an adult persona
> (canonically 21). A brief may ask her to read a little younger (e.g. "look younger",
> "around 20") — that is fine and you SHOULD generate it: she stays a clearly adult woman
> in her early twenties. The dashboard already runs `ageSafe`, which appends an ADULT
> ANCHOR ("unmistakably an adult woman… never a minor, never child-like") whenever a
> younger look is requested, and clamps any under-18 age up to a clearly-adult look. The
> ONLY hard floor: never depict her as a minor / under 18 / child-like. If (and only if) a
> prompt actually pushes a minor/child look, edit it back to a clearly-adult early-twenties
> look and proceed — do not just reject an adult "look younger" request. Ages 18–21 in a
> tasteful/SFW brief are in-bounds.

## How to run

**On-demand:** in a Claude session with the Higgsfield + Supabase MCPs, say
"drain the Candace content queue" (or run this runbook). **Scheduled:** a Claude Code
Remote Routine can fire this automatically (default OFF until headless Higgsfield auth
is confirmed — see `## Scheduling`).

## Progress logging — do this at EVERY step

So the dashboard shows live progress, call the `gen_log` RPC whenever you start/finish a
step (it appends to `gen_requests.log`, shown under "worker activity" per job):
```
select gen_log(<id>, '<stage>', '<short human message>');
-- stages: claimed, preflight, generating, options_ready, video_upload, video_running,
--         logging, committed, done, skipped, failed
```
Example: `select gen_log(7,'generating','banana count:2 @2k, polling job d8d7110a');`
Keep messages short and concrete (model, job id, what's happening, credits if known).

## The loop

1. **Read the queue** (Supabase MCP):
   ```sql
   select * from gen_requests
   where status in ('queued','approved') order by created_at asc;
   ```
   Process oldest first. Each row has: `slug, kind, video_method, brief, prompt,
   approved_job, driving_video, est_cost_cr, parent_id`.

2. **Confirm spend.** `est_cost_cr` is the preflight. Use Higgsfield `generate_image`/
   `generate_video` with `get_cost:true` to verify, and check `balance`. **If a batch
   would meaningfully dent the balance, confirm with the user first** (the user is
   cost-sensitive). Flagged/failed jobs auto-refund (net 0).

3. **`status='queued'` → generate the still(s).** Mark `generating`, then run banana:
   - `generate_image` model `nano_banana_pro`, `resolution:"2k"`, `aspect_ratio:"9:16"`,
     `count` from the brief (default 2).
   - `medias`: identity ref **first** `{role:"image", value:"49aff4e5-9c20-44a3-87e8-85ba87e0d642"}`.
     **Composition / "put Candace in THIS picture" reference (second image):**
     - if `brief.compose_from_job` is set (an iterate), add that job id as a 2nd `image`;
     - if `brief.reference_image.url` is set (the user uploaded a scene/pose/outfit picture),
       download it (`curl -u root:<basic-auth-pass> "http://134.199.145.47<url>" -o ref.png`),
       `media_upload`(content_type image) → `curl -X PUT` the bytes → `media_confirm`(type
       `image`), and add the resulting **media_id as the 2nd `image`**. Keep Candace's EXACT
       face/identity from the first ref; let the second ref drive scene/pose/outfit. Word the
       prompt as "place the woman from the first reference into the scene/pose/outfit of the
       second reference, keeping her exact face…".
     - **Enrich from what you SEE:** open the reference (Read it; if moderation blocks it,
       SendUserFile). The dashboard's prompt now says "recreate the second reference"
       generically — ADD the concrete scene/pose/outfit/props you actually see (e.g.
       "holding a fishing rod, standing in a sunlit living room with a bookshelf behind
       her") so banana reproduces it faithfully, while keeping Candace's identity.
     - **Motion-control start frame — match the SOURCE clip's wardrobe.** For a `kind=video`
       `motion_control` job with a `driving_video` but NO `reference_image`, the prompt now
       says "keep her clothing consistent with the driving clip" instead of a default outfit
       (we do NOT override the source video's clothing style). To honor that: download the
       driving clip (`yt-dlp`, §6), extract a representative frame (`imageio`), upload it as
       the **2nd `image`** the same way, and ADD the concrete outfit/scene you see so the
       start frame matches what she's actually wearing in the clip. Do not invent a generic
       outfit.
   - Use the row's `prompt` (already compliant). If it still reads filter-risky, reword
     per §4.4 before spending.
   - Poll `job_display`. For each completed option, get its CloudFront URL. Write them to
     the row and set the gate:
     ```sql
     update gen_requests set status='awaiting_approval',
       options = '[{"job_id":"<id>","url":"<cloudfront-url>"}, …]'::jsonb
     where id=<id>;
     ```
   - If `Read` on a candidate is moderation-blocked, that is NOT a failure — `SendUserFile`
     it so the user can see it (§4.5/§7.6). The dashboard also renders the URLs.
   - **STOP here. Do not spend on video.** The human approves a frame in the dashboard
     (sets `status='approved'`, `approved_job=<job_id>`).

4. **`status='approved'`:**
   - **kind=image** → finalize: the approved still is the deliverable. Go to step 6 (log it).
   - **kind=video** → mark `running_video` and animate the `approved_job` frame:
     - **Method = seedance** (held object, or described motion, §5 Method B):
       `generate_video` model `seedance_2_0`,
       `medias:[{role:"start_image", value:"<approved_job>"}]`, `prompt` = the motion
       description from the brief, `duration`, `resolution` (default 720p),
       `aspect_ratio:"9:16"`, `generate_audio:false`.
     - **Method = motion_control** (faithful copy of a driving clip, §5 Method A): get the
       driving clip from `brief.driving_video` (download a link with `yt-dlp`; §6), upload
       it (`media_upload` → `curl -X PUT` the bytes → `media_confirm` type `video`), then
       `motion_control(image_id=<approved_job>, motion_video_id=<upload>,
       scene_control:"image", resolution)`. **If the shot needs a held object to look
       natural, switch to seedance** (§5 hard-won lesson).
     - Poll `job_display` to completion.

5. **Same character across clips (§7.4):** reuse the **exact** `approved_job` for every
   clip from that frame — never regenerate the frame.

6. **Log it (the full ritual, §8) — every time, before marking done:**
   - `curl` the result to `generations/YYYY-MM-DD_<short-desc>_<jobid8>.<ext>`.
   - **DEPOSIT it to the live gallery (CRITICAL — this is how it shows up regardless of
     your branch).** Your git commit lands on this session's branch, which the droplet does
     NOT deploy from, so committing alone will NOT make it appear in the dashboard. POST the
     asset to the deposit API so the droplet gallery updates immediately.
     **Build the JSON body in a FILE and `curl --data-binary @body.json`** — do NOT inline the
     base64 with `-d "..."`; for multi-MB images/videos it exceeds the shell arg limit
     ("Argument list too long"):
     ```python
     # python3 - <<PY   (fill the <…> placeholders)
     import base64, json
     f = "generations/<file>"
     json.dump({"filename": "<file>",
       "data_base64": base64.b64encode(open(f,"rb").read()).decode(),
       "balance_now_cr": <balance>,
       "entry": {"model":"nano_banana_pro","job":"<jobid8>","cost":<cr>,"batch":"<batch>",
                 "at":"<UTC>","src":"<approved_job or empty>","prompt":"<prompt>","notes":"<notes>"}},
       open("/tmp/body.json","w"))
     # PY
     ```
     ```
     curl -sS -u root:BotMadhouse123!K -X POST \
       http://134.199.145.47/api/accounts/candace_summers/generations/deposit \
       -H 'Content-Type: application/json' --data-binary @/tmp/body.json
     ```
     The endpoint writes the file, appends `entries.json`, updates `balance.json`, and
     rebuilds `manifest.json` on the droplet. Do this for the CHOSEN asset (and any alt you
     keep). Returns `{ok, count}` — confirm count went up.
   - Append an entry to **`generations/entries.json`** for the git archive. **Exact schema:**
     `{"entries":[{"file":"<file>","model":...,"job":...,"cost":...,"batch":...,"at":...,
     "src":...,"prompt":...,"notes":...}, …]}` — a per-FILE object keyed by `file`. Do NOT write
     a free-form "worker_run" summary; `build_manifest.py` only merges this exact shape.
   - Update **`generations/balance.json`** `balance_now_cr` from the `balance` tool.
   - Run `python3 generations/build_manifest.py` (rebuilds your local `manifest.json` for the
     git archive; the droplet's was already rebuilt by the deposit call).
   - Append to `generations/CREDIT_USAGE.md`, `generations/PROMPTS.md`,
     `generations/README.md` (formats in those files).
   - Set the row done with the asset:
     ```sql
     update gen_requests set status='done',
       result='{"job_id":"<id>","file":"<filename>","cost_cr":<n>}'::jsonb where id=<id>;
     ```
   - **Commit & push** the working branch — the dashboard gallery then shows the asset.

7. **Failures:** if a job hard-fails (not just nsfw-refunded), set `status='failed',
   error='<reason>'` so the dashboard surfaces it.

## Never
- Never post to Instagram from this loop — generation ≠ posting (§9). "Commit/push" is git only.
- Never skip the approval gate for video.
- Never drop the identity ref or the locked UGC/SFW rules.

## Scheduling (optional, default OFF)
A Claude Code Remote Routine can fire "drain the Candace content queue per
`generations/WORKER_RUNBOOK.md`" every ~15 min. Only enable once you've confirmed the
Higgsfield MCP is authenticated in a headless/scheduled run; otherwise keep it on-demand.
