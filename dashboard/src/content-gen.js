// Content-generation prompt builder. Turns a guided brief into a fully
// GENERATE_CONTENT.md-compliant Higgsfield prompt — the locked UGC rules, the
// identity reference restatement, 2k/9:16/"No text", and the §4.4 filter-safe
// reword are baked in here so EVERY queued job is compliant before the worker
// (or any human) ever sees it. Pure functions, no external deps.

// Canonical identity reference (§1) — passed as the FIRST image reference on every gen.
export const IDENTITY_REF = '49aff4e5-9c20-44a3-87e8-85ba87e0d642';

// §0 locked rules, baked verbatim into the prompt's negatives.
const LOCKED_PREFIX =
  'Authentic UGC iPhone {shot}, candid and unposed, natural {light}, no studio, ' +
  'no professional lighting, NOT retouched, natural skin texture, slightly imperfect handheld framing.';

// §1 identity sentence — the reference image anchors it, the words reinforce it.
const IDENTITY_SENTENCE =
  'The woman from the reference image — keep her EXACT same face, long blonde hair, ' +
  'blue eyes, fair light skin and petite curvy figure —';

const DEFAULTS = {
  shot: "arm's-length selfie",
  light: 'soft window daylight',
  action: 'taking a casual selfie',
  setting: 'a cozy everyday room',
  outfit: 'a casual fitted top, tasteful',
  framing: 'CLOSE waist-up selfie framing with her FACE LARGE, SHARP and clearly in focus',
  mood: 'soft confident flirty expression',
};

// §4.4 content-filter wording — reword filter-tripping combos while keeping the look.
// Returns { text, changed, notes }.
export function filterSafe(text) {
  if (!text) return { text: '', changed: false, notes: [] };
  let t = text;
  const notes = [];
  // Most-specific first; replacements never reintroduce a trigger word.
  const subs = [
    [/\bsee[-\s]?through\b/gi, 'lightweight gauzy'],
    [/\bsheer\s+mesh\b/gi, 'lightweight gauzy'],
    [/\bsheer\b/gi, 'lightweight gauzy'],
    [/\btransparent\b/gi, 'lightweight gauzy'],
    [/\bmesh\b/gi, 'fine-knit'],
    [/\b(?:show(?:ing)?\s+(?:her\s+)?)?(?:midriff|stomach|belly)\b/gi, 'cropped just above the waist'],
    [/\bnaked\b/gi, 'fully covered'],
    [/\bnude\b/gi, 'fully covered'],
    [/\btopless\b/gi, 'fully covered top'],
    [/\blingerie\b/gi, 'tasteful loungewear set'],
    [/\bthong\b/gi, 'full-coverage bottoms'],
  ];
  for (const [re, rep] of subs) {
    if (re.test(t)) { t = t.replace(re, rep); notes.push(`reworded "${re.source}" → "${rep}"`); }
  }
  // collapse any adjacent repeats introduced by neighbouring triggers
  t = t.replace(/\b(lightweight gauzy)(?:\s+lightweight gauzy\b)+/gi, '$1')
       .replace(/\s{2,}/g, ' ');
  // always assert the SFW guardrail when the outfit reads risky
  if (/bikini|swimsuit|gauzy|bralette|crop|cropped|loungewear|bodysuit/i.test(t) && !/no nudity/i.test(t)) {
    t = t.replace(/\.?\s*$/, '') + ', fully covered, modest and tasteful, no nudity';
    notes.push('appended SFW qualifier (fully covered, tasteful, no nudity)');
  }
  return { text: t, changed: notes.length > 0, notes };
}

