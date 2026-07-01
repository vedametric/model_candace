'use strict';
// ---------------- helpers ----------------
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
let ACCOUNTS = [];
let LIVE = true;
let timers = [];
let S_CARRY = { reference_image: null, parent_id: null };
let prefillStudio = null;
let S_ROWS = [];

function clearTimers() { timers.forEach(clearInterval); timers = []; }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function initials(s) { return String(s || '?').replace(/[^a-z0-9 ]/gi, '').split(/[ _]/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join(''); }

async function api(path, opts) {
  const res = await fetch('/api' + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  const txt = await res.text();
  const data = txt ? JSON.parse(txt) : {};
  if (!res.ok) throw new Error(data.error || res.status);
  return data;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}
function copy(text) { navigator.clipboard.writeText(text).then(() => toast('copied')); }
window.copy = copy;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',').pop());
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// click-to-enlarge lightbox (images + video)
function openLightbox(src, isVideo) {
  let lb = document.getElementById('lightbox');
  if (!lb) {
    lb = document.createElement('div'); lb.id = 'lightbox';
    lb.onclick = () => { lb.style.display = 'none'; lb.innerHTML = ''; };
    document.body.appendChild(lb);
  }
  lb.innerHTML = isVideo
    ? `<video src="${src}" controls autoplay playsinline></video>`
    : `<img src="${src}" alt="">`;
  lb.style.display = 'flex';
}
window.openLightbox = openLightbox;

function fmtClock(iso) { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch (e) { return ''; } }
function fmtDateTime(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; } }
function fmtDur(sec) { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return m + ':' + String(s).padStart(2, '0'); }

const TABS = [
  { id: 'persona', label: 'Persona' },
  { id: 'studio', label: 'Studio' },
  { id: 'generations', label: 'Generations' },
  { id: 'posts', label: 'Posts' },
  { id: 'fans', label: 'Fans' },
  { id: 'queue', label: 'Queue' },
];

// ---------------- boot ----------------
async function boot() {
  try {
    const d = await api('/accounts');
    ACCOUNTS = d.accounts || []; LIVE = d.live;
  } catch (e) {
    ACCOUNTS = []; LIVE = false;
    $('#account-list').innerHTML = `<div class="loading">accounts unavailable: ${esc(e.message)}</div>`;
  }
  renderSidebar();
  $('#refresh').onclick = () => route(true);
  // mobile: hamburger opens the off-canvas sidebar; scrim closes it
  const tgl = $('#navtoggle'); if (tgl) tgl.onclick = () => $('#app').classList.toggle('nav-open');
  const scrim = $('#nav-scrim'); if (scrim) scrim.onclick = () => $('#app').classList.remove('nav-open');
  window.addEventListener('hashchange', () => route());
  if (!location.hash) location.hash = '#/overview';
  route();
}

// ---------------- identities (one person = many platform bots) ----------------
// bots that share platform_account are the same identity (e.g. candace_summers +
// candace_telegram). The sidebar shows one entry per identity; Persona/Studio/
// Generations/Posts switch platform within it; Fans/Queue merge across members.
function botPlatform(b) {
  const s = (b.slug || '').toLowerCase(), d = (b.display_name || '').toLowerCase();
  if (s.includes('telegram') || d.includes('telegram')) return 'telegram';
  if (s.includes('instagram') || d.includes('instagram')) return 'instagram';
  return 'tiktok';
}
const PLAT_ORDER = { tiktok: 0, instagram: 1, telegram: 2 };
function identityKey(b) { return b.platform_account || b.slug; }
function identities() {
  const map = new Map();
  ACCOUNTS.forEach(b => {
    const k = identityKey(b);
    if (!map.has(k)) map.set(k, { key: k, members: [] });
    map.get(k).members.push(b);
  });
  for (const idn of map.values()) {
    idn.members.sort((a, b) => (PLAT_ORDER[botPlatform(a)] ?? 9) - (PLAT_ORDER[botPlatform(b)] ?? 9));
    idn.byPlatform = {};
    idn.members.forEach(m => { idn.byPlatform[botPlatform(m)] = m; });
    const primary = idn.members.find(m => m.slug === idn.key) || idn.members[0];
    idn.label = (primary.display_name || idn.key).replace(/\s*\(telegram\)\s*/i, '').trim();
    idn.fans = idn.members.reduce((s, m) => s + ((m.counts && m.counts.fans) || 0), 0);
    idn.paused = idn.members.some(m => m.automation_paused);
  }
  return [...map.values()];
}
function getIdentity(key) { return identities().find(i => i.key === key) || null; }
function identityKeyForSlug(slug) { const b = ACCOUNTS.find(a => a.slug === slug); return b ? identityKey(b) : slug; }
function membersOf(key) { const i = getIdentity(key); return i ? i.members : []; }

function renderSidebar() {
  const list = $('#account-list');
  const idns = identities();
  if (!idns.length) { list.innerHTML = '<div class="loading">no accounts</div>'; return; }
  list.innerHTML = idns.map(a => `<div class="acct" data-key="${esc(a.key)}">
      <div class="av">${esc(initials(a.label))}</div>
      <div class="nm"><b>${esc(a.label)}</b><span>${a.members.map(m => sourceLabel(botPlatform(m))).join(' · ')}</span></div>
      ${a.paused ? '<span class="dot-pause" title="automation paused"></span>' : ''}
      ${a.fans ? `<span class="badge-fans">${a.fans}</span>` : ''}
    </div>`).join('');
  list.querySelectorAll('.acct').forEach(el => el.onclick = () => { location.hash = `#/a/${el.dataset.key}/persona`; });
  $('#side-foot').innerHTML = `${idns.length} identit${idns.length === 1 ? 'y' : 'ies'}${LIVE ? '' : ' · <span style="color:#c9a">live data off</span>'}`;
}

function setActive(key, tab) {
  document.querySelectorAll('.acct').forEach(e => e.classList.toggle('active', e.dataset.key === key));
  $('.nav-overview').classList.toggle('active', !key);
  const tabsEl = $('#tabs');
  if (key) {
    const idn = getIdentity(key);
    $('#crumb').textContent = (idn && idn.label) || key;
    tabsEl.innerHTML = TABS.map(t => `<div class="tab ${t.id === tab ? 'active' : ''}" data-tab="${t.id}">${t.label}</div>`).join('');
    tabsEl.querySelectorAll('.tab').forEach(el => el.onclick = () => { location.hash = `#/a/${key}/${el.dataset.tab}`; });
  } else {
    $('#crumb').textContent = 'Global Overview'; tabsEl.innerHTML = '';
  }
}

// Wraps Persona/Studio/Generations/Posts with a TikTok⇄Telegram platform switch,
// routing to the right member bot (each may use a different model).
async function contentView(key, tab, platform) {
  const idn = getIdentity(key);
  if (!idn) { view.innerHTML = errBox('unknown identity'); return; }
  const plats = idn.members.map(botPlatform);
  platform = plats.includes(platform) ? platform : plats[0];
  const member = idn.byPlatform[platform] || idn.members[0];
  setActive(key, tab);
  const fn = { persona, studio, generations, posts }[tab] || persona;
  await fn(member.slug);
  const bar = `<div class="row" style="gap:8px;margin:0 0 14px;align-items:center">
    <span class="dim" style="font-size:12px">View</span>
    ${plats.map(p => `<button class="btn sm ${p === platform ? 'primary' : ''}" data-plat="${p}">${esc(sourceLabel(p))}</button>`).join('')}
    ${member.model ? `<span class="dim" style="font-size:12px;margin-left:6px">model: ${esc(member.model)}</span>` : ''}</div>`;
  view.insertAdjacentHTML('afterbegin', bar);
  view.querySelectorAll('button[data-plat]').forEach(b => b.onclick = () => { location.hash = `#/a/${key}/${tab}/${b.dataset.plat}`; });
}

// ---------------- router ----------------
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const p = h.split('/').filter(Boolean);
  if (p[0] === 'a') return { key: p[1], tab: p[2] || 'persona', sub: p[3] };
  return { route: p[0] || 'overview' };
}

async function route(force) {
  clearTimers();
  const appEl = $('#app'); if (appEl) appEl.classList.remove('nav-open'); // close mobile drawer on nav
  const r = parseHash();
  if (r.key) {
    setActive(r.key, r.tab);
    if (r.tab === 'fans' && r.sub) { const [slug, id] = String(r.sub).split('.'); return fanDetail(slug, id); }
    if (['persona', 'studio', 'generations', 'posts'].includes(r.tab)) return contentView(r.key, r.tab, r.sub);
    if (r.tab === 'fans') return fansForIdentity(r.key);
    if (r.tab === 'queue') return queueForIdentity(r.key);
    return contentView(r.key, 'persona', r.sub);
  }
  setActive(null);
  return overview();
}

function loading() { view.innerHTML = '<div class="loading big">loading…</div>'; }
function errBox(e) { return `<div class="err-banner">could not load: ${esc(e.message || e)}</div>`; }

// ---------------- OVERVIEW ----------------
async function overview() {
  loading();
  let d; try { d = await api('/overview'); } catch (e) { view.innerHTML = errBox(e); return; }
  const t = d.totals;
  const stage = barList(d.stageTotals);
  const buyer = barList(d.buyerTotals);
  view.innerHTML = `
    ${d.live ? '' : '<div class="warn-banner">Live Supabase data is disabled (no service key on the server). Content metrics still shown.</div>'}
    <div class="kpis">
      <div class="kpi accent"><b>${t.accounts}</b><span>Accounts</span></div>
      <div class="kpi"><b>${t.fans}</b><span>Fans tracked</span></div>
      <div class="kpi"><b>${t.net_spent_cr}</b><span>Credits spent</span></div>
      <div class="kpi"><b>${t.assets}</b><span>Generations</span></div>
      <div class="kpi"><b>${t.posts}</b><span>Posts</span></div>
      <div class="kpi"><b>${d.queue24h.sent}/${d.queue24h.queued}</b><span>DMs sent / queued (24h)</span></div>
    </div>
    <div class="grid2">
      <div class="panel"><h3>Fans by stage</h3>${stage || '<div class="muted">no fan data</div>'}</div>
      <div class="panel"><h3>Fans by buyer type</h3>${buyer || '<div class="muted">no fan data</div>'}</div>
    </div>
    <div class="panel"><h3>Accounts</h3>
      <table><thead><tr><th>Account</th><th>Platform</th><th>Fans</th><th>Generations</th><th>Posts</th><th>Spend</th><th>Pacing</th><th>Automation</th></tr></thead>
      <tbody>${d.accounts.map(a => `<tr data-slug="${esc(a.slug)}">
        <td><b>${esc(a.display_name)}</b>${a.hasContent ? '' : ' <span class="tag">no content</span>'}</td>
        <td class="dim">${esc(a.platform_account || '—')}</td>
        <td>${a.fans}</td><td>${a.generations}</td><td>${a.posts}</td>
        <td>${a.net_spent_cr} cr</td>
        <td class="dim">${fmtPacing(a.reply_delay)}</td>
        <td>${a.automation_paused ? '<span class="tag pend">paused</span>' : '<span class="tag ok">active</span>'}</td></tr>`).join('')}
      </tbody></table>
    </div>`;
  view.querySelectorAll('tr[data-slug]').forEach(tr => tr.onclick = () => location.hash = `#/a/${identityKeyForSlug(tr.dataset.slug)}/persona`);
}
function fmtPacing(d) {
  if (!d) return '—';
  const m = (s) => (s == null ? '?' : s >= 90 ? (s / 60).toFixed(s % 60 ? 1 : 0) + 'm' : s + 's');
  const pct = Math.round((d.quick_chance ?? 0) * 100);
  return `${m(d.min_sec)}–${m(d.max_sec)}<span class="muted"> · ${pct}% quick ${m(d.quick_min_sec)}–${m(d.quick_max_sec)}</span>`;
}
function barList(obj) {
  const ents = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
  if (!ents.length) return '';
  const max = Math.max(...ents.map(e => e[1]));
  return ents.map(([k, v]) => `<div class="row" style="margin:7px 0">
    <span class="tag stage" style="min-width:96px">${esc(k)}</span>
    <div class="ibar" style="width:160px"><i style="width:${Math.round(v / max * 100)}%"></i></div>
    <b>${v}</b></div>`).join('');
}

