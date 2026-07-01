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
  // swimwear trips the filter most often — keep the beach look but make it covered (§4.4)
  if (/\b(bikini|swimsuit|swimwear)\b/i.test(t)) {
    t = t.replace(/\b(bikini|swimsuit|swimwear)\b/gi, 'modest fully-covered one-piece swimsuit');
    notes.push('reworded swimwear → modest fully-covered one-piece (clears the filter)');
  }
  // always assert the SFW guardrail when the outfit reads risky
  if (/one-piece swimsuit|gauzy|bralette|crop|cropped|loungewear|bodysuit/i.test(t) && !/no nudity/i.test(t)) {
    t = t.replace(/\.?\s*$/, '') + ', fully covered, modest and tasteful, no nudity';
    notes.push('appended SFW qualifier (fully covered, tasteful, no nudity)');
  }
  return { text: t, changed: notes.length > 0, notes };
}

// Strong modesty clause appended when the user asks for "fully covered" (e.g. to clear
// an NSFW filter flag). Same character, just covered.
export const MODESTY_CLAUSE =
  'She is fully covered in a modest, tasteful outfit — opaque lightweight fabric, modest ' +
  'neckline, shoulders and midriff covered, no skin exposure beyond face/arms, no nudity.';

// Adult anchor — appended whenever the brief asks for a younger / age-styled look, so a
// "look younger" request stays locked to a CLEARLY ADULT woman and can never drift toward
// a minor. Candace's canonical age is 21; this lets her read a little younger (~20) while
// remaining unmistakably an adult.
export const ADULT_ANCHOR =
  'She is unmistakably an adult woman in her early twenties (around 20), with mature adult ' +
  'facial features and adult proportions — clearly of legal adult age, never a minor, never child-like.';

