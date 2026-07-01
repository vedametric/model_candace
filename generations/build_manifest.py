#!/usr/bin/env python3
"""Build generations/manifest.json for the dashboard.

Scans this folder for .png/.mp4 assets, stats each one (size, mtime), and
merges in per-file metadata (prompt / model / cost / job id / generated_at /
batch / notes). Run this after EVERY new generation is dropped in here:

    python3 generations/build_manifest.py

Then commit manifest.json (the dashboard at ../index.html reads it).
To add a new asset: drop the file in this folder and add a META entry below.
"""
import json, os, datetime

HERE = os.path.dirname(os.path.abspath(__file__))

# Shared prompts (reused across a batch's options)
P_POOL_BOOK = ("Authentic UGC iPhone photo casually taken by her friend, candid and unposed, natural "
    "daylight, no studio, not retouched, slightly imperfect handheld framing. Candace relaxing on a "
    "poolside lounge chair on a sunny afternoon, cute pink and yellow bikini, reading a paperback book, "
    "not looking at the camera. Blue pool, palm trees, bright natural sunlight. Vertical 9:16.")
P_POOL_COCKTAIL = ("Authentic UGC iPhone photo by her friend, candid, natural daylight, no studio, not "
    "retouched. Waist-up shot of Candace sitting up on a poolside lounge chair, pink and yellow bikini top, "
    "holding a colorful fruity drink with a fruit garnish. No book, no text. Background lounger messy with a "
    "crumpled towel and empty glasses. Blue pool, palm trees, bright sun. Vertical 9:16.")
P_GYM = ("Authentic UGC iPhone photo by her friend, candid, natural gym lighting, no studio, not retouched. "
    "Identity ref + pose ref (sitting on a step, hands near knees). Candace sitting on gym steps post-workout, "
    "tight pink sports bra + pink shorts, light sweat sheen, gym equipment behind, water bottle + messy towel "
    "beside her. Vertical 9:16.")
P_NIGHTY = ("Authentic UGC iPhone front-facing selfie, candid, natural ambient indoor night lighting, no studio, "
    "not retouched. Identity ref + close-up selfie pose ref. Candace in a close-up head-and-shoulders selfie in a "
    "home hallway, wearing a pink silk slip nightie, soft relaxed gaze. Vertical 9:16.")
P_SHEER = ("Authentic UGC iPhone photo, candid and unposed, natural indoor daylight from a window, no studio, "
    "no professional lighting, not retouched, natural skin texture, slightly imperfect handheld framing. Candace "
    "(exact face, long blonde hair, blue eyes, fair skin, petite curvy figure) in a cute sexy casual outfit: an "
    "oversized sheer mesh long-sleeve top worn as a layer OVER a fitted bralette/bandeau (base top clearly covers "
    "her, tasteful, no nudity), paired with denim shorts. Standing relaxed and confident in a casual bedroom, "
    "front-facing, soft flirty expression, three-quarter body framing. Vertical 9:16. No text.")
P_CORSET = ("Authentic UGC iPhone arm's-length selfie, candid, natural golden-hour sunlight, no studio, NOT "
    "retouched, natural skin texture and pores. Candace (exact face, long blonde hair, blue eyes, fair skin, "
    "petite curvy figure) on a sunny waterfront promenade by the ocean, palm trees behind. Deep red / burgundy "
    "satin corset bustier top (boned, sweetheart neckline, tasteful, no nudity) with a delicate gold necklace, "
    "holding red-tinted cat-eye sunglasses near her face. CLOSE waist-up selfie framing, FACE LARGE, SHARP and in "
    "focus, fine facial detail. Vertical 9:16. No text. [matches a TikTok birthday-selfie motion reference]")
P_GYMMIRROR = ("Authentic UGC iPhone gym mirror selfie, candid, natural gym lighting, no studio, NOT retouched, "
    "phone visible held up to the mirror. Candace (exact face, long blonde hair, blue eyes, fair skin, petite "
    "curvy figure) side-on / side profile to a full-length gym mirror, taking a mirror selfie, posing confidently. "
    "Fitted black workout tank top + cute pink high-waisted gym shorts, white sneakers and ankle socks. Casual gym "
    "with equipment and dark mirrored walls behind. Face clear and in focus. Cheeky-but-cute fitness vibe, "
    "tasteful, no nudity. Vertical 9:16. No text.")