// ---------------- PERSONA ----------------
async function persona(slug) {
  loading();
  let d; try { d = await api('/accounts/' + slug); } catch (e) { view.innerHTML = errBox(e); return; }
  const socials = Object.entries(d.socials || {}).map(([k, v]) => `<span class="tag">${esc(k)}: ${esc(v)}</span>`).join(' ') || '<span class="muted">none parsed</span>';
  const refs = (d.references || []).map(r => `<img src="${r.url}" alt="${esc(r.file)}" title="${esc(r.file)}">`).join('') || '<span class="muted">no reference images</span>';
  view.innerHTML = `
    <div class="grid2">
      <div class="panel">
        <h3>Identity</h3>
        <div class="field"><label>Display name</label><input id="f-name" value="${esc(d.display_name || '')}"></div>
        <div class="field"><label>Reply model</label><input id="f-model" value="${esc(d.model || '')}"></div>
        <div class="field"><label>Platform account</label><div>${esc(d.platform_account || '—')}</div></div>
        <div class="field"><label>Social / funnel links</label><div class="row">${socials}</div></div>
        <div class="field"><label>Automation</label>
          <button id="pausebtn" class="btn ${d.automation_paused ? 'warn' : ''}">${d.automation_paused ? '▶ Resume automation' : '⏸ Pause automation'}</button>
          <span class="muted" style="margin-left:8px">${d.automation_paused ? 'paused' : 'active'}</span>
        </div>
        <div class="field"><label>Persona notes</label><textarea id="f-notes" rows="3">${esc(d.persona_notes || '')}</textarea></div>
        <button id="save-bot" class="btn primary">Save identity</button>
      </div>
      <div class="panel"><h3>Reference images</h3><div class="ref-imgs">${refs}</div></div>
    </div>
    ${timingPanel(d.reply_delay || {})}
    <div class="panel">
      <div class="row between"><h3 style="margin:0">System prompt (live DM brain)</h3>
        <button id="save-prompt" class="btn primary sm">Save system prompt</button></div>
      <textarea id="f-prompt" rows="14" style="margin-top:10px">${esc(d.system_prompt || '')}</textarea>
      <div class="muted" style="margin-top:6px;font-size:12px">Saving writes to <code>bots.system_prompt</code> — used by the live n8n DM flow on the next message.</div>
    </div>
    ${guardsPanel(d.guards || {})}
    ${trollPanel(d.troll || {})}
    <div class="panel"><h3>Persona docs</h3>${(d.docs || []).map(doc => docBlock(slug, doc)).join('')}</div>`;

  $('#save-bot').onclick = async () => {
    try {
      await api('/accounts/' + slug, { method: 'PATCH', body: JSON.stringify({ display_name: $('#f-name').value, model: $('#f-model').value, persona_notes: $('#f-notes').value }) });
      toast('identity saved'); const a = ACCOUNTS.find(x => x.slug === slug); if (a) { a.display_name = $('#f-name').value; renderSidebar(); }
    } catch (e) { toast('error: ' + e.message); }
  };
  $('#save-prompt').onclick = async () => {
    try { await api('/accounts/' + slug, { method: 'PATCH', body: JSON.stringify({ system_prompt: $('#f-prompt').value }) }); toast('system prompt saved'); }
    catch (e) { toast('error: ' + e.message); }
  };
  const saveGuards = $('#save-guards');
  if (saveGuards) saveGuards.onclick = async () => {
    const guards = collectGuards(d.guards || {});
    saveGuards.disabled = true;
    try {
      await api('/accounts/' + slug, { method: 'PATCH', body: JSON.stringify({ guards }) });
      // verify → ok: re-read and confirm it persisted
      const fresh = await api('/accounts/' + slug);
      d.guards = fresh.guards || {};
      toast('guards saved — live on the next message');
    } catch (e) { toast('error: ' + e.message); }
    saveGuards.disabled = false;
  };
  const saveTroll = $('#save-troll');
  if (saveTroll) saveTroll.onclick = async () => {
    const troll = collectTroll(d.troll || {});
    saveTroll.disabled = true;
    try {
      await api('/accounts/' + slug, { method: 'PATCH', body: JSON.stringify({ troll }) });
      const fresh = await api('/accounts/' + slug);
      d.troll = fresh.troll || {};
      toast('troll detector saved — live on the next message');
      persona(slug);
    } catch (e) { toast('error: ' + e.message); }
    saveTroll.disabled = false;
  };
  $('#pausebtn').onclick = async (ev) => {
    const paused = !d.automation_paused;
    try { await api('/accounts/' + slug + '/automation', { method: 'POST', body: JSON.stringify({ paused }) }); toast(paused ? 'automation paused' : 'automation resumed'); persona(slug); }
    catch (e) { toast('error: ' + e.message); }
  };
  const saveTiming = $('#save-timing');
  if (saveTiming) saveTiming.onclick = async () => {
    const rd = {
      min_sec: +$('#t-min').value, max_sec: +$('#t-max').value,
      quick_chance: +$('#t-qchance').value,
      quick_min_sec: +$('#t-qmin').value, quick_max_sec: +$('#t-qmax').value,
    };
    try {
      await api('/accounts/' + slug, { method: 'PATCH', body: JSON.stringify({ reply_delay: rd }) });
      toast('reply timing saved'); persona(slug);
    } catch (e) { toast('error: ' + e.message); }
  };
  view.querySelectorAll('[data-doc]').forEach(wireDoc(slug));
}
function timingPanel(d) {
  const mins = (s) => (s == null ? '' : (s / 60).toFixed(s % 60 ? 1 : 0) + 'm');
  const v = {
    min_sec: d.min_sec ?? 120, max_sec: d.max_sec ?? 600,
    quick_chance: d.quick_chance ?? 0.15,
    quick_min_sec: d.quick_min_sec ?? 45, quick_max_sec: d.quick_max_sec ?? 120,
  };
  const pct = Math.round(v.quick_chance * 100);
  return `<div class="panel">
    <div class="row between"><h3 style="margin:0">Reply timing (per persona)</h3>
      <button id="save-timing" class="btn primary sm">Save timing</button></div>
    <p class="muted" style="font-size:12.5px;margin:8px 0 14px">How long she waits before replying to a DM. Most replies use the normal window; <b>${pct}%</b> of the time she fires back quicker. Read live by the n8n flow (see <code>automation/n8n/REPLY_TIMING.md</code>).</p>
    <div class="row" style="gap:22px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0"><label>Normal delay — min (sec)</label><input id="t-min" type="number" min="0" value="${v.min_sec}" style="width:120px"><div class="muted" style="font-size:11px;margin-top:3px">${mins(v.min_sec)}</div></div>
      <div class="field" style="margin:0"><label>Normal delay — max (sec)</label><input id="t-max" type="number" min="0" value="${v.max_sec}" style="width:120px"><div class="muted" style="font-size:11px;margin-top:3px">${mins(v.max_sec)}</div></div>
      <div class="field" style="margin:0"><label>Quick-reply chance (0–1)</label><input id="t-qchance" type="number" min="0" max="1" step="0.05" value="${v.quick_chance}" style="width:120px"><div class="muted" style="font-size:11px;margin-top:3px">${pct}% of replies</div></div>
      <div class="field" style="margin:0"><label>Quick delay — min (sec)</label><input id="t-qmin" type="number" min="0" value="${v.quick_min_sec}" style="width:120px"></div>
      <div class="field" style="margin:0"><label>Quick delay — max (sec)</label><input id="t-qmax" type="number" min="0" value="${v.quick_max_sec}" style="width:120px"></div>
    </div>
  </div>`;
}
// behaviour guards editor (per persona) — stored in bots.guards, applied live via dm_ingest
const GUARD_META = {
  no_chatbot:        { label: 'Anti-chatbot voice (always on)',      type: 'text',     help: 'Kills the empathetic-assistant drift: no validating/mirroring, no interviewing, no brand words; stay short, teasing, the prize.' },
  paid_content_line: { label: 'Paid-content line (OnlyFans asks)',   type: 'text',     help: 'When he asks about OnlyFans / content / what he gets: not on OF (family), some content on Telegram. Coy, generic, no price, no hard sell.' },
  ppv_naughty:       { label: 'PPV / naughty content',              type: 'text',     help: 'When he asks to see her / for pics / naughty content: share a tame selfie lightly, frame spicy pics as PPV — casual, no price, no hard sell, never explicit in chat. (Telegram only.)' },
  greeting_flat:     { label: 'Greeting → short & flat',            type: 'text',     help: 'On a bare "hey" / one word, reply with one short cool line — no question, no probing.' },
  no_question:       { label: 'No-question line',                    type: 'text',     help: 'Used when she should make a statement instead of asking a question (classifier ask_back = false).' },
  funnel_give:       { label: 'Funnel give (soft "massage it in")',   type: 'text',     help: 'When it is time to point him to Telegram: soft two-step (float it casually → let him ask → drop the @ offhand), never a cold drop or end-of-line CTA. (TikTok only.)' },
  funnel_stage_note: { label: 'Funnel (after telegram given)',       type: 'text',     help: 'Once funnelled: never repeat the username, no call-to-action, no eagerness. (TikTok only.)' },
  funnel_friction:   { label: 'Funnel friction (trouble joining TG)', type: 'text',     help: 'When a willing lead reports Telegram trouble: help lightly once, then keep him warm and leave the door open instead of dismissing him. (TikTok only.)' },
  age_gate:          { label: 'Age gate (anti-hallucination)',       type: 'toggle',   help: 'Keep an extracted age only if he stated his OWN age (first person). Blocks guess-my-age numbers.' },
  relationship_gate: { label: 'Relationship gate (anti-hallucination)', type: 'keywords', help: 'Keep a relationship status only if his messages contain one of these keywords.' },
  spark:             { label: 'Spark follow-up (proactive re-engage)', type: 'toggle',   help: 'After a reply, sometimes send ONE extra spontaneous message to revive a quiet chat. Auto-suppressed on steered replies (director/next-reply note). Telegram only.' },
};
function guardsPanel(guards) {
  guards = (guards && typeof guards === 'object' && !Array.isArray(guards)) ? guards : {};
  const keys = Object.keys(GUARD_META).filter(k => k in guards);
  if (!keys.length) return '';
  const block = (k) => {
    const g = guards[k] || {}; const meta = GUARD_META[k]; const on = g.enabled !== false;
    let body = '';
    if (meta.type === 'text') body = `<textarea data-gtext="${k}" rows="4">${esc(g.text || '')}</textarea>`;
    else if (meta.type === 'keywords') body = `<input data-gkw="${k}" value="${esc((g.keywords || []).join(', '))}" placeholder="single, married, girlfriend, …">`;
    return `<div class="field" style="border-top:1px solid var(--line);padding-top:10px">
      <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" data-genable="${k}" ${on ? 'checked' : ''} style="width:auto"> <b>${meta.label}</b></label>
      <div class="muted" style="font-size:12px;margin:2px 0 6px">${meta.help}</div>
      ${body}
    </div>`;
  };
  return `<div class="panel" id="guards-panel">
    <div class="row between"><h3 style="margin:0">Behavior &amp; guards</h3>
      <button id="save-guards" class="btn primary sm">Save guards</button></div>
    <div class="muted" style="margin:6px 0 10px;font-size:12px">Voice rules + anti-hallucination gates the live flow enforces. Stored in <code>bots.guards</code>, applied on the next message (no redeploy). Uncheck to disable a guard.</div>
    ${keys.map(block).join('')}
  </div>`;
}
function collectGuards(current) {
  const out = JSON.parse(JSON.stringify(current || {}));
  Object.keys(GUARD_META).forEach(k => {
    if (!(k in out) || typeof out[k] !== 'object' || out[k] === null) return;
    const en = document.querySelector(`#guards-panel [data-genable="${k}"]`); if (en) out[k].enabled = !!en.checked;
    const tx = document.querySelector(`#guards-panel [data-gtext="${k}"]`);   if (tx) out[k].text = tx.value;
    const kw = document.querySelector(`#guards-panel [data-gkw="${k}"]`);     if (kw) out[k].keywords = kw.value.split(',').map(s => s.trim()).filter(Boolean);
  });
  return out;
}
// troll / zero-intent detector config — stored in bots.settings->'troll',
// applied live via the n8n Troll Gate on the next message (no redeploy).
const TROLL_SCALARS = {
  decay:                { label: 'Score decay per turn',   help: 'fraction of the prior troll score carried into the next turn (0–1). higher = slower to forgive.' },
  bot_test_after_turn:  { label: '"Are you AI?" grace turns', help: 'calling her a bot only counts as a signal after this many turns.' },
  minimal_reply_chance: { label: 'Minimal-mode reply chance', help: 'at "minimal" mode, chance she bothers to reply at all (0–1).' },
};
const TROLL_GROUPS = {
  weights:       { label: 'Signal weights (points added)', help: 'how many points each time-wasting signal adds to the score.' },
  cooldown:      { label: 'Cooldowns (points subtracted)', help: 'genuine signals that pull the score back down.' },
  bands:         { label: 'Score bands → mode',           help: 'score thresholds that switch her into cool / minimal / ghost.' },
  stall_ladder:  { label: 'Post-funnel stall ladder',     help: 'consecutive "telegram won\'t work / been busy" stalls that force cool / minimal / ghost.' },
  delay_penalty: { label: 'Delay penalty (seconds)',       help: 'extra seconds added before a flagged reply is sent.' },
};
function trollPanel(t) {
  t = (t && typeof t === 'object' && !Array.isArray(t)) ? t : {};
  if (!Object.keys(t).length) return '';
  const enabled = t.enabled !== false, shadow = t.shadow_mode !== false;
  const stateTag = !enabled ? '<span class="tag">disabled</span>'
    : shadow ? '<span class="tag" style="background:#5a4a00;color:#ffcc66">shadow · observing</span>'
             : '<span class="tag" style="background:#0a3a1e;color:#3ddc84">ARMED</span>';
  const numField = (group, key, val) =>
    `<div class="field" style="margin:0"><label style="font-size:12px">${key}</label>
      <input type="number" step="any" ${group ? `data-tgroup="${group}" data-tk="${key}"` : `data-tkey="${key}"`} value="${val == null ? '' : esc(String(val))}"></div>`;
  const groupBlock = (g) => {
    const obj = (t[g] && typeof t[g] === 'object') ? t[g] : null; if (!obj) return '';
    const meta = TROLL_GROUPS[g];
    return `<div class="field" style="border-top:1px solid var(--line);padding-top:10px">
      <label><b>${meta.label}</b></label><div class="muted" style="font-size:12px;margin:2px 0 8px">${meta.help}</div>
      <div class="grid-mini">${Object.keys(obj).map(k => numField(g, k, obj[k])).join('')}</div></div>`;
  };
  const scalarBlock = Object.keys(TROLL_SCALARS).filter(k => k in t).map(k =>
    `<div class="field" style="margin:0"><label style="font-size:12px">${TROLL_SCALARS[k].label}</label>
      <input type="number" step="any" data-tkey="${k}" value="${t[k] == null ? '' : esc(String(t[k]))}">
      <div class="muted" style="font-size:11px">${TROLL_SCALARS[k].help}</div></div>`).join('');
  return `<div class="panel" id="troll-panel">
    <div class="row between"><h3 style="margin:0">Troll / zero-intent detector ${stateTag}</h3>
      <button id="save-troll" class="btn primary sm">Save detector</button></div>
    <div class="muted" style="margin:6px 0 10px;font-size:12px">Scores time-wasting (bot-baiting, mockery, "talk dirty first", post-funnel stalling) and escalates cool → minimal (delay penalty) → ghost (no reply). Stored in <code>bots.settings.troll</code>, applied on the next message. <b>Shadow mode</b> logs a score without changing replies — uncheck it to arm.</div>
    <div class="field"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" data-tkey="enabled" ${enabled ? 'checked' : ''} style="width:auto"> <b>Enabled</b></label></div>
    <div class="field"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" data-tkey="shadow_mode" ${shadow ? 'checked' : ''} style="width:auto"> <b>Shadow mode</b> <span class="muted" style="font-weight:normal">(observe + log only; uncheck to arm)</span></label></div>
    <div class="grid-mini" style="margin:6px 0">${scalarBlock}</div>
    ${Object.keys(TROLL_GROUPS).map(groupBlock).join('')}
  </div>`;
}
function collectTroll(current) {
  const out = JSON.parse(JSON.stringify(current || {}));
  document.querySelectorAll('#troll-panel [data-tkey]').forEach(el => {
    const k = el.dataset.tkey;
    out[k] = el.type === 'checkbox' ? el.checked : (el.value === '' ? null : Number(el.value));
  });
  document.querySelectorAll('#troll-panel [data-tgroup]').forEach(el => {
    const g = el.dataset.tgroup, k = el.dataset.tk;
    if (typeof out[g] !== 'object' || out[g] === null) out[g] = {};
    out[g][k] = el.value === '' ? null : Number(el.value);
  });
  return out;
}
function docBlock(slug, doc) {
  return `<details class="prompt" style="margin-bottom:10px" data-docwrap="${esc(doc.name)}">
    <summary><b>${esc(doc.label)}</b> <span class="muted">${esc(doc.name)}${doc.exists ? '' : ' · missing'}</span></summary>
    <div style="margin-top:10px">
      <textarea data-doc="${esc(doc.name)}" rows="10">${esc(doc.content || '')}</textarea>
      <div class="row" style="margin-top:8px"><button class="btn primary sm" data-savedoc="${esc(doc.name)}">Save ${esc(doc.name)}</button>
      <span class="muted" data-docstat="${esc(doc.name)}"></span></div>
    </div></details>`;
}
function wireDoc(slug) {
  return (ta) => {};
}
// delegate doc save buttons
view.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-savedoc]'); if (!b) return;
  const name = b.getAttribute('data-savedoc');
  const slug = parseHash().slug; if (!slug) return;
  const ta = view.querySelector(`textarea[data-doc="${CSS.escape(name)}"]`);
  const stat = view.querySelector(`[data-docstat="${CSS.escape(name)}"]`);
  b.disabled = true;
  try {
    const r = await api(`/accounts/${slug}/docs/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify({ content: ta.value }) });
    const g = r.git || {};
    stat.textContent = g.pushed ? 'saved & pushed to git' : (g.committed ? 'saved & committed' : 'saved on disk (ephemeral until deploy)');
    toast('saved ' + name);
  } catch (err) { stat.textContent = 'error: ' + err.message; }
  b.disabled = false;
});

// ---------------- STUDIO (content generation) ----------------
const STATUS_TAG = {
  queued: 'pend', generating: 'pend', awaiting_approval: 'pend', approved: 'ok',
  running_video: 'pend', done: 'ok', rejected: 'bad', failed: 'bad', canceled: 'bad',
};
async function studio(slug) {
  loading();
  view.innerHTML = `
    <div class="warn-banner" style="background:rgba(71,110,102,.08);border-color:var(--secondary);color:var(--text)">
      🔒 <b>Locked rules apply to every generation</b> — shot on iPhone, natural light only, candid &amp; unposed,
      NOT retouched, no studio/pro polish. Tasteful &amp; SFW (suggestive, no nudity). The identity reference
      <code>49aff4e5</code> is attached to every job. Filter-risky wording is auto-reworded.
    </div>
    <div class="panel">
      <div class="row between"><h3 style="margin:0">New content brief</h3>
        <div class="row"><span class="muted" id="s-balance"></span>
          <select id="s-kind" style="width:auto"><option value="image">📷 Image (still)</option><option value="video">🎬 Video</option></select></div>
      </div>
      <div class="sform" style="margin-top:14px">
        <div class="field"><label>Shot type</label><input id="s-shot" placeholder="arm's-length selfie / mirror selfie"></div>
        <div class="field"><label>Lighting</label><input id="s-light" placeholder="soft window daylight / golden-hour sun"></div>
        <div class="field span2"><label>What she's doing</label><input id="s-action" placeholder="sipping iced coffee, glancing back over her shoulder…"></div>
        <div class="field"><label>Setting</label><input id="s-setting" placeholder="a sunlit kitchen / rooftop / her car"></div>
        <div class="field"><label>Mood / expression</label><input id="s-mood" placeholder="soft confident flirty"></div>
        <div class="field span2"><label>Outfit (tasteful)</label><input id="s-outfit" placeholder="oversized knit sweater / fitted gym set — kept covered"></div>
        <div class="field span2"><label>Framing <span class="muted">(optional — blank = face-prominent default)</span></label><input id="s-framing" placeholder="CLOSE waist-up, face large &amp; sharp"></div>
        <div class="field span2"><label>Extra details / styling <span class="muted">(makeup, hair, look a little younger, going-out glam… — for video this styles the start frame)</span></label><input id="s-details" placeholder="natural everyday makeup / going-out glam makeup / look a little younger, fresh-faced"></div>
        <div id="s-img-only" class="field"><label>How many options</label>
          <select id="s-count"><option value="2">2 (recommended)</option><option value="1">1</option><option value="3">3</option></select></div>
      </div>

      <div id="s-vid-only" style="display:none;margin-top:4px">
        <div class="sform">
          <div class="field"><label>Method</label>
            <select id="s-method"><option value="">Auto (recommended)</option><option value="seedance">Seedance (described / held object)</option><option value="motion_control">Motion Control (copy a clip)</option></select></div>
          <div class="field"><label>Duration (s)</label><input id="s-dur" type="number" min="4" max="15" value="8"></div>
          <div class="field"><label>Resolution</label><select id="s-res"><option>720p</option><option>1080p</option></select></div>
          <div class="field span2"><label>Driving video — for Motion Control (TikTok/IG link)</label><input id="s-driving" placeholder="https://vt.tiktok.com/…"></div>
        </div>
        <div class="muted" style="font-size:12px;margin-top:8px">Start frame is generated and <b>shown for approval before any video spend</b>.</div>
      </div>

      <div class="field span2" style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
        <label>📎 Put Candace in this picture (optional)</label>
        <input id="s-ref" type="file" accept="image/png,image/jpeg,image/webp">
        <div class="muted" style="font-size:12px;margin-top:4px">Upload a scene / pose / outfit reference — the worker keeps Candace's face (identity ref) and places her into this look.</div>
        <div id="s-ref-preview"></div>
        <div id="s-carry-note"></div>
        <label style="display:flex;align-items:center;gap:8px;margin-top:12px;text-transform:none;font-weight:600;cursor:pointer;color:var(--text)">
          <input type="checkbox" id="s-modest" style="width:auto"> Fully covered <span class="muted" style="font-weight:400">— clears Higgsfield's NSFW filter (use for swimwear / revealing references)</span></label>
      </div>

      <div class="row" style="margin-top:16px;gap:10px">
        <button id="s-submit" class="btn primary">Queue generation</button>
        <button id="s-preview" class="btn">Preview compliant prompt</button>
      </div>
    </div>

    <div class="panel" id="s-preview-panel" hidden>
      <h3>Compliant prompt preview</h3>
      <div id="s-preview-box"></div>
    </div>

    <div class="panel">
      <div class="row between"><h3 style="margin:0"><span class="live-dot"></span>Generation queue</h3>
        <div class="row"><button id="s-fire" class="btn primary sm">▶ Run worker now</button><button id="s-refresh" class="btn ghost sm">⟳ refresh</button></div></div>
      <div id="s-queue"><div class="loading">loading…</div></div>
    </div>`;

  const kindSel = $('#s-kind');
  const toggleKind = () => {
    const v = kindSel.value;
    $('#s-vid-only').style.display = v === 'video' ? 'block' : 'none';
    $('#s-img-only').style.display = v === 'video' ? 'none' : 'block';
  };
  kindSel.onchange = toggleKind; toggleKind();

  S_CARRY = { reference_image: null, parent_id: null }; // carried across an "edit & requeue"
  function readBrief() {
    const kind = kindSel.value;
    const brief = {
      kind, shot: $('#s-shot').value, action: $('#s-action').value, setting: $('#s-setting').value,
      outfit: $('#s-outfit').value, light: $('#s-light').value, mood: $('#s-mood').value,
      framing: $('#s-framing').value, details: $('#s-details').value, modest: $('#s-modest').checked,
    };
    if (kind === 'image') brief.count = +$('#s-count').value;
    else {
      brief.video_method = $('#s-method').value || undefined;
      brief.duration = +$('#s-dur').value; brief.resolution = $('#s-res').value;
      const link = $('#s-driving').value.trim();
      if (link) brief.driving_video = { link };
    }
    if ($('#s-ref') && $('#s-ref').files && $('#s-ref').files.length) brief.has_reference = true;
    // reuse a reference image carried from an edit-&-requeue (no re-upload)
    if (S_CARRY.reference_image) { brief.reference_image = S_CARRY.reference_image; brief.has_reference = true; }
    if (S_CARRY.parent_id) brief.parent_id = S_CARRY.parent_id;
    return brief;
  }
  // expose a prefill hook for the queue's "Edit & requeue" buttons
  prefillStudio = (job, opts = {}) => {
    const b = job.brief || {};
    kindSel.value = b.kind === 'video' ? 'video' : 'image'; toggleKind();
    $('#s-shot').value = b.shot || ''; $('#s-action').value = b.action || '';
    $('#s-setting').value = b.setting || ''; $('#s-outfit').value = b.outfit || '';
    $('#s-light').value = b.light || ''; $('#s-mood').value = b.mood || ''; $('#s-framing').value = b.framing || '';
    $('#s-details').value = b.details || '';
    $('#s-modest').checked = opts.modest || !!b.modest;
    S_CARRY = { reference_image: b.reference_image || null, parent_id: job.id };
    $('#s-carry-note').innerHTML = b.reference_image
      ? `<div class="muted" style="font-size:12px;margin-top:6px">↻ reusing the reference picture from #${job.id} (no re-upload needed)</div>` : '';
    $('#s-ref-preview').innerHTML = b.reference_image && b.reference_image.url
      ? `<img src="${esc(b.reference_image.url)}" style="height:90px;border-radius:8px;border:1px solid var(--line);margin-top:8px" onerror="this.style.display='none'">` : '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (opts.submit) { $('#s-submit').click(); return; }
    // open the editable prompt so the user can see/tweak it (esp. reference-only jobs
    // whose brief fields are blank — the prompt is where the substance is)
    doPreview();
    toast(`loaded #${job.id} into the form — edit and re-queue`);
  };
  async function doPreview() {
    $('#s-preview-panel').hidden = false;
    $('#s-preview-box').innerHTML = '<div class="loading">building…</div>';
    try {
      const p = await api(`/accounts/${slug}/gen/preview`, { method: 'POST', body: JSON.stringify(readBrief()) });
      $('#s-preview-box').innerHTML = `
        <div class="row" style="margin-bottom:8px">
          <span class="tag ok">~${p.est_cost_cr} cr</span>
          <span class="muted">${esc(p.cost_basis)}</span>
          ${p.method ? `<span class="tag buyer">${esc(p.method.method)}</span>` : ''}
          ${p.reference_driven ? '<span class="tag stage">📎 reference-driven — recreates your uploaded picture</span>' : ''}
          ${$('#s-modest').checked ? '<span class="tag ok">🧥 fully covered (filter-safe)</span>' : ''}
        </div>
        <textarea id="s-prompt" rows="9">${esc(p.prompt)}</textarea>
        ${p.method ? `<div class="muted" style="font-size:12px;margin-top:4px">method: ${esc(p.method.reason)}</div>` : ''}
        ${p.reworded ? `<div class="warn-banner" style="margin-top:8px;font-size:12px">filter-safe reword applied: ${esc(p.notes.join('; '))}</div>` : ''}`;
    } catch (e) { $('#s-preview-box').innerHTML = errBox(e); }
  }
  $('#s-preview').onclick = doPreview;
  // small thumbnail when a reference image is chosen
  $('#s-ref').onchange = () => {
    const f = $('#s-ref').files[0];
    $('#s-ref-preview').innerHTML = f ? `<img src="${URL.createObjectURL(f)}" style="height:90px;border-radius:8px;border:1px solid var(--line);margin-top:8px">` : '';
  };
  $('#s-submit').onclick = async () => {
    const btn = $('#s-submit'); btn.disabled = true;
    try {
      const brief = readBrief();
      const promptEl = $('#s-prompt'); if (promptEl) brief.prompt = promptEl.value; // honor edits
      const file = $('#s-ref').files[0];
      if (file) {
        const data_base64 = await fileToBase64(file);
        const up = await api(`/accounts/${slug}/upload`, { method: 'POST', body: JSON.stringify({ filename: file.name, data_base64 }) });
        brief.reference_image = { url: up.url, filename: up.filename };
      }
      await api(`/accounts/${slug}/gen`, { method: 'POST', body: JSON.stringify(brief) });
      toast(file ? 'queued with your reference picture' : 'queued — the content worker will pick it up');
      S_CARRY = { reference_image: null, parent_id: null }; $('#s-carry-note').innerHTML = '';
      loadQueue();
    } catch (e) { toast('error: ' + e.message); }
    btn.disabled = false;
  };
  $('#s-refresh').onclick = loadQueue;
  $('#s-fire').onclick = async () => {
    const b = $('#s-fire'); b.disabled = true; const o = b.textContent; b.textContent = 'firing…';
    try { await api('/worker/fire', { method: 'POST', body: '{}' }); toast('worker fired — processing the queue'); }
    catch (e) { toast('error: ' + e.message); }
    setTimeout(() => { b.disabled = false; b.textContent = o; loadQueue(); }, 4000);
  };

  // show current balance from the manifest ledger
  api(`/accounts/${slug}/generations`).then(d => { $('#s-balance').innerHTML = `balance ~<b>${d.balance_now_cr ?? '?'}</b> cr`; }).catch(() => {});

  async function loadQueue() {
    try {
      const d = await api(`/accounts/${slug}/gen`);
      const rows = d.requests || [];
      S_ROWS = rows;
      $('#s-queue').innerHTML = rows.length ? rows.map(r => genRow(r, slug)).join('') : '<div class="muted">nothing queued yet</div>';
      wireQueue(slug);
    } catch (e) { $('#s-queue').innerHTML = errBox(e); }
  }
  loadQueue();
  timers.push(setInterval(loadQueue, 5000)); // auto-refresh; cleared by clearTimers() on nav
}
function genRow(r, slug) {
  const opts = Array.isArray(r.options) ? r.options : [];
  const optsHtml = (r.status === 'awaiting_approval' && opts.length) ? `
    <div class="row" style="gap:10px;margin-top:8px">${opts.map(o => `
      <div style="text-align:center">
        <img src="${esc(o.url)}" style="width:120px;height:200px;object-fit:cover;border-radius:8px;border:1px solid var(--line);cursor:zoom-in" alt="" onclick="openLightbox('${esc(o.url)}',false)">
        <div><button class="btn primary sm" data-approve="${r.id}" data-job="${esc(o.job_id)}">approve</button></div>
      </div>`).join('')}</div>` : '';
  const refImg = r.brief && r.brief.reference_image && r.brief.reference_image.url
    ? `<img src="${esc(r.brief.reference_image.url)}" title="your reference picture" style="height:46px;border-radius:6px;border:1px solid var(--line);cursor:zoom-in" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'tag',textContent:'📎 ref'}))" onclick="openLightbox('${esc(r.brief.reference_image.url)}',false)">` : '';
  const logArr = Array.isArray(r.log) ? r.log : [];
  const logHtml = logArr.length ? `<details class="prompt" style="margin-top:8px"><summary>worker activity (${logArr.length})</summary>
    <div style="margin-top:6px">${logArr.slice(-12).map(l => `<div class="mono" style="font-size:12px"><span class="dim">${fmtClock(l.ts)}</span> <b>${esc(l.stage || '')}</b> ${esc(l.msg || '')}</div>`).join('')}</div></details>` : '';
  const result = r.result && r.result.file ? `<a href="/content/${encodeURIComponent(slug)}/generations/${encodeURIComponent(r.result.file)}" target="_blank">view asset ↗</a>` : '';
  const isNsfw = ((r.error || '') + ' ' + logArr.map(l => l.msg || '').join(' ')).toLowerCase().includes('nsfw');
  const recoverable = ['failed', 'rejected', 'canceled'].includes(r.status);
  return `<div class="panel" style="box-shadow:none;border-radius:9px;margin:10px 0">
    <div class="row between">
      <div class="row"><span class="tag ${STATUS_TAG[r.status] || ''}">${esc(r.status)}</span>
        <span class="tag">${esc(r.kind)}${r.video_method ? ' · ' + esc(r.video_method) : ''}</span>
        ${refImg}
        <span class="muted">#${r.id} · ~${r.est_cost_cr ?? '?'} cr · ${fmtDateTime(r.created_at)}</span></div>
      <div class="row">${result}
        ${r.status === 'failed' && isNsfw ? `<button class="btn primary sm" data-requeue-modest="${r.id}">Requeue (modest)</button>` : ''}
        ${recoverable ? `<button class="btn sm" data-requeue="${r.id}">↻ Edit &amp; requeue</button>` : ''}
        ${['queued','awaiting_approval','generating'].includes(r.status) ? `<button class="btn ghost sm" data-cancel="${r.id}">cancel</button>` : ''}
        ${r.status === 'awaiting_approval' ? `<button class="btn ghost sm" data-reject="${r.id}">reject all</button>` : ''}
      </div>
    </div>
    <details class="prompt" style="margin-top:8px"><summary>prompt</summary><p>${esc(r.prompt || '')}</p></details>
    ${logHtml}
    ${optsHtml}
    ${r.error ? `<div class="warn-banner" style="margin-top:8px">${esc(r.error)}</div>` : ''}
  </div>`;
}
function wireQueue(slug) {
  const post = (path, body) => api(`/accounts/${slug}/gen/${path}`, { method: 'POST', body: JSON.stringify(body || {}) });
  view.querySelectorAll('[data-approve]').forEach(b => b.onclick = async () => {
    try { await post(`${b.dataset.approve}/approve`, { job_id: b.dataset.job }); toast('approved — worker will finish it'); studio(slug); }
    catch (e) { toast('error: ' + e.message); }
  });
  view.querySelectorAll('[data-reject]').forEach(b => b.onclick = async () => {
    try { await post(`${b.dataset.reject}/reject`); toast('rejected'); studio(slug); } catch (e) { toast('error: ' + e.message); }
  });
  view.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
    try { await post(`${b.dataset.cancel}/cancel`); toast('canceled'); studio(slug); } catch (e) { toast('error: ' + e.message); }
  });
  view.querySelectorAll('[data-requeue]').forEach(b => b.onclick = () => {
    const job = S_ROWS.find(r => String(r.id) === b.dataset.requeue);
    if (job && prefillStudio) prefillStudio(job, { modest: false });
  });
  view.querySelectorAll('[data-requeue-modest]').forEach(b => b.onclick = () => {
    const job = S_ROWS.find(r => String(r.id) === b.dataset.requeueModest);
    if (job && prefillStudio) prefillStudio(job, { modest: true, submit: true });
  });
}

