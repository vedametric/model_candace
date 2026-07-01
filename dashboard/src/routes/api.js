// All read + write API endpoints. Mounted at /api by server.js.
// Reads fuse Supabase (live) + filesystem (git content); writes are strictly scoped.

import express from 'express';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileP = promisify(execFile);
import { listBots, getBot, hasContent, contentPath, invalidateBots } from '../accounts.js';
import { select, patch, rpc, insert, hasKey } from '../supabase.js';
import { buildPrompt, estimateCost, suggestMethod, filterSafe, IDENTITY_REF } from '../content-gen.js';
import {
  readManifest,
  readPostedLog,
  readPersonaDocs,
  listReference,
  parseSocials,
  contentCounts,
  writeDoc,
  PERSONA_DOCS,
} from '../content.js';
import { queueRows } from '../queue.js';
import { buildOverview } from '../overview.js';
import { commitDoc } from '../git.js';

const router = express.Router();

// ---- helpers ---------------------------------------------------------------
function wrap(fn) {
  return (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      const status = err.status || 500;
      res.status(status).json({ error: err.message || 'server error' });
    });
  };
}

async function requireBot(slug) {
  const bot = await getBot(slug);
  if (!bot) throw Object.assign(new Error(`account '${slug}' not found`), { status: 404 });
  return bot;
}

const DELAY_DEFAULT = { min_sec: 120, max_sec: 600, quick_chance: 0.15, quick_min_sec: 45, quick_max_sec: 120 };