// Age/youth safety pass on the free-text styling. Keeps youthful-adult styling (the user may
// want her to read ~20 instead of 21) but enforces a hard adult floor: any age under 18, or
// any minor/child-implying wording, is rewritten to a clearly-adult look. Returns
// { text, notes, youth } — youth=true means append ADULT_ANCHOR.
export function ageSafe(text) {
  if (!text) return { text: '', notes: [], youth: false };
  let t = text; const notes = []; let youth = false;
  // minor / near-minor wording → youthful ADULT (never a minor)
  const minorTerms = /\b(teen(ager|aged)?|school[-\s]?girl|child(ish|like)?|kiddie|minor|under[-\s]?age|pre[-\s]?teen|jail[-\s]?bait|lolita?|barely[-\s]?legal|little\s+girl|young\s+girl)\b/gi;
  if (minorTerms.test(t)) { t = t.replace(minorTerms, 'youthful adult'); notes.push('rewrote minor-implying wording → "youthful adult" (adult floor)'); youth = true; }
  // explicit ages in an age context; clamp anything under 18 up to a clearly-adult look
  const ageCtx = /(\b(?:looks?|look|aged?|age|about|around|like|appears?)\s+)(\d{1,2})\b|\b(\d{1,2})(\s*(?:yo\b|y\/o\b|years?\s*old\b|year[-\s]?old\b))/gi;
  t = t.replace(ageCtx, (m, pre, a, b, suf) => {
    const num = (a != null) ? a : b; const n = parseInt(num, 10);
    if (n < 18) { notes.push(`requested age ${n} is under the adult floor → styled as clearly-adult early twenties (20)`); youth = true; return m.replace(num, '20'); }
    if (n <= 21) youth = true; // a younger-but-adult look was asked for
    return m;
  });
  if (/\byoung(er)?\b|\byouthful\b|\bfresh[-\s]?faced\b|\bbaby[-\s]?faced\b/i.test(t)) youth = true;
  return { text: t, notes, youth };
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
  // Reference-driven mode: a picture was uploaded ("put Candace in THIS picture") or
  // we're iterating from a chosen frame. Don't inject generic defaults — recreate the
  // reference's scene/pose/outfit and only apply explicit overrides.
  if (brief.reference_image || brief.has_reference || brief.compose_from_job) {
    return buildReferencePrompt(brief);
  }
  const b = { ...DEFAULTS, ...sanitizeBrief(brief) };
  const isVideoFrame = (brief.kind === 'video');
  // For a video start frame, force tight face framing (§5/§7.2) unless the user was explicit.
  const framing = isVideoFrame && !brief._framingExplicit
    ? 'CLOSE waist-up framing with her FACE LARGE, SHARP and clearly in focus (start frame for animation)'
    : b.framing;

  const actionSafe = filterSafe(b.action);
  const notes = [...actionSafe.notes];
  // Only dictate an outfit when the user actually named one. On a VIDEO start frame we must
  // NOT override the source clip's wardrobe with a generic default — leave it to the driving
  // clip / reference frame instead of forcing "a casual fitted top".
  const outfitExplicit = typeof brief.outfit === 'string' && brief.outfit.trim().length > 0;

  const prefix = LOCKED_PREFIX.replace('{shot}', b.shot).replace('{light}', b.light);
  let body = `${IDENTITY_SENTENCE} ${actionSafe.text} in ${b.setting}.`;
  if (outfitExplicit) { const outfitSafe = filterSafe(b.outfit); notes.push(...outfitSafe.notes); body += ` She wears ${outfitSafe.text}.`; }
  else if (isVideoFrame) { body += ` Keep her clothing and outfit consistent with the driving clip — do NOT restyle her wardrobe or invent a new outfit.`; }
  else { const outfitSafe = filterSafe(b.outfit); notes.push(...outfitSafe.notes); body += ` She wears ${outfitSafe.text}.`; }
  body += ` ${b.mood}.`;
  // Free-text styling (makeup, hair, "look a little younger", going-out glam, …). For a
  // video this styles the nano_banana START FRAME, which motion control then animates.
  if (b.details) {
    const d = filterSafe(b.details); const a = ageSafe(d.text);
    notes.push(...d.notes, ...a.notes);
    body += ` Styling details: ${a.text}.`;
    if (a.youth) body += ` ${ADULT_ANCHOR}`;
  }
  if (brief.modest) body += ` ${MODESTY_CLAUSE}`;
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

// Reference-driven prompt: keep Candace's identity (first ref), recreate the uploaded
// picture / chosen frame (second ref). Only user-filled fields become overrides.
function buildReferencePrompt(brief) {
  const s = sanitizeBrief(brief);
  const notes = [];
  const light = s.light || 'matching the reference';
  const prefix =
    `Authentic UGC iPhone photo, candid and unposed, natural light (${light}), no studio, ` +
    `no professional lighting, NOT retouched, natural skin texture, slightly imperfect handheld framing.`;
  let body =
    `Take the woman from the FIRST reference image — keep her EXACT same face, long blonde hair, ` +
    `blue eyes, fair light skin and petite curvy figure — and place her into the SECOND reference image: ` +
    `recreate its scene, setting, pose, body position, outfit, camera angle and framing as if she were ` +
    `the person in it. Keep it tasteful and SFW, no nudity.`;
  const adj = [];
  if (s.outfit) { const o = filterSafe(s.outfit); notes.push(...o.notes); adj.push(`outfit: ${o.text}`); }
  if (s.action) { const a = filterSafe(s.action); notes.push(...a.notes); adj.push(a.text); }
  if (s.setting) adj.push(`setting: ${s.setting}`);
  if (s.mood) adj.push(s.mood);
  if (s.framing) adj.push(`framing: ${s.framing}`);
  let youth = false;
  if (s.details) { const d = filterSafe(s.details); const a = ageSafe(d.text); notes.push(...d.notes, ...a.notes); adj.push(`styling: ${a.text}`); youth = a.youth; }
  if (youth) adj.push(ADULT_ANCHOR);
  if (brief.modest) {
    body += `\nRender a MODEST, fully-covered version of the reference's outfit (override any ` +
      `revealing/swim wear): ${MODESTY_CLAUSE}`;
  }
  if (adj.length) body += `\nAdjustments (override the reference only where these conflict): ${adj.join('; ')}.`;
  const prompt = `${prefix}\n${body}\nVertical 9:16. No text.`;
  return {
    prompt, reworded: notes.length > 0, notes, identity_ref: IDENTITY_REF, reference_driven: true,
    params: { model: 'nano_banana_pro', resolution: '2k', aspect_ratio: '9:16', count: clampInt(brief.count, 1, 4, 2) },
  };
}

// ---- helpers ----
function sanitizeBrief(brief) {
  const out = {};
  for (const k of ['shot', 'light', 'action', 'setting', 'outfit', 'framing', 'mood', 'details']) {
    if (typeof brief[k] === 'string' && brief[k].trim()) out[k] = brief[k].trim().slice(0, 600);
  }
  if (brief.framing && brief.framing.trim()) brief._framingExplicit = true;
  return out;
}
function clampInt(v, lo, hi, dft) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dft;
}