// ---------------- GENERATIONS ----------------
let G = { items: [], fType: 'all', fBatch: 'all', fModel: 'all', q: '', sort: 'new' };
async function generations(slug) {
  loading();
  let d; try { d = await api('/accounts/' + slug + '/generations'); } catch (e) { view.innerHTML = errBox(e); return; }
  G = { items: d.items || [], fType: 'all', fBatch: 'all', fModel: 'all', q: '', sort: 'new', slug };
  const batches = [...new Set(G.items.map(i => i.batch))].sort();
  const models = [...new Set(G.items.map(i => i.model))].sort();
  view.innerHTML = `
    <div class="kpis">
      <div class="kpi accent"><b>${d.count ?? G.items.length}</b><span>Assets</span></div>
      <div class="kpi"><b>${d.net_spent_cr ?? 0} cr</b><span>Net spent</span></div>
      <div class="kpi"><b>${d.archived_cost_cr ?? 0} cr</b><span>Archived cost</span></div>
      <div class="kpi"><b>${esc(d.total_size_human || '')}</b><span>Total size</span></div>
      <div class="kpi"><b>${G.items.filter(i => i.type === 'image').length}</b><span>Photos</span></div>
      <div class="kpi"><b>${G.items.filter(i => i.type === 'video').length}</b><span>Videos</span></div>
    </div>
    <div class="panel">
      <div class="row" style="margin-bottom:10px">
        <input type="search" id="g-q" placeholder="search filename, prompt, model, job id…">
        <select id="g-sort"><option value="new">Newest</option><option value="old">Oldest</option><option value="costhi">Cost high</option><option value="costlo">Cost low</option></select>
        <select id="g-model"><option value="all">All models</option>${models.map(m => `<option>${esc(m)}</option>`).join('')}</select>
      </div>
      <div class="row" id="g-chips">
        <span class="chip active" data-k="type" data-v="all">All</span>
        <span class="chip" data-k="type" data-v="image">Photos</span>
        <span class="chip" data-k="type" data-v="video">Videos</span>
        <span style="width:10px"></span>
        ${batches.map(b => `<span class="chip" data-k="batch" data-v="${esc(b)}">${esc(b)}</span>`).join('')}
      </div>
    </div>
    <div class="gal" id="g-grid"></div>`;
  $('#g-q').oninput = e => { G.q = e.target.value.toLowerCase(); gRender(); };
  $('#g-sort').onchange = e => { G.sort = e.target.value; gRender(); };
  $('#g-model').onchange = e => { G.fModel = e.target.value; gRender(); };
  $('#g-chips').querySelectorAll('.chip').forEach(c => c.onclick = () => {
    const k = c.dataset.k, v = c.dataset.v;
    if (k === 'type') G.fType = v; else G.fBatch = (G.fBatch === v ? 'all' : v);
    $('#g-chips').querySelectorAll('.chip[data-k="type"]').forEach(x => x.classList.toggle('active', x.dataset.v === G.fType));
    $('#g-chips').querySelectorAll('.chip[data-k="batch"]').forEach(x => x.classList.toggle('active', x.dataset.v === G.fBatch));
    gRender();
  });
  gRender();
}
function gRender() {
  let items = G.items.slice();
  items.sort((a, b) => {
    if (G.sort === 'costhi') return (b.cost_cr || 0) - (a.cost_cr || 0);
    if (G.sort === 'costlo') return (a.cost_cr || 0) - (b.cost_cr || 0);
    const c = (b.generated_at || '').localeCompare(a.generated_at || '');
    return G.sort === 'old' ? -c : c;
  });
  items = items.filter(i => (G.fType === 'all' || i.type === G.fType) && (G.fBatch === 'all' || i.batch === G.fBatch) && (G.fModel === 'all' || i.model === G.fModel));
  if (G.q) items = items.filter(i => (i.file + ' ' + i.prompt + ' ' + i.model + ' ' + i.job_id + ' ' + i.notes).toLowerCase().includes(G.q));
  $('#g-grid').innerHTML = items.map(i => gCard(i, G.slug)).join('') || '<div class="muted">no matches</div>';
}
function gCard(i, slug) {
  const url = `/content/${encodeURIComponent(slug)}/generations/${encodeURIComponent(i.file)}`;
  const media = i.type === 'video'
    ? `<video src="${url}#t=0.5" preload="metadata" controls playsinline></video>`
    : `<img loading="lazy" src="${url}" alt="${esc(i.file)}" style="cursor:zoom-in" onclick="openLightbox('${url}',false)">`;
  return `<div class="gcard">
    <div class="gmedia">${media}</div>
    <div class="gbody">
      <div class="row"><span class="tag ${i.type === 'video' ? 'buyer' : 'stage'}">${esc(i.type)}</span><span class="tag">${esc(i.batch)}</span>${i.notes ? `<span class="tag">${esc(i.notes)}</span>` : ''}</div>
      <div class="fn">${esc(i.file)}</div>
      <div class="gmeta"><span>Cost</span><b>${i.cost_cr == null ? '—' : i.cost_cr + ' cr'}</b>
        <span>Size</span><b>${esc(i.size_human)}</b>
        <span>Model</span><b>${esc(i.model)}</b>
        <span>Job</span><b>${esc(i.job_id || '—')}<button class="copybtn" onclick="copy('${esc(i.job_id)}')">copy</button></b></div>
      ${i.prompt ? `<details class="prompt"><summary>Prompt</summary><p>${esc(i.prompt)}</p></details>` : ''}
      <a class="btn sm" href="${url}" download>⬇ Download</a>
    </div></div>`;
}