P_BEACHSUNSET = ("Authentic UGC iPhone video-still, candid, natural golden-hour sunset light, no studio, NOT "
    "retouched. Candace (exact face, long blonde hair, blue eyes, fair skin, petite curvy figure) walking out of "
    "shallow ocean surf toward the camera on a tropical sandy beach at sunset, calm sea and low sun behind. Cute "
    "hot-pink tank top with an orange hibiscus print + matching hot-pink hibiscus-print shorts, thin striped bikini "
    "at the neckline, dainty gold necklace. Candid mid-stride, front-facing, three-quarter to full body, face "
    "clear. Tasteful, no nudity. Vertical 9:16. No text. [matches a sophieraiin beach-walk motion ref]")
P_BEACHGLAM = ("Iterated from the beach-sunset frame (identity ref + c6c91485 as scene/pose/composition ref): same "
    "golden-hour walk out of the surf, front-facing. Skin-tight light-pink fitted cropped tank over a light-pink "
    "bikini top, with matching skin-tight SHORT light-pink booty shorts (higher on the thigh). More makeup — glam "
    "but natural beach look: defined eyes, mascara/lashes, bronzy eyeshadow, blush, glossy nude-pink lips. Fully "
    "covered, tasteful, no nudity. Candid mid-stride, face clear. Vertical 9:16. No text.")
P_GLAMBATH = ("Authentic UGC iPhone photo, candid, warm natural ambient indoor evening light from wall sconces "
    "(no studio, no professional lighting), NOT retouched. Candace (exact face, long blonde hair, blue eyes, fair "
    "skin, petite curvy figure) in a stylish hotel bathroom (large mirror, vanity with beauty products, red door). "
    "Glam leopard-print + floral chiffon two-piece: plunging tie-front halter crop top + matching low-rise ruched "
    "mini skirt (tasteful, fully covered, no nudity), gold bangle bracelets, dainty gold necklace, glam smokey-eye "
    "makeup and glossy lips. Confident sultry pose, one hand on hip, front-facing, three-quarter body, face clear. "
    "Vertical 9:16. No text. [matches a sophieraiin glam-bathroom motion ref]")