// Coerce a stored reply_delay into a clean, bounded shape for the UI.
function normalizeDelay(d) {
  const o = d && typeof d === 'object' ? d : {};
  return {
    min_sec: numOr(o.min_sec, DELAY_DEFAULT.min_sec),
    max_sec: numOr(o.max_sec, DELAY_DEFAULT.max_sec),
    quick_chance: numOr(o.quick_chance, DELAY_DEFAULT.quick_chance),
    quick_min_sec: numOr(o.quick_min_sec, DELAY_DEFAULT.quick_min_sec),
    quick_max_sec: numOr(o.quick_max_sec, DELAY_DEFAULT.quick_max_sec),
  };
}
function numOr(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
// Validate + clamp an incoming reply_delay edit. Throws on nonsense.
function validateDelay(input) {
  const d = normalizeDelay(input);
  const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
  d.min_sec = clampInt(d.min_sec, 0, 86400);
  d.max_sec = clampInt(d.max_sec, 0, 86400);
  d.quick_min_sec = clampInt(d.quick_min_sec, 0, 86400);
  d.quick_max_sec = clampInt(d.quick_max_sec, 0, 86400);
  d.quick_chance = Math.max(0, Math.min(1, Number(d.quick_chance)));
  if (!Number.isFinite(d.quick_chance)) d.quick_chance = DELAY_DEFAULT.quick_chance;
  if (d.max_sec < d.min_sec) throw Object.assign(new Error('max_sec must be ≥ min_sec'), { status: 400 });
  if (d.quick_max_sec < d.quick_min_sec) throw Object.assign(new Error('quick_max_sec must be ≥ quick_min_sec'), { status: 400 });
  return d;
}

function liftIntent(f) {
  const m = f.metadata || {};
  return {
    id: f.id,
    username: f.username,
    display_name: f.display_name,
    platform: f.platform,
    stage: f.stage,
    buyer_type: f.buyer_type,
    msg_count: f.msg_count,
    first_seen: f.first_seen,
    last_seen: f.last_seen,
    summary: f.summary,
    first_name: f.first_name,
    last_name: f.last_name,
    email: f.email,
    person_id: f.person_id ?? null,
    intent_score: m.intent_score ?? null,
    temperature: m.temperature ?? null,
  };
}

// ---- overview --------------------------------------------------------------
router.get('/overview', wrap(async (req, res) => {
  res.json(await buildOverview());
}));

// ---- accounts list ---------------------------------------------------------
router.get('/accounts', wrap(async (req, res) => {
  const bots = await listBots();
  const live = hasKey();
  const out = [];
  for (const b of bots) {
    const cc = contentCounts(b.slug);
    let fanCount = null;
    if (live) {
      try {
        const r = await select('fans', `bot_id=eq.${b.id}&select=id`);
        fanCount = r.length;
      } catch (_) {}
    }
    out.push({
      slug: b.slug,
      display_name: b.display_name || b.slug,
      platform_account: b.platform_account || '',
      model: b.model || '',
      automation_paused: !!b.automation_paused,
      hasContent: hasContent(b.slug),
      counts: { fans: fanCount, generations: cc.generations, posts: cc.posts },
    });
  }
  res.json({ live, accounts: out });
}));

// ---- single account (persona) ----------------------------------------------
router.get('/accounts/:slug', wrap(async (req, res) => {
  const bot = await requireBot(req.params.slug);
  // pull the heavy system_prompt (+ editable guards config) only here
  let system_prompt = '';
  let guards = {};
  let troll = {};
  if (hasKey()) {
    try {
      const r = await select('bots', `id=eq.${bot.id}&select=system_prompt,guards,settings`);
      system_prompt = (r[0] && r[0].system_prompt) || '';
      guards = (r[0] && r[0].guards) || {};
      troll = (r[0] && r[0].settings && r[0].settings.troll) || {};
    } catch (_) {}
  }
  res.json({
    slug: bot.slug,
    display_name: bot.display_name,
    platform_account: bot.platform_account,
    persona_notes: bot.persona_notes,
    model: bot.model,
    automation_paused: !!bot.automation_paused,
    reply_delay: normalizeDelay(bot.reply_delay),
    system_prompt,
    guards,
    troll,
    hasContent: hasContent(bot.slug),
    socials: parseSocials(bot.slug),
    references: listReference(bot.slug),
    docs: await readPersonaDocs(bot.slug, { withContent: true }),
  });
}));

// ---- generations -----------------------------------------------------------
router.get('/accounts/:slug/generations', wrap(async (req, res) => {
  await requireBot(req.params.slug);
  res.json(readManifest(req.params.slug));
}));

// ---- posts -----------------------------------------------------------------
router.get('/accounts/:slug/posts', wrap(async (req, res) => {
  await requireBot(req.params.slug);
  res.json(readPostedLog(req.params.slug));
}));

// ---- fans ------------------------------------------------------------------
router.get('/accounts/:slug/fans', wrap(async (req, res) => {
  const bot = await requireBot(req.params.slug);
  const rows = await select(
    'fans',
    `bot_id=eq.${bot.id}&select=id,username,display_name,platform,stage,buyer_type,msg_count,first_seen,last_seen,summary,metadata,first_name,last_name,email,person_id&order=last_seen.desc`,
  );
  res.json({ fans: rows.map(liftIntent) });
}));

router.get('/accounts/:slug/fans/:id', wrap(async (req, res) => {
  const bot = await requireBot(req.params.slug);
  const rows = await select('fans', `id=eq.${req.params.id}&bot_id=eq.${bot.id}&limit=1`);
  if (!rows[0]) throw Object.assign(new Error('fan not found'), { status: 404 });
  res.json(rows[0]);
}));

router.get('/accounts/:slug/fans/:id/messages', wrap(async (req, res) => {
  const bot = await requireBot(req.params.slug);
  const rows = await select(
    'messages',
    `fan_id=eq.${req.params.id}&bot_id=eq.${bot.id}&select=role,content,created_at&order=created_at.asc&limit=1000`,
  );
  res.json({ messages: rows });
}));

// cross-platform identity: who is this fan linked to (same person, any platform)?
router.get('/accounts/:slug/fans/:id/links', wrap(async (req, res) => {
  await requireBot(req.params.slug);
  const fanId = idNum(req.params.id);
  const me = await select('fans', `id=eq.${fanId}&select=id,person_id&limit=1`);
  if (!me[0]) throw Object.assign(new Error('fan not found'), { status: 404 });
  const personId = me[0].person_id;
  let linked = [];
  if (personId != null) {
    const rows = await select(
      'fans',
      `person_id=eq.${personId}&select=id,username,display_name,platform,bots(slug,display_name)&order=platform.asc`,
    );
    linked = rows.filter((r) => r.id !== fanId);
  }
  res.json({ fan_id: fanId, person_id: personId ?? null, linked });
}));

// search fans across ALL accounts/platforms (to pick a link target). q matches
// username/display_name. Returns the bot slug so the UI can deep-link to it.
router.get('/fan-search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const exclude = Number(req.query.exclude_fan) || 0;
  if (q.length < 1) return res.json({ results: [] });
  const pat = encodeURIComponent('*' + q.replace(/[(),]/g, ' ') + '*');
  const rows = await select(
    'fans',
    `or=(username.ilike.${pat},display_name.ilike.${pat})&select=id,username,display_name,platform,person_id,bots(slug,display_name)&order=last_seen.desc&limit=25`,
  );
  res.json({ results: rows.filter((r) => r.id !== exclude) });
}));