// ---------------- POSTS ----------------
async function posts(slug) {
  loading();
  let d; try { d = await api('/accounts/' + slug + '/posts'); } catch (e) { view.innerHTML = errBox(e); return; }
  const list = (d.posts || []).slice().reverse();
  view.innerHTML = `<div class="panel"><h3>Posting log — ${esc(d.profile || slug)} · ${list.length} posts</h3></div>
    ${list.map(p => postCard(p, slug)).join('') || '<div class="muted">no posts logged</div>'}`;
}
function postCard(p, slug) {
  const url = `/content/${encodeURIComponent(slug)}/posted/${encodeURIComponent(p.file)}`;
  const ok = p.upload && p.upload.success;
  const status = p.posted_at_utc ? `<span class="tag ok">posted</span>` : (p.upload ? (ok ? '<span class="tag ok">uploaded</span>' : '<span class="tag bad">failed</span>') : '<span class="tag pend">pending</span>');
  return `<div class="post">
    <div class="thumb"><img loading="lazy" src="${url}" alt=""></div>
    <div class="pbody">
      <div class="row between"><div class="row"><b>#${esc(p.id)}</b> ${status} <span class="dim">${esc(p.media_type || '')} ${esc(p.dimensions || '')}</span></div>
        <span class="dim">${fmtDateTime(p.posted_at_utc)}</span></div>
      <div class="cap">${esc(p.caption || '')}</div>
      ${p.hashtags && p.hashtags.length ? `<div class="hash">${esc((p.hashtags || []).join(' '))}</div>` : ''}
      <div class="row" style="margin-top:7px">${p.post_url ? `<a class="btn sm" href="${esc(p.post_url)}" target="_blank">view post ↗</a>` : ''}
        ${p.location_tag ? `<span class="dim">📍 ${esc(p.location_tag)}</span>` : ''}</div>
    </div></div>`;
}

