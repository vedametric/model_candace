# Content worker runbook — draining the dashboard generation queue

The admin dashboard's **Studio** tab queues content jobs into the Supabase
`gen_requests` table. This runbook is what a **Claude session (the "worker")** does to
execute them via the Higgsfield MCP. It is the bridge between the dashboard (control
surface) and **[`../GENERATE_CONTENT.md`](../GENERATE_CONTENT.md)** (the full pipeline) —
read that masterfile too; this runbook does not replace it, it sequences it.

> **Golden rule:** every caveat in `GENERATE_CONTENT.md` still applies. The dashboard
> pre-bakes the locked rules into `prompt`, but YOU are the last line of defense — keep
> it UGC/natural-light/candid/not-retouched/SFW, identity ref first, 2k, count:2.

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
   - Append an entry to **`generations/entries.json`** (`{"entries":[…]}`) — fields:
     `file, model, job, cost (verified via transactions), batch, at (UTC), src (the
     approved_job for videos), prompt, notes`. **No need to edit `build_manifest.py`** —
     it merges this sidecar.
   - Update **`generations/balance.json`** `balance_now_cr` from the `balance` tool.
   - Run `python3 generations/build_manifest.py` (rebuilds `manifest.json`).
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