// link this fan to another fan (same human, other platform): merges memory and
// refreshes the shared cross-platform summary.
router.post('/accounts/:slug/fans/:id/link', wrap(async (req, res) => {
  await requireBot(req.params.slug);
  const fanId = idNum(req.params.id);
  const other = Number(req.body && req.body.other_fan_id);
  if (!Number.isInteger(other)) throw Object.assign(new Error('other_fan_id required'), { status: 400 });
  if (other === fanId) throw Object.assign(new Error('cannot link a fan to itself'), { status: 400 });
  const result = await rpc('dm_link_person', { p_fan_id: fanId, p_other_fan_id: other });
  await rpc('dm_refresh_person', { p_fan_id: fanId });
  res.json({ ok: true, result });
}));

// unlink this fan from its shared identity
router.post('/accounts/:slug/fans/:id/unlink', wrap(async (req, res) => {
  await requireBot(req.params.slug);
  await rpc('dm_unlink_fan', { p_fan_id: idNum(req.params.id) });
  res.json({ ok: true });
}));

// re-engage: fire the n8n re-engage workflow, which generates a natural re-opener
// from this fan's memory + history and sends it on the right platform.
router.post('/accounts/:slug/fans/:id/reengage', wrap(async (req, res) => {
  await requireBot(req.params.slug);
  const fanId = idNum(req.params.id);
  const base = process.env.N8N_BASE || 'https://automations.vedametric.com.au';
  const r = await fetch(`${base}/webhook/candace-reengage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fan_id: fanId }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw Object.assign(new Error(`re-engage trigger failed (${r.status}): ${t.slice(0, 150)}`), { status: 502 });
  }
  res.json({ ok: true });
}));

// ---- queue -----------------------------------------------------------------
router.get('/accounts/:slug/queue', wrap(async (req, res) => {
  const bot = await requireBot(req.params.slug);
  res.json({ rows: await queueRows(bot.id) });
}));

// ============================ WRITES ========================================

// edit bot registry fields (display_name, model, persona_notes, system_prompt)
router.patch('/accounts/:slug', wrap(async (req, res) => {
  const bot = await requireBot(req.params.slug);
  const allow = ['display_name', 'model', 'persona_notes', 'system_prompt'];
  const body = {};
  for (const k of allow) if (k in (req.body || {})) body[k] = req.body[k];
  if ('reply_delay' in (req.body || {})) body.reply_delay = validateDelay(req.body.reply_delay);
  if ('guards' in (req.body || {})) {
    const g = req.body.guards;
    if (typeof g !== 'object' || g === null || Array.isArray(g)) throw Object.assign(new Error('guards must be a json object'), { status: 400 });
    body.guards = g;
  }
  // troll / zero-intent config lives in bots.settings->'troll'; merge-write via
  // dm_set_troll so we never clobber other settings keys (reply_delay, spice…).
  let troll;
  if ('troll' in (req.body || {})) {
    const t = req.body.troll;
    if (typeof t !== 'object' || t === null || Array.isArray(t)) throw Object.assign(new Error('troll must be a json object'), { status: 400 });
    troll = await rpc('dm_set_troll', { p_slug: bot.slug, p_troll: t });
  }
  if (!Object.keys(body).length && troll === undefined) throw Object.assign(new Error('no editable fields supplied'), { status: 400 });
  const updated = Object.keys(body).length ? await patch('bots', `id=eq.${bot.id}`, body) : [bot];
  invalidateBots();
  res.json({ ok: true, bot: updated[0], troll: (troll && troll.troll) || undefined });
}));

// edit a persona markdown doc on disk; commit+push if a deploy token is present
router.put('/accounts/:slug/docs/:name', wrap(async (req, res) => {
  await requireBot(req.params.slug);
  const name = req.params.name;
  const body = (req.body && req.body.content) ?? '';
  if (typeof body !== 'string') throw Object.assign(new Error('content must be a string'), { status: 400 });
  const filePath = await writeDoc(req.params.slug, name, body);
  const git = await commitDoc(contentPath(req.params.slug), name).catch((e) => ({ committed: false, error: e.message }));
  res.json({ ok: true, path: filePath, git });
}));

// set a fan's funnel stage / buyer type (via dm_set_stage RPC) and/or the
// structured profile the responder's profiler accumulates.
router.patch('/accounts/:slug/fans/:id', wrap(async (req, res) => {
  const bot = await requireBot(req.params.slug);
  const { stage, buyer_type, profile, director_note } = req.body || {};
  if (stage == null && buyer_type == null && profile == null && director_note === undefined) {
    throw Object.assign(new Error('supply stage, buyer_type, profile and/or director_note'), { status: 400 });
  }
  if (stage != null || buyer_type != null) {
    await rpc('dm_set_stage', {
      p_fan_id: Number(req.params.id),
      p_stage: stage ?? null,
      p_buyer_type: buyer_type ?? null,
    });
  }
  if (profile != null) {
    if (typeof profile !== 'object' || Array.isArray(profile)) {
      throw Object.assign(new Error('profile must be a json object'), { status: 400 });
    }
    await patch('fans', `id=eq.${Number(req.params.id)}&bot_id=eq.${bot.id}`, { profile });
  }
  // director's note: a hidden steer injected into the model's context on the
  // next reply (empty string / null clears it).
  if (director_note !== undefined) {
    if (director_note != null && typeof director_note !== 'string') {
      throw Object.assign(new Error('director_note must be a string'), { status: 400 });
    }
    await rpc('dm_set_director_note', { p_fan_id: Number(req.params.id), p_note: director_note || '' });
  }
  res.json({ ok: true });
}));

// "+15m" hold — push this fan's next auto-reply back by N minutes (default 15).
router.post('/accounts/:slug/fans/:id/hold', wrap(async (req, res) => {
  await requireBot(req.params.slug);
  const minutes = Number((req.body && req.body.minutes) ?? 15);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
    throw Object.assign(new Error('minutes must be 1–1440'), { status: 400 });
  }
  const send_after = await rpc('dm_add_hold', { p_fan_id: Number(req.params.id), p_minutes: Math.round(minutes) });
  res.json({ ok: true, send_after });
}));

// send a manual message AS Candace (human takeover) — routes through n8n so it
// logs an assistant turn and delivers on the fan's platform.
router.post('/accounts/:slug/fans/:id/send', wrap(async (req, res) => {
  const bot = await requireBot(req.params.slug);
  const text = (req.body && req.body.text || '').trim();
  if (!text) throw Object.assign(new Error('text required'), { status: 400 });
  const base = process.env.N8N_BASE || 'https://automations.vedametric.com.au';
  const r = await fetch(`${base}/webhook/candace-admin-send`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fan_id: Number(req.params.id), slug: bot.slug, text }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw Object.assign(new Error(`send failed (${r.status}): ${t.slice(0, 150)}`), { status: 502 });
  }
  res.json({ ok: true });
}));

// "send now" — resume the waiting n8n execution via its stored resume_url
router.post('/accounts/:slug/queue/:eventId/send-now', wrap(async (req, res) => {
  await requireBot(req.params.slug);
  const ev = await select('events', `id=eq.${req.params.eventId}&select=payload&limit=1`);
  const url = ev[0] && ev[0].payload && ev[0].payload.resume_url;
  if (!url) throw Object.assign(new Error('no resume_url on that queued event'), { status: 400 });
  try {
    await fetch(url, { method: 'GET', cache: 'no-store' });
  } catch (_) {
    // n8n resume is fire-and-forget; ignore transport errors
  }
  res.json({ ok: true });
}));

// pause / resume this bot's automation (flag honored by the n8n gate node)
router.post('/accounts/:slug/automation', wrap(async (req, res) => {
  const bot = await requireBot(req.params.slug);
  const paused = !!(req.body && req.body.paused);
  await rpc('set_automation_paused', { p_slug: bot.slug, p_paused: paused });
  invalidateBots();
  res.json({ ok: true, automation_paused: paused });
}));

// ============================ CONTENT GENERATION ============================

// Fire the content-worker Routine on demand (drains the queue immediately instead of
// waiting for the hourly tick). Server-side only — the token never reaches the browser.
router.post('/worker/fire', wrap(async (req, res) => {
  const url = process.env.ROUTINE_FIRE_URL || '';
  const token = process.env.ROUTINE_FIRE_TOKEN || '';
  if (!url || !token) {
    throw Object.assign(new Error('worker fire not configured (set ROUTINE_FIRE_URL + ROUTINE_FIRE_TOKEN)'), { status: 503 });
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'experimental-cc-routine-2026-04-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: 'fired from dashboard — drain the content generation queue per generations/WORKER_RUNBOOK.md' }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw Object.assign(new Error(`routine fire failed (${r.status}): ${t.slice(0, 200)}`), { status: 502 });
  }
  res.json({ ok: true });
}));

// Deposit a finished generation straight onto the droplet so it shows in the gallery
// immediately — independent of which git branch the worker session is on. Writes the
// asset, appends generations/entries.json, updates balance.json, and rebuilds manifest.json.
router.post('/accounts/:slug/generations/deposit', wrap(async (req, res) => {
  await requireBot(req.params.slug);
  const { filename, data_base64, entry, balance_now_cr } = req.body || {};
  if (!filename || !/\.(png|mp4|jpe?g|webp)$/i.test(filename)) {
    throw Object.assign(new Error('valid filename (.png/.mp4/.jpg/.webp) required'), { status: 400 });
  }
  if (!data_base64 || typeof data_base64 !== 'string') {
    throw Object.assign(new Error('data_base64 required'), { status: 400 });
  }
  const safe = path.basename(filename); // no path traversal
  const b64 = data_base64.includes(',') ? data_base64.split(',').pop() : data_base64;
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length || buf.length > 60 * 1024 * 1024) {
    throw Object.assign(new Error('asset must be 1 byte–60 MB'), { status: 400 });
  }
  const genDir = path.join(contentPath(req.params.slug), 'generations');
  fs.mkdirSync(genDir, { recursive: true });
  fs.writeFileSync(path.join(genDir, safe), buf);

  // merge the entry into entries.json (dashboard-appended sidecar; keyed by file)
  if (entry && typeof entry === 'object') {
    const ep = path.join(genDir, 'entries.json');
    let sidecar = { entries: [] };
    try { sidecar = JSON.parse(fs.readFileSync(ep, 'utf8')); } catch (_) {}
    if (!Array.isArray(sidecar.entries)) sidecar.entries = [];
    sidecar.entries = sidecar.entries.filter((e) => e.file !== safe); // replace if re-deposited
    sidecar.entries.push({ file: safe, ...pick(entry, ['model', 'job', 'cost', 'batch', 'at', 'src', 'prompt', 'notes']) });
    fs.writeFileSync(ep, JSON.stringify(sidecar, null, 2));
  }
  // update the live balance ledger if provided
  if (Number.isFinite(Number(balance_now_cr))) {
    const bp = path.join(genDir, 'balance.json');
    let bal = {};
    try { bal = JSON.parse(fs.readFileSync(bp, 'utf8')); } catch (_) {}
    bal.balance_now_cr = Number(balance_now_cr);
    fs.writeFileSync(bp, JSON.stringify(bal, null, 2));
  }
  // rebuild manifest.json on the droplet
  await rebuildManifest(genDir);
  const manifest = readManifest(req.params.slug);
  res.json({ ok: true, count: manifest.count, file: safe });
}));

// Upload a reference image ("put Candace in THIS scene/pose/outfit"). Stored under
// the account's uploads/ dir and served at /content/:slug/uploads/<file>; the worker
// fetches it and uploads it to Higgsfield as a composition reference.
router.post('/accounts/:slug/upload', wrap(async (req, res) => {
  await requireBot(req.params.slug);
  const { filename, data_base64 } = req.body || {};
  if (!data_base64 || typeof data_base64 !== 'string') {
    throw Object.assign(new Error('data_base64 required'), { status: 400 });
  }
  const b64 = data_base64.includes(',') ? data_base64.split(',').pop() : data_base64;
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length || buf.length > 25 * 1024 * 1024) {
    throw Object.assign(new Error('image must be 1 byte–25 MB'), { status: 400 });
  }
  const ext = (String(filename || '').match(/\.(png|jpe?g|webp)$/i) || ['.png'])[0].toLowerCase();
  const safe = `ref_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`;
  const dir = path.join(contentPath(req.params.slug), 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, safe), buf);
  res.json({ ok: true, filename: safe, url: `/content/${encodeURIComponent(req.params.slug)}/uploads/${encodeURIComponent(safe)}` });
}));

// live prompt preview (no insert) — drives the Studio form
router.post('/accounts/:slug/gen/preview', wrap(async (req, res) => {
  await requireBot(req.params.slug);
  const brief = req.body || {};
  const built = buildPrompt(brief);
  const est = estimateCost(brief);
  const method = brief.kind === 'video' ? suggestMethod(brief) : null;
  res.json({ prompt: built.prompt, identity_ref: built.identity_ref, params: built.params,
    reworded: built.reworded, notes: built.notes, reference_driven: !!built.reference_driven,
    est_cost_cr: est.credits, cost_basis: est.basis, method });
}));

// queue a generation request (server builds the compliant prompt)
router.post('/accounts/:slug/gen', wrap(async (req, res) => {
  const bot = await requireBot(req.params.slug);
  const brief = req.body && typeof req.body === 'object' ? req.body : {};
  const kind = brief.kind === 'video' ? 'video' : 'image';
  const built = buildPrompt(brief);
  const est = estimateCost(brief);
  const method = kind === 'video' ? (brief.video_method || suggestMethod(brief).method) : null;
  // The prompt the user previewed/edited wins if supplied; else use the freshly built one.
  const prompt = (typeof brief.prompt === 'string' && brief.prompt.trim()) ? brief.prompt.trim() : built.prompt;
  const row = {
    bot_id: bot.id, slug: bot.slug, kind, video_method: method, status: 'queued',
    brief, prompt, parent_id: brief.parent_id || null,
    driving_video: brief.driving_video || null,
    est_cost_cr: est.credits, created_by: 'dashboard',
  };
  const inserted = await insert('gen_requests', row);
  res.json({ ok: true, request: inserted[0], reworded: built.reworded, notes: built.notes });
}));

// list queue + history for an account
router.get('/accounts/:slug/gen', wrap(async (req, res) => {
  const bot = await requireBot(req.params.slug);
  const rows = await select('gen_requests', `bot_id=eq.${bot.id}&order=created_at.desc&limit=100`);
  res.json({ requests: rows });
}));

router.get('/accounts/:slug/gen/:id', wrap(async (req, res) => {
  const bot = await requireBot(req.params.slug);
  const rows = await select('gen_requests', `id=eq.${idNum(req.params.id)}&bot_id=eq.${bot.id}&limit=1`);
  if (!rows[0]) throw Object.assign(new Error('request not found'), { status: 404 });
  res.json(rows[0]);
}));

// approve a generated option (the start-frame approval gate). For video, this is
// what unblocks the (expensive) video step the worker performs next.
router.post('/accounts/:slug/gen/:id/approve', wrap(async (req, res) => {
  const bot = await requireBot(req.params.slug);
  const reqRow = await getGen(bot.id, req.params.id);
  const jobId = req.body && req.body.job_id;
  if (!jobId) throw Object.assign(new Error('job_id of the chosen option is required'), { status: 400 });
  const options = Array.isArray(reqRow.options) ? reqRow.options.map((o) => ({ ...o, picked: o.job_id === jobId })) : [];
  const updated = await patch('gen_requests', `id=eq.${reqRow.id}`,
    { status: 'approved', approved_job: jobId, options });
  res.json({ ok: true, request: updated[0] });
}));

router.post('/accounts/:slug/gen/:id/reject', wrap(async (req, res) => {
  const bot = await requireBot(req.params.slug);
  const reqRow = await getGen(bot.id, req.params.id);
  const updated = await patch('gen_requests', `id=eq.${reqRow.id}`, { status: 'rejected' });
  res.json({ ok: true, request: updated[0] });
}));

router.post('/accounts/:slug/gen/:id/cancel', wrap(async (req, res) => {
  const bot = await requireBot(req.params.slug);
  const reqRow = await getGen(bot.id, req.params.id);
  const updated = await patch('gen_requests', `id=eq.${reqRow.id}`, { status: 'canceled' });
  res.json({ ok: true, request: updated[0] });
}));

// iterate wardrobe (§7.3): new request reusing the chosen frame as a composition
// reference, describing only what changes.
router.post('/accounts/:slug/gen/:id/iterate', wrap(async (req, res) => {
  const bot = await requireBot(req.params.slug);
  const parent = await getGen(bot.id, req.params.id);
  const changes = (req.body && req.body.changes) || {};
  const brief = { ...(parent.brief || {}), ...changes, parent_id: parent.id, compose_from_job: parent.approved_job };
  const built = buildPrompt(brief);
  const est = estimateCost(brief);
  const inserted = await insert('gen_requests', {
    bot_id: bot.id, slug: bot.slug, kind: brief.kind === 'video' ? 'video' : 'image',
    video_method: brief.kind === 'video' ? (brief.video_method || suggestMethod(brief).method) : null,
    status: 'queued', brief, prompt: built.prompt, parent_id: parent.id,
    est_cost_cr: est.credits, created_by: 'dashboard',
  });
  res.json({ ok: true, request: inserted[0] });
}));

function idNum(v) {
  const n = Number(v);
  if (!Number.isInteger(n)) throw Object.assign(new Error('bad id'), { status: 400 });
  return n;
}
async function getGen(botId, id) {
  const rows = await select('gen_requests', `id=eq.${idNum(id)}&bot_id=eq.${botId}&limit=1`);
  if (!rows[0]) throw Object.assign(new Error('request not found'), { status: 404 });
  return rows[0];
}
function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}
// Rebuild generations/manifest.json by running the existing build script in that dir.
async function rebuildManifest(genDir) {
  try {
    await execFileP('python3', ['build_manifest.py'], { cwd: genDir, timeout: 30000 });
  } catch (e) {
    throw Object.assign(new Error(`manifest rebuild failed: ${(e.stderr || e.message || '').toString().slice(0, 200)}`), { status: 500 });
  }
}

export default router;