// ---------------- FANS ----------------
let F = { rows: [], stage: 'all', buyer: 'all', source: 'all', q: '', sort: { key: 'last_seen', dir: 'desc' } };
async function fansForIdentity(key) {
  loading();
  const members = membersOf(key);
  let merged = [];
  try {
    const res = await Promise.all(members.map(m => api('/accounts/' + m.slug + '/fans')
      .then(d => (d.fans || []).map(f => ({ ...f, _slug: m.slug }))).catch(() => [])));
    merged = res.flat();
  } catch (e) { view.innerHTML = errBox(e); return; }
  F = { rows: merged, stage: 'all', buyer: 'all', source: 'all', q: '', sort: { key: 'last_seen', dir: 'desc' }, key };
  const stages = [...new Set(F.rows.map(r => r.stage).filter(Boolean))];
  const buyers = [...new Set(F.rows.map(r => r.buyer_type).filter(Boolean))];
  // sources Candace will integrate (always show all three, even if 0 fans yet)
  const SOURCES = ['instagram', 'tiktok', 'telegram'];
  const counts = {}; F.rows.forEach(r => { const p = (r.platform || 'tiktok').toLowerCase(); counts[p] = (counts[p] || 0) + 1; });
  view.innerHTML = `
    <div class="panel">
      <div class="row" style="margin-bottom:8px"><input type="search" id="f-q" placeholder="search fans…">
        <select id="f-source"><option value="all">All sources</option>${SOURCES.map(s => `<option value="${s}">${sourceLabel(s)} (${counts[s] || 0})</option>`).join('')}</select>
        <select id="f-stage"><option value="all">All stages</option>${stages.map(s => `<option>${esc(s)}</option>`).join('')}</select>
        <select id="f-buyer"><option value="all">All buyer types</option>${buyers.map(b => `<option>${esc(b)}</option>`).join('')}</select>
        <span class="dim" id="f-count">${F.rows.length} fans</span></div>
      <div class="row" style="gap:8px" id="f-pills">
        <span class="tag src-pill" data-source="all">All: <b>${F.rows.length}</b></span>
        ${SOURCES.map(s => `<span class="tag src-pill" data-source="${s}">${sourceLabel(s)}: <b>${counts[s] || 0}</b></span>`).join('')}
      </div>
    </div>
    <div class="panel"><table id="f-table"></table></div>`;
  $('#f-q').oninput = e => { F.q = e.target.value.toLowerCase(); fBody(); };
  $('#f-source').onchange = e => { F.source = e.target.value; fBody(); };
  $('#f-stage').onchange = e => { F.stage = e.target.value; fBody(); };
  $('#f-buyer').onchange = e => { F.buyer = e.target.value; fBody(); };
  // clickable source pills — filter, and stay in sync with the dropdown
  view.querySelectorAll('.src-pill').forEach(el => el.onclick = () => {
    F.source = el.dataset.source;
    const sel = $('#f-source'); if (sel) sel.value = F.source;
    fBody();
  });
  fBody();
}
function sortArrow(key) { return F.sort.key === key ? (F.sort.dir === 'asc' ? ' ▲' : ' ▼') : ' <span class="dim">↕</span>'; }
function sourceLabel(p) { return ({ instagram: '📸 Instagram', tiktok: '🎵 TikTok', telegram: '✈️ Telegram' }[p] || p); }
function sourceBadge(p) {
  const key = (p || 'tiktok').toLowerCase();
  const cls = { instagram: 'bad', tiktok: 'buyer', telegram: 'stage' }[key] || '';
  return `<span class="tag ${cls}">${sourceLabel(key)}</span>`;
}
function fBody() {
  // keep the source pills + count in sync with the active filter
  document.querySelectorAll('#f-pills .src-pill').forEach(el =>
    el.classList.toggle('active', (el.dataset.source || 'all') === F.source));
  let rows = F.rows.filter(r => (F.stage === 'all' || r.stage === F.stage) && (F.buyer === 'all' || r.buyer_type === F.buyer)
    && (F.source === 'all' || (r.platform || 'tiktok').toLowerCase() === F.source));
  if (F.q) rows = rows.filter(r => (r.username + ' ' + (r.display_name || '') + ' ' + (r.first_name || '') + ' ' + (r.last_name || '') + ' ' + (r.email || '') + ' ' + (r.summary || '') + ' ' + (r.platform || '')).toLowerCase().includes(F.q));
  // sort (time for last_seen, numeric for intent/msgs)
  const dir = F.sort.dir === 'asc' ? 1 : -1;
  const sv = (r) => {
    if (F.sort.key === 'last_seen') return r.last_seen ? new Date(r.last_seen).getTime() : 0;
    const v = r[F.sort.key]; return (v == null || v === '') ? -Infinity : v;
  };
  rows = rows.slice().sort((a, b) => { const av = sv(a), bv = sv(b); return av < bv ? -dir : av > bv ? dir : 0; });
  const cnt = $('#f-count'); if (cnt) cnt.textContent = `${rows.length} fans`;
  const body = rows.map(r => {
    const sc = r.intent_score == null ? '' : `<div class="ibar"><i style="width:${Math.min(100, r.intent_score)}%"></i></div> <span class="mono">${r.intent_score}</span>`;
    return `<tr data-id="${r.id}" data-slug="${esc(r._slug || '')}">
      <td><b>${esc(r.username)}</b>${r.person_id ? ' <span title="linked across platforms">🔗</span>' : ''}${r.display_name ? `<div class="dim">${esc(r.display_name)}</div>` : ''}</td>
      <td>${sourceBadge(r.platform)}</td>
      <td>${r.stage ? `<span class="tag stage">${esc(r.stage)}</span>` : '—'}</td>
      <td>${r.buyer_type ? `<span class="tag buyer">${esc(r.buyer_type)}</span>` : '—'}</td>
      <td>${sc}</td><td class="mono">${r.msg_count}</td><td class="dim">${fmtDateTime(r.last_seen)}</td>
      <td class="truncate dim">${esc(r.summary || '')}</td></tr>`;
  }).join('') || '<tr><td colspan="8" class="muted">no fans</td></tr>';
  const tbl = $('#f-table');
  tbl.innerHTML = `<thead><tr>
      <th>Fan</th><th>Source</th><th>Stage</th><th>Buyer</th>
      <th class="sortable" data-sort="intent_score">Intent${sortArrow('intent_score')}</th>
      <th class="sortable" data-sort="msg_count">Msgs${sortArrow('msg_count')}</th>
      <th class="sortable" data-sort="last_seen">Last seen${sortArrow('last_seen')}</th>
      <th>Summary</th></tr></thead><tbody>${body}</tbody>`;
  tbl.querySelectorAll('th.sortable').forEach(th => th.onclick = () => {
    const k = th.dataset.sort;
    if (F.sort.key === k) F.sort.dir = F.sort.dir === 'asc' ? 'desc' : 'asc';
    else F.sort = { key: k, dir: 'desc' };
    fBody();
  });
  tbl.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => location.hash = `#/a/${F.key}/fans/${tr.dataset.slug}.${tr.dataset.id}`);
}

