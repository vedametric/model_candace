// All read + write API endpoints. Mounted at /api by server.js.
// Reads fuse Supabase (live) + filesystem (git content); writes are strictly scoped.

import express from 'express';
import { listBots, getBot, hasContent, contentPath } from '../accounts.js';
import { select, patch, rpc, hasKey } from '../supabase.js';
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
  // pull the heavy system_prompt only here
  let system_prompt = '';
  if (hasKey()) {
    try {
      const r = await select('bots', `id=eq.${bot.id}&select=system_prompt`);
      system_prompt = (r[0] && r[0].system_prompt) || '';
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
    `bot_id=eq.${bot.id}&select=id,username,display_name,platform,stage,buyer_type,msg_count,first_seen,last_seen,summary,metadata&order=last_seen.desc`,
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
  if (!Object.keys(body).length) throw Object.assign(new Error('no editable fields supplied'), { status: 400 });
  const updated = await patch('bots', `id=eq.${bot.id}`, body);
  res.json({ ok: true, bot: updated[0] });
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

// set a fan's funnel stage / buyer type via the dm_set_stage RPC
router.patch('/accounts/:slug/fans/:id', wrap(async (req, res) => {
  await requireBot(req.params.slug);
  const { stage, buyer_type } = req.body || {};
  if (stage == null && buyer_type == null) {
    throw Object.assign(new Error('supply stage and/or buyer_type'), { status: 400 });
  }
  await rpc('dm_set_stage', {
    p_fan_id: Number(req.params.id),
    p_stage: stage ?? null,
    p_buyer_type: buyer_type ?? null,
  });
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
  res.json({ ok: true, automation_paused: paused });
}));

export default router;
