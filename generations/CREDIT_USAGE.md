# Credit Usage Log — Higgsfield

Itemised credit cost of every Candace generation archived in this folder.
Costs are pulled from the Higgsfield transaction log (`transactions` API) and
matched to each completed job by model + timestamp.

> Note: **filter-flagged ("nsfw") and failed jobs are auto-refunded**, so they
> cost a net 0 and are not listed below (only successful, committed assets are).
> The account's full transaction history also includes the automated 2×/day
> posting routine (Seedream 4.5, Wan 2.7) and other sessions — those are **not**
> part of these archived generations and are excluded here.

## Unit price reference (verified from transaction log)

| Model | What it's for | Cost |
|---|---|---|
| Higgsfield Soul V2 (`soul_2`) | persona portraits | **0.12 cr / image** |
| Nano Banana Pro (`nano_banana_pro`) | images (1k/2k) | **2 cr / image** |
| Seedance 2.0 (`seedance_2_0`) video, 720p | UGC/cinematic clips | **~4.5 cr / second** (8s≈36, 10s≈45, 15s≈67.5) |
| Seedance 2.0 video, 1080p | hi-res clips | **~9 cr / second** (15s≈135) |
| Kling 3.0 Motion Control, 720p | animate still from a driving video | **~21–22 cr / clip** (~12s) |

## Itemised — 2026-06-26

| Asset | Model | Cost (cr) |
|---|---|---|
| persona-option-1-CHOSEN_portrait | soul_2 | 0.12 |
| persona-option-2_portrait | soul_2 | 0.12 |
| persona-option-3_portrait | soul_2 | 0.12 |
| soul2-editorial-attempt-A | soul_2 | 0.12 |
| soul2-editorial-attempt-B | soul_2 | 0.12 |
| (soul_2 6th warm-up frame) | soul_2 | 0.12 |
| mirror-selfie_nano_POSTED-001 | nano_banana_pro | 2 |
| cafe-selfie_nano_POSTED-002 (routine) | nano_banana | 2 |
| hotel-bed-selfie_nano_POSTED-003 (routine) | nano_banana | 2 |
| persona-v2-10E_reference | nano_banana_pro | 2 |
| beach-cinematic_15s (1080p) | seedance_2_0 | 135 |
| beach-ugc-sand_10s | seedance_2_0 | 45 |
| boudoir_8s | seedance_2_0 | 36 |
| gym-squats_8s | seedance_2_0 | 36 |
| bedroom-ugc-selfie_15s | seedance_2_0 | 67.5 |
| beach-trampoline-ugc_10s | seedance_2_0 | 45 |
| **2026-06-26 subtotal** | | **~377.4** |

_(Also spent that day but NOT archived: a 720p beach-cinematic fallback dup
≈67.5, since the 1080p version landed and was kept instead.)_

## Itemised — 2026-06-27

| Asset | Model | Cost (cr) |
|---|---|---|
| pool-book-A_98f9d97e | nano_banana_pro | 2 |
| pool-book-B_524077e4 | nano_banana_pro | 2 |
| pool-book-C_ad9e8aeb | nano_banana_pro | 2 |
| pool-cocktail_74a316d2 | nano_banana_pro | 2 |
| pool-cocktail-motion_b01ff1e1 | motion_control 720p | 22 |
| gym-A_4f629463 | nano_banana_pro | 2 |
| gym-B_180a5398 | nano_banana_pro | 2 |
| gym-C_ce4234e9 | nano_banana_pro | 2 |
| gym-B-motion_47b0f56f | motion_control 720p | 22 |
| nighty-A_c984178e | nano_banana_pro | 2 |
| nighty-B_92c49e4a | nano_banana_pro | 2 |
| nighty-C_fc2acbf5 | nano_banana_pro | 2 |
| nighty-A-motion_847e66ef | motion_control 720p | 21 |
| **2026-06-27 subtotal** | | **85** |

## Totals (archived assets only)

- **2026-06-26:** ~377.4 cr
- **2026-06-27:** 85 cr
- **Grand total (committed generations):** **~462 cr**

### Takeaways for cost control
- **Images are cheap** (2 cr) — generate freely; flagged/failed ones refund.
- **Video is the cost driver.** Seedance 1080p is ~2× the price of 720p for the
  same length (135 vs 67.5 for 15s). **Default to 720p** unless you truly need
  1080p — it's plenty for IG/TikTok.
- **Motion control (~21–22 cr)** is much cheaper than a fresh Seedance video and
  gives precise motion — good value when you have a driving clip.
- Soul V2 portraits are nearly free (0.12 cr).