function contactPanel(f) {
  const name = [f.first_name, f.last_name].filter(Boolean).join(' ');
  const rows = [
    ['Source', sourceLabel((f.platform || 'tiktok').toLowerCase())],
    ['Name', name],
    ['Email', f.email],
    ['Phone', f.phone],
    ['Subscribed', f.subscribed_at],
    ['ManyChat id', f.manychat_id],
  ].filter(([, v]) => v);
  if (rows.length <= 1) return ''; // nothing beyond source → skip the panel
  return `<div class="panel"><h3>Contact</h3>
    <div class="meta" style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13.5px">
      ${rows.map(([k, v]) => `<span class="dim">${esc(k)}</span><b>${k === 'Source' ? v : esc(v)}</b>`).join('')}
    </div></div>`;
}
async function fanDetail(slug, id) {
  loading();
  setActive(identityKeyForSlug(slug), 'fans');
  let f, m, links;
  try { [f, m, links] = await Promise.all([
    api(`/accounts/${slug}/fans/${id}`),
    api(`/accounts/${slug}/fans/${id}/messages`),
    api(`/accounts/${slug}/fans/${id}/links`).catch(() => ({ linked: [], person_id: null })),
  ]); }
  catch (e) { view.innerHTML = errBox(e); return; }
  const md = f.metadata || {};
  const signals = (md.signals || []).map(s => `<span class="tag">${esc(s)}</span>`).join(' ');
  view.innerHTML = `
    <div class="row between" style="margin-bottom:14px">
      <div><a href="#/a/${identityKeyForSlug(slug)}/fans">← all fans</a> <b style="font-size:17px;margin-left:8px">${esc(f.username)}</b> <span class="dim">${esc(f.display_name || '')}</span></div>
      <button id="reengage" class="btn sm primary" title="Send a fresh opener to restart the conversation">↻ Re-engage</button>
    </div>
    <div class="grid2">
      <div class="panel"><h3>Conversation (${(m.messages || []).length})</h3>
        <div class="chat" id="chat">${(m.messages || []).map(x => `<div class="bubble ${x.role === 'assistant' ? 'assistant' : 'user'}">${esc(x.content)}<span class="ts">${fmtClock(x.created_at)}</span></div>`).join('')}</div>
        ${f.next_directive ? `<div class="dnote next" id="ndir-cur">⏭ next reply: ${esc(f.next_directive)} <button id="ndir-clear" class="btn sm" title="Cancel the one-shot">clear</button></div>` : ''}
        ${f.director_note ? `<div class="dnote" id="dnote-cur">🎬 standing note: ${esc(f.director_note)} <button id="dnote-clear" class="btn sm" title="Clear the standing steer">clear</button></div>` : ''}
        <div class="composer">
          <textarea id="steer-text" rows="2" placeholder="type here — 'Next reply' = one-off task for her next message · 'Standing note' = ongoing tone/behavior · 'Send as Candace' = message him now"></textarea>
          <div class="row" style="gap:8px;margin-top:6px">
            <button id="steer-next" class="btn sm" title="One-off instruction applied to her NEXT reply only, then it clears itself (e.g. 'ask him what the time is')">⏭ Next reply</button>
            <button id="steer-note" class="btn sm" title="Ongoing hidden steer applied to every reply until cleared (e.g. 'stop funneling, be warmer')">🎬 Standing note</button>
            <button id="steer-send" class="btn sm primary" title="Send this to him now as Candace (logged as her message)">➤ Send as Candace</button>
          </div>
        </div>
      </div>
      <div>
        ${contactPanel(f)}
        <div class="panel"><h3>Funnel</h3>
          <div class="field"><label>Stage</label><input id="d-stage" value="${esc(f.stage || '')}"></div>
          <div class="field"><label>Buyer type</label><input id="d-buyer" value="${esc(f.buyer_type || '')}"></div>
          <button id="d-save" class="btn primary sm">Save funnel</button>
          <div class="row" style="margin-top:12px">
            <span class="tag">intent ${md.intent_score ?? '—'}</span>
            <span class="tag">${esc(md.temperature || '')}</span>
            <span class="tag">msgs ${f.msg_count}</span></div>
        </div>
        ${trollFanPanel(md)}
        <div class="panel"><h3>Memory</h3>
          <div class="field"><label>Summary</label><div class="doc-md">${esc(f.summary || '—')}</div></div>
          ${md.technique ? `<div class="field"><label>Technique</label><div>${esc(md.technique)}</div></div>` : ''}
          ${md.next_move ? `<div class="field"><label>Next move</label><div>${esc(md.next_move)}</div></div>` : ''}
          ${signals ? `<div class="field"><label>Signals</label><div class="row">${signals}</div></div>` : ''}
        </div>
        ${profilePanel(f)}
        ${linkPanel(slug, f, links)}
      </div>
    </div>`;
  const chat = $('#chat'); if (chat) chat.scrollTop = chat.scrollHeight;
  const steerNext = $('#steer-next');
  if (steerNext) steerNext.onclick = async () => {
    const text = ($('#steer-text').value || '').trim();
    if (!text) { toast('type a task first'); return; }
    steerNext.disabled = true;
    try { await api(`/accounts/${slug}/fans/${id}`, { method: 'PATCH', body: JSON.stringify({ next_directive: text }) }); toast('queued for her next reply (one-off)'); fanDetail(slug, id); }
    catch (e) { toast('error: ' + e.message); steerNext.disabled = false; }
  };
  const steerNote = $('#steer-note');
  if (steerNote) steerNote.onclick = async () => {
    const text = ($('#steer-text').value || '').trim();
    if (!text) { toast('type a note first'); return; }
    steerNote.disabled = true;
    try { await api(`/accounts/${slug}/fans/${id}`, { method: 'PATCH', body: JSON.stringify({ director_note: text }) }); toast('standing note set — steers every reply until cleared'); fanDetail(slug, id); }
    catch (e) { toast('error: ' + e.message); steerNote.disabled = false; }
  };
  const steerSend = $('#steer-send');
  if (steerSend) steerSend.onclick = async () => {
    const text = ($('#steer-text').value || '').trim();
    if (!text) { toast('type a message first'); return; }
    if (!confirm('Send this to him now, as Candace?\n\n' + text)) return;
    steerSend.disabled = true;
    try { await api(`/accounts/${slug}/fans/${id}/send`, { method: 'POST', body: JSON.stringify({ text }) }); toast('sent as Candace'); setTimeout(() => fanDetail(slug, id), 800); }
    catch (e) { toast('error: ' + e.message); steerSend.disabled = false; }
  };
  const ndirClear = $('#ndir-clear');
  if (ndirClear) ndirClear.onclick = async () => {
    try { await api(`/accounts/${slug}/fans/${id}`, { method: 'PATCH', body: JSON.stringify({ next_directive: '' }) }); toast('one-off cleared'); fanDetail(slug, id); }
    catch (e) { toast('error: ' + e.message); }
  };
  const dnoteClear = $('#dnote-clear');
  if (dnoteClear) dnoteClear.onclick = async () => {
    try { await api(`/accounts/${slug}/fans/${id}`, { method: 'PATCH', body: JSON.stringify({ director_note: '' }) }); toast('note cleared'); fanDetail(slug, id); }
    catch (e) { toast('error: ' + e.message); }
  };
  $('#d-save').onclick = async () => {
    try { await api(`/accounts/${slug}/fans/${id}`, { method: 'PATCH', body: JSON.stringify({ stage: $('#d-stage').value, buyer_type: $('#d-buyer').value }) }); toast('funnel updated'); }
    catch (e) { toast('error: ' + e.message); }
  };
  const psave = $('#p-save');
  if (psave) psave.onclick = async () => {
    const profile = {};
    document.querySelectorAll('#profile-panel [data-pkey]').forEach(el => {
      const k = el.getAttribute('data-pkey'); const v = el.value.trim();
      if (!v) return;
      profile[k] = (k === 'interests') ? v.split(',').map(s => s.trim()).filter(Boolean) : v;
    });
    psave.disabled = true;
    try { await api(`/accounts/${slug}/fans/${id}`, { method: 'PATCH', body: JSON.stringify({ profile }) }); toast('profile saved'); }
    catch (e) { toast('error: ' + e.message); }
    psave.disabled = false;
  };
  wireLinks(slug, id);
  const rb = $('#reengage');
  if (rb) rb.onclick = async () => {
    if (!confirm(`Send a fresh re-engagement message to ${f.username} now?`)) return;
    rb.disabled = true; rb.textContent = 'sending…';
    try {
      await api(`/accounts/${slug}/fans/${id}/reengage`, { method: 'POST' });
      toast('re-engage sent — her message will appear in the conversation shortly');
      setTimeout(() => { if (location.hash.includes(`/fans/${slug}.${id}`)) fanDetail(slug, id); }, 9000);
    } catch (e) { toast('error: ' + e.message); }
    rb.disabled = false; rb.textContent = '↻ Re-engage';
  };
}