# filename -> metadata
META = {
 # 2026-06-26 persona / posts
 "2026-06-26_persona-option-1-CHOSEN_portrait.png": dict(model="soul_2", job="0a3e996d", cost=0.12, batch="persona-v1", at="2026-06-26T09:20Z", prompt="Photorealistic fashion-editorial portrait of Candace (21, Ohio): petite 5'1, blonde, blue eyes, fair skin, curvy. 3:4 2K.", notes="Chosen v1 reference"),
 "2026-06-26_persona-option-2_portrait.png": dict(model="soul_2", job="6f853e1a", cost=0.12, batch="persona-v1", at="2026-06-26T09:20Z", prompt="(same as option 1, alt seed)", notes="alt"),
 "2026-06-26_persona-option-3_portrait.png": dict(model="soul_2", job="4c721dea", cost=0.12, batch="persona-v1", at="2026-06-26T09:20Z", prompt="(same as option 1, alt seed)", notes="alt"),
 "2026-06-26_soul2-editorial-attempt-A.png": dict(model="soul_2", job="1c1d8c4e", cost=0.12, batch="persona-v1", at="2026-06-26T09:24Z", prompt="Early UGC attempt (drifted editorial).", notes="not used"),
 "2026-06-26_soul2-editorial-attempt-B.png": dict(model="soul_2", job="348553f0", cost=0.12, batch="persona-v1", at="2026-06-26T09:25Z", prompt="Early mirror attempt (drifted editorial).", notes="not used"),
 "2026-06-26_mirror-selfie_nano_POSTED-001.png": dict(model="nano_banana_pro", job="2b14bde5", cost=2, batch="posted", at="2026-06-26T09:27Z", prompt="iPhone mirror selfie, phone covering part of face, flash glare, bedroom, trendy casual influencer outfit. 3:4.", notes="POSTED #001"),
 "2026-06-26_cafe-selfie_nano_POSTED-002.png": dict(model="nano_banana", job="c40af8b5", cost=2, batch="posted", at="2026-06-26T10:05Z", prompt="(routine) golden-hour cafe arm's-length selfie, sundress.", notes="POSTED #002 (routine)"),
 "2026-06-26_hotel-bed-selfie_nano_POSTED-003.png": dict(model="nano_banana", job="10f6a12b", cost=2, batch="posted", at="2026-06-26T12:06Z", prompt="(routine) moody hotel-bed phone selfie, loungewear, sleepy-sultry.", notes="POSTED #003 (routine)"),
 "2026-06-26_persona-v2-10E_reference.png": dict(model="nano_banana_pro", job="49aff4e5", cost=2, batch="persona-v2", at="2026-06-26T13:59Z", prompt="Full-body UGC iPhone photo of Candace, EXACT same face, petite 5'1, fuller 10E bust, crop top + jeans, casual bedroom, natural window light. Vertical 9:16.", notes="CURRENT canonical reference"),
 # 2026-06-26 videos
 "2026-06-26_beach-cinematic_15s.mp4": dict(model="seedance_2_0 (1080p)", job="d61704ec", cost=135, batch="beach", at="2026-06-26T12:20Z", prompt="Cinematic beach b-roll: walks out of surf, slow wet-hair flip, over-shoulder glance, hip sway, golden hour. Silent 9:16.", notes=""),
 "2026-06-26_beach-ugc-sand_10s.mp4": dict(model="seedance_2_0", job="6d2eebd3", cost=45, batch="beach", at="2026-06-26T12:30Z", prompt="UGC iPhone, sits low in the sand sifting it through her fingers, gazing at the ocean, candid, not looking at camera. Silent 9:16.", notes=""),
 "2026-06-26_boudoir_8s.mp4": dict(model="seedance_2_0", job="c3ebfd62", cost=36, batch="boudoir", at="2026-06-26T12:44Z", prompt="Golden-hour bedroom, satin slip/robe, soft eye contact, slow hand-through-hair, shoulder roll, over-shoulder glance. Silent 9:16.", notes=""),
 "2026-06-26_gym-squats_8s.mp4": dict(model="seedance_2_0", job="c583a7ce", cost=36, batch="gym", at="2026-06-26T12:56Z", prompt="UGC iPhone gym, pink activewear, doing squats, natural daylight, candid, subtle over-shoulder glance. Silent 9:16.", notes="first clip to locked UGC rules"),
 "2026-06-26_bedroom-ugc-selfie_15s.mp4": dict(model="seedance_2_0", job="83308a8f", cost=67.5, batch="bedroom", at="2026-06-26T13:35Z", prompt="iPhone selfie-POV (arm holding phone, phone not in frame), lying back in cozy bedroom in nightwear, flirty, plays with hair. Silent 9:16.", notes=""),
 "2026-06-26_beach-trampoline-ugc_10s.mp4": dict(model="seedance_2_0", job="d284f99f", cost=45, batch="beach", at="2026-06-26T13:40Z", prompt="Friend-filmed iPhone, cute bikini, bouncing on a small trampoline on sand, laughing, playful, hair flying, ocean behind. Silent 9:16.", notes=""),
 # 2026-06-27 pool
 "2026-06-27_pool-book-A_98f9d97e.png": dict(model="nano_banana_pro", job="98f9d97e", cost=2, batch="pool", at="2026-06-27T13:07Z", prompt=P_POOL_BOOK, notes=""),
 "2026-06-27_pool-book-B_524077e4.png": dict(model="nano_banana_pro", job="524077e4", cost=2, batch="pool", at="2026-06-27T13:07Z", prompt=P_POOL_BOOK, notes=""),
 "2026-06-27_pool-book-C_ad9e8aeb.png": dict(model="nano_banana_pro", job="ad9e8aeb", cost=2, batch="pool", at="2026-06-27T13:08Z", prompt=P_POOL_BOOK, notes=""),
 "2026-06-27_pool-cocktail_74a316d2.png": dict(model="nano_banana_pro", job="74a316d2", cost=2, batch="pool", at="2026-06-27T13:22Z", prompt=P_POOL_COCKTAIL, notes="waist-up framing cleared the filter"),
 "2026-06-27_pool-cocktail-motion_b01ff1e1.mp4": dict(model="motion_control 720p", job="b01ff1e1", cost=22, batch="pool", at="2026-06-27T14:15Z", src="74a316d2", prompt="Kling 3.0 Motion Control. Still=pool-cocktail (74a316d2), driven by user reference video. Scene from image. ~13s.", notes=""),
 # 2026-06-27 gym
 "2026-06-27_gym-A_4f629463.png": dict(model="nano_banana_pro", job="4f629463", cost=2, batch="gym", at="2026-06-27T14:45Z", prompt=P_GYM, notes=""),
 "2026-06-27_gym-B_180a5398.png": dict(model="nano_banana_pro", job="180a5398", cost=2, batch="gym", at="2026-06-27T14:47Z", prompt=P_GYM, notes="approved -> animated"),
 "2026-06-27_gym-C_ce4234e9.png": dict(model="nano_banana_pro", job="ce4234e9", cost=2, batch="gym", at="2026-06-27T14:45Z", prompt=P_GYM, notes=""),
 "2026-06-27_gym-B-motion_47b0f56f.mp4": dict(model="motion_control 720p", job="47b0f56f", cost=22, batch="gym", at="2026-06-27T14:55Z", src="180a5398", prompt="Kling 3.0 Motion Control. Still=gym-B (180a5398), driven by user reference video #2. Scene from image. ~12s.", notes="identity drifted (full-body still)"),
 # 2026-06-27 nighty
 "2026-06-27_nighty-A_c984178e.png": dict(model="nano_banana_pro", job="c984178e", cost=2, batch="nighty", at="2026-06-27T15:16Z", prompt=P_NIGHTY, notes="approved -> animated"),
 "2026-06-27_nighty-B_92c49e4a.png": dict(model="nano_banana_pro", job="92c49e4a", cost=2, batch="nighty", at="2026-06-27T15:16Z", prompt=P_NIGHTY, notes=""),
 "2026-06-27_nighty-C_fc2acbf5.png": dict(model="nano_banana_pro", job="fc2acbf5", cost=2, batch="nighty", at="2026-06-27T15:16Z", prompt=P_NIGHTY, notes=""),
 "2026-06-27_nighty-A-motion_847e66ef.mp4": dict(model="motion_control 720p", job="847e66ef", cost=21, batch="nighty", at="2026-06-27T15:24Z", src="c984178e", prompt="Kling 3.0 Motion Control. Still=nighty-A (c984178e), driven by pose-matched user reference video #3. Scene from image. ~12s.", notes="held identity well (face-crop still + matched pose)"),
 # 2026-06-28 sheer-top
 "2026-06-28_sheer-top-A_666c2a8e.png": dict(model="nano_banana_pro", job="666c2a8e", cost=2, batch="sheer-top", at="2026-06-28T06:18Z", prompt=P_SHEER, notes="approved -> animated (black mesh over grey ribbed bralette)"),
 "2026-06-28_sheer-top-B_b38773ab.png": dict(model="nano_banana_pro", job="b38773ab", cost=2, batch="sheer-top", at="2026-06-28T06:18Z", prompt=P_SHEER, notes="white mesh over black bandeau"),
 "2026-06-28_sheer-top-C_19f0ac04.png": dict(model="nano_banana_pro", job="19f0ac04", cost=2, batch="sheer-top", at="2026-06-28T06:18Z", prompt=P_SHEER, notes="black mesh over black bralette"),
 "2026-06-28_sheer-top-A-motion_dc136e20.mp4": dict(model="motion_control 720p", job="dc136e20", cost=23, batch="sheer-top", at="2026-06-28T06:31Z", src="666c2a8e", prompt="Kling 3.0 Motion Control. Still=sheer-top-A (666c2a8e), driven by user motion reference video. Scene from image. 13s, 720p.", notes="oversized see-through top concept"),
 # 2026-06-28 corset (red satin, waterfront) — first images at native 2k
 "2026-06-28_corset-A_2534968d.png": dict(model="nano_banana_pro", job="2534968d", cost=2, batch="corset", at="2026-06-28T07:05Z", prompt=P_CORSET, notes="2k, approved -> animated (peering over glasses)"),
 "2026-06-28_corset-B_e70b9cbd.png": dict(model="nano_banana_pro", job="e70b9cbd", cost=2, batch="corset", at="2026-06-28T07:05Z", prompt=P_CORSET, notes="2k, head-on, brighter"),
 "2026-06-28_corset-A-motion_117faa1f.mp4": dict(model="motion_control 720p", job="117faa1f", cost=31, batch="corset", at="2026-06-28T07:13Z", src="2534968d", prompt="Kling 3.0 Motion Control. Still=corset-A (2534968d), driven by user TikTok birthday-selfie motion ref (8af7b6a7). Scene from image. 19s, 720p.", notes="face held crisp throughout (close 2k start frame)"),
 # 2026-06-28 gym mirror selfie (pink shorts) — images at native 2k
 "2026-06-28_gym-mirror-A_8feaf367.png": dict(model="nano_banana_pro", job="8feaf367", cost=2, batch="gym-mirror", at="2026-06-28T07:24Z", prompt=P_GYMMIRROR, notes="2k, full side-profile head-to-toe (best pose match to driving clip)"),
 "2026-06-28_gym-mirror-B_08048a91.png": dict(model="nano_banana_pro", job="08048a91", cost=2, batch="gym-mirror", at="2026-06-28T07:24Z", prompt=P_GYMMIRROR, notes="2k, 3/4 turn, face larger/clearer"),
 "2026-06-28_gym-mirror-A-motion_ca3df7db.mp4": dict(model="motion_control 720p", job="ca3df7db", cost=23, batch="gym-mirror", at="2026-06-28T07:30Z", src="8feaf367", prompt="Kling 3.0 Motion Control. Still=gym-mirror-A (8feaf367), driven by user Ellie-hub gym mirror-selfie motion ref (b08319ff). Scene from image. 13s, 720p.", notes="side-profile mirror selfie; identity held"),
 # 2026-06-28 beach sunset (hot-pink hibiscus two-piece) — native 2k
 "2026-06-28_beach-sunset-A_03dca7d2.png": dict(model="nano_banana_pro", job="03dca7d2", cost=2, batch="beach-sunset", at="2026-06-28T14:33Z", prompt=P_BEACHSUNSET, notes="2k, walking out of surf"),
 "2026-06-28_beach-sunset-B_c6c91485.png": dict(model="nano_banana_pro", job="c6c91485", cost=2, batch="beach-sunset", at="2026-06-28T14:33Z", prompt=P_BEACHSUNSET, notes="2k, walking out of surf; chosen as composition ref for the iterations"),
 # 2026-06-28 beach final look (iterated from c6c91485: skin-tight light-pink + more makeup + shorter shorts)
 "2026-06-28_beach-glam-A_c51d30fa.png": dict(model="nano_banana_pro", job="c51d30fa", cost=2, batch="beach-sunset", at="2026-06-28T14:58Z", src="c6c91485", prompt=P_BEACHGLAM, notes="2k, CHOSEN -> animated; skin-tight light-pink, glam makeup, shorter shorts"),
 "2026-06-28_beach-glam-B_9f0c6f28.png": dict(model="nano_banana_pro", job="9f0c6f28", cost=2, batch="beach-sunset", at="2026-06-28T14:58Z", src="c6c91485", prompt=P_BEACHGLAM, notes="2k, alt"),
 "2026-06-28_beach-walk-motion_5bd2305e.mp4": dict(model="motion_control 1080p", job="5bd2305e", cost=16, batch="beach-sunset", at="2026-06-28T15:08Z", src="c51d30fa", prompt="Kling 3.0 Motion Control. Still=beach-glam-A (c51d30fa), driven by user sophieraiin beach-walk motion ref (91f632e1). Scene from image. 9s, output 1080p.", notes="face/makeup/outfit held; playful walk+dance transferred"),
 "2026-06-28_beach-walk2-motion_6ea7177a.mp4": dict(model="motion_control 1080p", job="6ea7177a", cost=15, batch="beach-sunset", at="2026-06-28T15:28Z", src="c51d30fa", prompt="Kling 3.0 Motion Control. Still=beach-glam-A (c51d30fa) — SAME start frame as 5bd2305e for identical character — driven by a 2nd sophieraiin beach motion ref (447c64a0, talk-to-camera arm gestures). Scene from image. 8s, output 1080p.", notes="reused exact start frame -> Candace 100% consistent with clip #1, new motion"),
 # 2026-06-29 GRWM bathroom mirror — POSTED #008
 "2026-06-29_grwm-bathroom_0fc0a883.png": dict(model="nano_banana_pro", job="0fc0a883", cost=2, batch="posted", at="2026-06-29T00:06:53Z", prompt="shot on iphone ugc style, candid getting-ready grwm moment, petite 21-year-old woman with long wavy blonde hair and striking blue eyes, fair skin, curvy hourglass figure with fuller chest, standing at bathroom vanity mirror doing morning makeup routine, wearing a fitted ribbed cream knit crop top, soft natural daylight from window, casual everyday home bathroom, mid-action caught mid-applying lip gloss, confident flirty glance back at camera with parted lips and subtle smile, messy-cute loose blonde hair falling over shoulders, handheld phone camera feel, slight imperfect framing, natural skin texture and grain, NOT retouched, NOT studio lighting, NOT editorial, authentic UGC feel, real person vibe", notes="POSTED #008 (routine) — GRWM bathroom mirror, daylight, ribbed knit crop top, flirty-teasing"),
 # 2026-06-29 poolside beauty close-up — attempted post #009 (upload blocked: Instagram token expired)
 "2026-06-29_poolside-beauty-closeup_7f795549.png": dict(model="nano_banana_pro", job="7f795549", cost=2, batch="posted", at="2026-06-29T12:05Z", prompt="close-up beauty shot of a 21-year-old petite blonde woman at an outdoor pool during golden hour, warm late-afternoon sunlight catching her bright blue eyes and fair skin, long blonde hair slightly wavy and sun-kissed, wearing a vibrant strappy bikini top, playful teasing smirk with parted lips, glancing slightly sideways as if caught mid-laugh, pool water glinting softly in the blurred background, shot on iPhone UGC style, handheld candid feel, natural imperfections visible — skin texture, slight grain — no studio lighting, not retouched, authentic everyday moment, petite hourglass figure, curvy busty build", notes="POST #009 PENDING — generated OK; upload-post.com returned Instagram token-expired error, needs reconnect"),
 # 2026-06-29 gym mirror re-render (phone now in hand)
 "2026-06-29_gym-mirror-A-motion-v2_9d22a08f.mp4": dict(model="motion_control 720p", job="9d22a08f", cost=23, batch="gym-mirror", at="2026-06-29T04:27Z", src="8feaf367", prompt="Kling 3.0 Motion Control. Still=gym-mirror-A (8feaf367), driven by Ellie-hub gym mirror-selfie ref (b08319ff). Scene from image. 13s, 720p. Re-render of ca3df7db.", notes="re-render: motion control still warped the held phone — superseded by the Seedance v3 below"),
 "2026-06-29_gym-mirror-seedance-v3_09489cc6.mp4": dict(model="seedance_2_0 (720p)", job="09489cc6", cost=36, batch="gym-mirror", at="2026-06-29T04:44Z", src="8feaf367", prompt="Seedance 2.0 image-to-video (start_image = gym-mirror-A 8feaf367), silent, 8s, 720p. Prompt: keep holding phone in right hand the ENTIRE time taking a mirror selfie, phone stays firmly/naturally in grip, subtle posing (weight shift, hip turn, free hand touches hair, glance at reflection).", notes="PHONE FIX: switched from motion_control to Seedance i2v + prompt so the phone stays naturally held throughout"),
 # 2026-07-01 glam hotel bathroom (leopard + floral chiffon) — matches a sophieraiin motion ref
 "2026-07-01_glam-bathroom-A_ea3a3eb7.png": dict(model="nano_banana_pro", job="ea3a3eb7", cost=2, batch="glam-bathroom", at="2026-07-01T14:03Z", prompt=P_GLAMBATH, notes="2k, CHOSEN -> animated (hand-on-hip sultry)"),
 "2026-07-01_glam-bathroom-B_fda67867.png": dict(model="nano_banana_pro", job="fda67867", cost=2, batch="glam-bathroom", at="2026-07-01T14:06Z", prompt=P_GLAMBATH, notes="2k, alt (hand on vanity, softer)"),
 "2026-07-01_glam-bathroom-motion_4f0b4aef.mp4": dict(model="motion_control 1080p", job="4f0b4aef", cost=23, batch="glam-bathroom", at="2026-07-01T14:16Z", src="ea3a3eb7", prompt="Kling 3.0 Motion Control. Still=glam-bathroom-A (ea3a3eb7), driven by user sophieraiin glam-bathroom motion ref (016aed57, sultry getting-ready posing). Scene from image. 13s, output 1080p.", notes="outfit + aesthetic matched; face/identity held"),
}