// Suggest the video method per the §5 decision guide.
//  - held object (phone/drink/glasses) → Seedance (only reliable way to keep it natural)
//  - a driving clip provided + no held object → Motion Control (faithful motion copy)
//  - otherwise (described motion, no clip) → Seedance
export function suggestMethod(brief = {}) {
  const text = `${brief.action || ''} ${brief.outfit || ''} ${brief.notes || ''}`.toLowerCase();
  const heldObject = /\b(phone|selfie|drink|glass|cup|sunglass|glasses|mirror)\b/.test(text);
  const hasClip = Boolean(brief.driving_video && (brief.driving_video.link || brief.driving_video.media_id || brief.driving_video.filename));
  if (heldObject) return { method: 'seedance', reason: 'held object present → Seedance keeps it natural (§5)' };
  if (hasClip) return { method: 'motion_control', reason: 'driving clip + no held object → Motion Control copies the motion (§5)' };
  return { method: 'seedance', reason: 'described motion, no driving clip → Seedance (§5)' };
}

// §3 cost preflight estimate (credits). Images: 2 cr each @2k. Seedance 720p
// ~4.5 cr/s, 1080p ~9 cr/s. Motion Control ~15–31 cr scaling with driving length.
export function estimateCost(brief = {}) {
  const kind = brief.kind || 'image';
  if (kind === 'image') {
    const count = clampInt(brief.count, 1, 4, 2);
    return { credits: 2 * count, basis: `${count} × 2 cr (nano_banana_pro @2k)` };
  }
  const dur = clampInt(brief.duration, 4, 15, 8);
  const method = brief.video_method || suggestMethod(brief).method;
  if (method === 'seedance') {
    const perSec = /1080|4k/i.test(brief.resolution || '720p') ? 9 : 4.5;
    return { credits: Math.round(perSec * dur), basis: `seedance_2_0 ${brief.resolution || '720p'}: ~${perSec} cr/s × ${dur}s` };
  }
  // motion control scales ~15 (8s) → 31 (19s)
  const mc = Math.round(15 + (Math.max(0, dur - 8) / 11) * 16);
  return { credits: mc, basis: `motion_control (Kling 3.0): ~${mc} cr for a ${dur}s driving clip` };
}

// Build the compliant prompt from a brief. Returns { prompt, reworded, notes, identity_ref, params }.
export function buildPrompt(brief = {}) {
  const b = { ...DEFAULTS, ...sanitizeBrief(brief) };
  const isVideoFrame = (brief.kind === 'video');
  // For a video start frame, force tight face framing (§5/§7.2) unless the user was explicit.
  const framing = isVideoFrame && !brief._framingExplicit
    ? 'CLOSE waist-up framing with her FACE LARGE, SHARP and clearly in focus (start frame for animation)'
    : b.framing;

  const outfitSafe = filterSafe(b.outfit);
  const actionSafe = filterSafe(b.action);
  const notes = [...outfitSafe.notes, ...actionSafe.notes];

  const prefix = LOCKED_PREFIX.replace('{shot}', b.shot).replace('{light}', b.light);
  const body = `${IDENTITY_SENTENCE} ${actionSafe.text} in ${b.setting}. She wears ${outfitSafe.text}. ${b.mood}.`;
  const tail = `${framing}. Vertical 9:16. No text.`;
  const prompt = `${prefix}\n${body}\n${tail}`.replace(/\s+\n/g, '\n').trim();

  return {
    prompt,
    reworded: notes.length > 0,
    notes,
    identity_ref: IDENTITY_REF,
    params: { model: 'nano_banana_pro', resolution: '2k', aspect_ratio: '9:16', count: clampInt(brief.count, 1, 4, 2) },
  };
}

// ---- helpers ----
function sanitizeBrief(brief) {
  const out = {};
  for (const k of ['shot', 'light', 'action', 'setting', 'outfit', 'framing', 'mood']) {
    if (typeof brief[k] === 'string' && brief[k].trim()) out[k] = brief[k].trim().slice(0, 600);
  }
  if (brief.framing && brief.framing.trim()) brief._framingExplicit = true;
  return out;
}
function clampInt(v, lo, hi, dft) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dft;
}