// troll / zero-intent read for this fan (persisted by the profiler each turn)
function trollFanPanel(md) {
  md = md || {};
  const score = (typeof md.troll_score === 'number') ? md.troll_score : null;
  const mode = md.troll_mode || null;
  const stall = (typeof md.stall_hits === 'number') ? md.stall_hits : null;
  if (score == null && mode == null && stall == null) return '';
  const col = score == null ? 'var(--line)' : score >= 85 ? '#ff5c5c' : score >= 60 ? '#ff9f43' : score >= 30 ? '#ffcc66' : '#3ddc84';
  const modeTag = mode ? `<span class="tag" style="background:${mode==='ghost'?'#3a0a0a':mode==='minimal'?'#3a1e00':mode==='cool'?'#2a2a00':'#0a2a1a'}">${esc(mode)}</span>` : '';
  return `<div class="panel"><h3>Troll / zero-intent ${md.troll_shadow ? '<span class="tag" style="background:#5a4a00;color:#ffcc66">shadow</span>' : ''}</h3>
    <div class="row" style="align-items:center;gap:10px;margin-top:4px">
      <div class="ibar wide"><i style="width:${score==null?0:Math.min(100,score)}%;background:${col}"></i></div>
      <span class="mono">${score==null?'—':score}</span></div>
    <div class="row" style="margin-top:10px;gap:8px">
      <span class="tag">mode ${modeTag || '—'}</span>
      <span class="tag">stalls ${stall==null?'—':stall}</span></div>
    <div class="muted" style="font-size:11px;margin-top:8px">${md.troll_shadow ? 'shadow mode: scored + logged, not changing replies yet.' : 'live: cool → minimal (delay) → ghost (no reply) as this climbs.'} 0–29 engage · 30–59 cool · 60–84 minimal · 85+ ghost.</div>
  </div>`;
}
// structured profile the profiler accumulates (occupation, location, age…).
// merged cross-platform, injected back into her replies. editable here.
function profilePanel(f) {
  const p = (f.profile && typeof f.profile === 'object' && !Array.isArray(f.profile)) ? f.profile : {};
  const FIELDS = [
    ['name', 'Name'], ['age', 'Age'], ['location', 'Location'],
    ['occupation', 'Occupation'], ['relationship', 'Relationship'], ['interests', 'Interests'],
    ['guessed_salary', 'Guessed salary'],
  ];
  const HINT = { interests: '(comma-separated)', guessed_salary: '(inferred estimate — never shown to Candace)' };
  const known = FIELDS.map(k => k[0]);
  const val = k => { const v = p[k]; return Array.isArray(v) ? v.join(', ') : (v == null ? '' : String(v)); };
  const rows = FIELDS.map(([k, lbl]) =>
    `<div class="field"><label>${lbl}${HINT[k] ? ` <span class="dim">${HINT[k]}</span>` : ''}</label>` +
    `<input data-pkey="${k}" value="${esc(val(k))}" placeholder="—"></div>`).join('');
  // any extra keys the model captured that aren't in the standard set
  const extra = Object.keys(p).filter(k => known.indexOf(k) === -1)
    .map(k => `<div class="field"><label>${esc(k)}</label><input data-pkey="${esc(k)}" value="${esc(val(k))}"></div>`).join('');
  const filled = known.some(k => val(k)) || Object.keys(p).length;
  // fixed identity fields straight from the platform/flow (not editable, not AI-learned)
  const dispName = (f.display_name && f.display_name !== 'him') ? f.display_name : '—';
  const fixedRows =
    `<div class="field"><label>Handle <span class="dim">(from platform)</span></label><div class="doc-md">@${esc(f.username || '')}</div></div>` +
    `<div class="field"><label>Display name <span class="dim">(from platform)</span></label><div class="doc-md">${esc(dispName)}</div></div>`;
  return `<div class="panel" id="profile-panel"><h3>Profile <span class="dim">${filled ? '' : '· nothing learned yet'}</span></h3>
    ${fixedRows}
    <div class="muted" style="margin:10px 0 8px;font-size:12px">structured facts Candace has learned about him (auto-filled by the profiler across TikTok + Telegram, and referenced in her replies). edit to correct.</div>
    ${rows}${extra}
    <button id="p-save" class="btn primary sm" style="margin-top:8px">Save profile</button>
  </div>`;
}