def human(n):
    for u in ("B","KB","MB","GB"):
        if n < 1024: return f"{n:.0f} {u}" if u=="B" else f"{n:.1f} {u}"
        n /= 1024
    return f"{n:.1f} TB"

items = []
for fn in sorted(os.listdir(HERE)):
    if not (fn.endswith(".png") or fn.endswith(".mp4")):
        continue
    path = os.path.join(HERE, fn)
    size = os.path.getsize(path)
    m = META.get(fn, {})
    items.append({
        "file": fn,
        "type": "video" if fn.endswith(".mp4") else "image",
        "size_bytes": size,
        "size_human": human(size),
        "model": m.get("model", "?"),
        "job_id": m.get("job", ""),
        "cost_cr": m.get("cost", None),
        "batch": m.get("batch", "misc"),
        "generated_at": m.get("at", ""),
        "source_job": m.get("src", ""),
        "prompt": m.get("prompt", ""),
        "notes": m.get("notes", ""),
    })

total_cost = sum(i["cost_cr"] or 0 for i in items)
total_size = sum(i["size_bytes"] for i in items)

# Account-level reconciliation (from Higgsfield balance / transactions).
# balance_start = balance right before Candace's first generation this project.
# balance_now   = update each time you rebuild (Higgsfield `balance` tool).
BALANCE_START = 1688.55
BALANCE_NOW   = 150.98   # as of 2026-07-01 ~15:02 UTC
net_spent = round(BALANCE_START - BALANCE_NOW, 2)

out = {
    "generated_at_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "count": len(items),
    "archived_cost_cr": round(total_cost, 2),      # cost of the kept assets shown below
    "net_spent_cr": net_spent,                      # ALL Candace activity (incl. routine, retries, fallbacks)
    "balance_start_cr": BALANCE_START,
    "balance_now_cr": BALANCE_NOW,
    "non_archived_cr": round(net_spent - total_cost, 2),
    "total_cost_cr": round(total_cost, 2),          # back-compat alias = archived_cost_cr
    "total_size_bytes": total_size,
    "total_size_human": human(total_size),
    "items": items,
}
with open(os.path.join(HERE, "manifest.json"), "w") as f:
    json.dump(out, f, indent=2)
print(f"Wrote manifest.json: {len(items)} items, {round(total_cost,2)} cr, {human(total_size)}")