// cross-platform identity panel — shows linked profiles (click through to them)
// and a search to link this fan to the same person on another platform.
function linkPanel(slug, f, links) {
  const linked = (links && links.linked) || [];
  const pid = links && links.person_id;
  const chips = linked.length
    ? linked.map(l => {
        const bslug = (l.bots && l.bots.slug) || slug;
        return `<a class="tag" style="text-decoration:none" href="#/a/${identityKeyForSlug(bslug)}/fans/${bslug}.${l.id}">${esc(sourceLabel((l.platform || '').toLowerCase()))} @${esc(l.username)}${l.display_name ? ` · ${esc(l.display_name)}` : ''}</a>`;
      }).join(' ')
    : '<span class="dim">not linked to anyone yet</span>';
  return `<div class="panel"><h3>Cross-platform identity${pid ? ` · person #${pid}` : ''}</h3>
    <div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:10px">${chips}</div>
    ${linked.length ? `<button id="lnk-unlink" class="btn sm">Unlink this profile</button>` : ''}
    <div class="field" style="margin-top:12px"><label>Link to the same person on another platform</label>
      <input type="search" id="lnk-q" placeholder="search every account by name or @handle…"></div>
    <div id="lnk-results" style="display:flex;flex-direction:column;gap:6px"></div>
  </div>`;
}
function wireLinks(slug, id) {
  const un = $('#lnk-unlink');
  if (un) un.onclick = async () => {
    if (!confirm('Unlink this profile from its shared identity? Their memory stops being shared.')) return;
    try { await api(`/accounts/${slug}/fans/${id}/unlink`, { method: 'POST' }); toast('unlinked'); fanDetail(slug, id); }
    catch (e) { toast('error: ' + e.message); }
  };
  const q = $('#lnk-q'), out = $('#lnk-results');
  if (!q) return;
  let t;
  q.oninput = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const term = q.value.trim();
      if (term.length < 1) { out.innerHTML = ''; return; }
      let d;
      try { d = await api(`/fan-search?q=${encodeURIComponent(term)}&exclude_fan=${id}`); }
      catch (e) { out.innerHTML = `<div class="dim">${esc(e.message)}</div>`; return; }
      const rows = d.results || [];
      out.innerHTML = rows.length ? rows.map(r => {
        const note = r.person_id ? ` <span class="dim">(person #${r.person_id})</span>` : '';
        return `<div class="row between" style="border:1px solid var(--line,#26262e);border-radius:8px;padding:6px 10px">
          <span>${esc(sourceLabel((r.platform || '').toLowerCase()))} <b>@${esc(r.username)}</b>${r.display_name ? ` <span class="dim">${esc(r.display_name)}</span>` : ''}${note}</span>
          <button class="btn sm primary" data-link="${r.id}">Link</button></div>`;
      }).join('') : '<div class="dim">no matches</div>';
      out.querySelectorAll('button[data-link]').forEach(b => b.onclick = async () => {
        b.disabled = true; b.textContent = 'linking…';
        try { await api(`/accounts/${slug}/fans/${id}/link`, { method: 'POST', body: JSON.stringify({ other_fan_id: Number(b.dataset.link) }) }); toast('linked — memory now shared'); fanDetail(slug, id); }
        catch (e) { toast('error: ' + e.message); b.disabled = false; b.textContent = 'Link'; }
      });
    }, 250);
  };
}

// ---------------- QUEUE ----------------
let Q = [];
let Q_FIRED = new Set(); // event_ids the user hit "send now" on (optimistic, until server confirms)
let QP = 'all';          // queue platform filter
async function queueForIdentity(key) {
  loading();
  Q_FIRED = new Set(); QP = 'all';
  const members = membersOf(key);
  const plats = [...new Set(members.map(botPlatform))];
  view.innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div><span class="live-dot"></span><b>Live message queue</b> <span class="dim">— incoming DMs, the delay she picked, and when they send</span></div>
      <div class="row" style="gap:8px">
        ${plats.length > 1 ? `<select id="q-plat"><option value="all">All platforms</option>${plats.map(p => `<option value="${p}">${sourceLabel(p)}</option>`).join('')}</select>` : ''}
        <span class="pill b-wait">waiting <b id="q-w">0</b></span><span class="pill b-sent">sent <b id="q-s">0</b></span><span class="pill b-super">debounced <b id="q-x">0</b></span></div>
    </div>
    <div class="panel"><table><thead><tr><th>Queued</th><th>Platform</th><th>User</th><th>Incoming</th><th>Delay</th><th>Status</th><th>Sends in / reply</th></tr></thead>
    <tbody id="q-body"><tr><td colspan="7" class="loading">loading…</td></tr></tbody></table></div>`;
  const sel = $('#q-plat'); if (sel) sel.onchange = e => { QP = e.target.value; qRender(key); };
  async function poll() {
    try {
      const res = await Promise.all(members.map(m => api('/accounts/' + m.slug + '/queue')
        .then(d => (d.rows || []).map(r => ({ ...r, _slug: m.slug, _platform: botPlatform(m) }))).catch(() => [])));
      Q = res.flat().sort((a, b) => new Date(b.queued_at) - new Date(a.queued_at));
      qRender(key);
    } catch (e) { $('#q-body').innerHTML = `<tr><td colspan="7" class="err-banner">${esc(e.message)}</td></tr>`; }
  }
  await poll();
  timers.push(setInterval(poll, 3000));
  timers.push(setInterval(() => qRender(key), 1000));
}
function qRender(key) {
  if (!$('#q-body')) return;
  const now = Date.now(); let cw = 0, cs = 0, cx = 0;
  const rows = Q.filter(r => QP === 'all' || r._platform === QP);
  const html = rows.map(r => {
    let badge, last;
    const eid = String(r.event_id);
    if (r.status === 'sent') { cs++; Q_FIRED.delete(eid); badge = '<span class="tag b-sent">sent</span>'; last = `<span class="dim" style="font-style:italic">${esc(r.reply || '')}</span>`; }
    else if (r.status === 'superseded') { cx++; Q_FIRED.delete(eid); badge = '<span class="tag b-super">debounced</span>'; last = '<span class="dim">newer message replaced this</span>'; }
    else if (Q_FIRED.has(eid)) { cw++; badge = '<span class="tag b-flight">sending…</span>'; last = '<span class="dim mono">fired — generating reply</span>'; }
    else {
      const base = r.scheduled_for ? new Date(r.scheduled_for).getTime() : now;
      const hold = r.send_after ? new Date(r.send_after).getTime() : 0;
      const sched = Math.max(base, hold);              // a "+15m" hold pushes the send time out
      const heldMin = hold > base ? Math.round((hold - base) / 60000) : 0;
      const ms = sched - now;
      if (ms > 0) { cw++; badge = '<span class="tag b-wait">waiting</span>'; last = `<b class="mono">${fmtDur(ms / 1000)}</b>${heldMin > 0 ? ` <span class="tag" title="held back by the +15m button">+${heldMin}m held</span>` : ''}${r.fan_id != null ? ` <button class="btn sm" data-hold="${r.fan_id}" data-eid="${r.event_id}" data-slug="${esc(r._slug)}" title="Push this reply back 15 more minutes">+15m</button>` : ''}${r.resume_url ? ` <button class="btn sm" data-send="${r.event_id}" data-slug="${esc(r._slug)}">send now</button>` : ''}`; }
      else if (now - sched < 90000) { cw++; badge = '<span class="tag b-flight">generating…</span>'; last = '<span class="dim mono">any second</span>'; }
      else { cx++; badge = '<span class="tag b-super">no reply</span>'; last = '<span class="dim">never sent (aborted/error)</span>'; }
    }
    const uname = (r.fan_id != null) ? `<a class="lnk" style="cursor:pointer" data-fan="${r.fan_id}" data-fslug="${esc(r._slug || '')}"><b>${esc(r.user)}</b></a>` : `<b>${esc(r.user)}</b>`;
    return `<tr><td class="mono dim">${fmtClock(r.queued_at)}</td><td>${sourceBadge(r._platform)}</td><td>${uname}</td>
      <td class="truncate">${esc(r.msg)}</td><td class="mono">${fmtDur(r.delay || 0)}</td><td>${badge}</td><td>${last}</td></tr>`;
  }).join('') || '<tr><td colspan="7" class="muted">no messages yet</td></tr>';
  $('#q-body').innerHTML = html;
  $('#q-w').textContent = cw; $('#q-s').textContent = cs; $('#q-x').textContent = cx;
  $('#q-body').querySelectorAll('[data-fan]').forEach(a => a.onclick = () => {
    const fan = a.dataset.fan, sl = a.dataset.fslug;
    if (fan && fan !== 'undefined' && sl) location.hash = `#/a/${key}/fans/${sl}.${fan}`;
  });
  $('#q-body').querySelectorAll('[data-send]').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const ev = String(b.dataset.send); const sl = b.dataset.slug;
    Q_FIRED.add(ev); qRender(key); // optimistic: flip to "sending…" and drop the button now
    try { await api(`/accounts/${sl}/queue/${ev}/send-now`, { method: 'POST', body: '{}' }); toast('sent now'); }
    catch (err) { Q_FIRED.delete(ev); toast('error: ' + err.message); qRender(key); }
  });
  $('#q-body').querySelectorAll('[data-hold]').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const fan = b.dataset.hold, sl = b.dataset.slug, eid = String(b.dataset.eid);
    b.disabled = true;
    try {
      const res = await api(`/accounts/${sl}/fans/${fan}/hold`, { method: 'POST', body: JSON.stringify({ minutes: 15 }) });
      // optimistic: apply the new send_after to this row now so the countdown
      // jumps immediately (the 3s poll then confirms it from the DB).
      const rowObj = Q.find(x => String(x.event_id) === eid);
      if (rowObj && res && res.send_after) rowObj.send_after = res.send_after;
      toast('reply held +15m'); qRender(key);
    } catch (err) { toast('error: ' + err.message); b.disabled = false; }
  });
}

boot();
