'use strict';
// ---------------- helpers ----------------
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
let ACCOUNTS = [];
let LIVE = true;
let timers = [];

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
  window.addEventListener('hashchange', () => route());
  if (!location.hash) location.hash = '#/overview';
  route();
}

function renderSidebar() {
  const list = $('#account-list');
  if (!ACCOUNTS.length) { list.innerHTML = '<div class="loading">no accounts</div>'; return; }
  list.innerHTML = ACCOUNTS.map(a => {
    const fans = a.counts && a.counts.fans != null ? a.counts.fans : '';
    return `<div class="acct ${a.hasContent ? '' : 'ghost'}" data-slug="${esc(a.slug)}">
      <div class="av">${esc(initials(a.display_name))}</div>
      <div class="nm"><b>${esc(a.display_name)}</b><span>${esc(a.platform_account || a.slug)}</span></div>
      ${a.automation_paused ? '<span class="dot-pause" title="automation paused"></span>' : ''}
      ${fans !== '' ? `<span class="badge-fans">${fans}</span>` : ''}
    </div>`;
  }).join('');
  list.querySelectorAll('.acct').forEach(el => el.onclick = () => { location.hash = `#/a/${el.dataset.slug}/persona`; });
  $('#side-foot').innerHTML = `${ACCOUNTS.length} account${ACCOUNTS.length === 1 ? '' : 's'}${LIVE ? '' : ' · <span style="color:#c9a">live data off</span>'}`;
}

function setActive(slug, tab) {
  document.querySelectorAll('.acct').forEach(e => e.classList.toggle('active', e.dataset.slug === slug));
  $('.nav-overview').classList.toggle('active', !slug);
  const tabsEl = $('#tabs');
  if (slug) {
    $('#crumb').textContent = (ACCOUNTS.find(a => a.slug === slug) || {}).display_name || slug;
    tabsEl.innerHTML = TABS.map(t => `<div class="tab ${t.id === tab ? 'active' : ''}" data-tab="${t.id}">${t.label}</div>`).join('');
    tabsEl.querySelectorAll('.tab').forEach(el => el.onclick = () => { location.hash = `#/a/${slug}/${el.dataset.tab}`; });
  } else {
    $('#crumb').textContent = 'Global Overview'; tabsEl.innerHTML = '';
  }
}

// ---------------- router ----------------
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const p = h.split('/').filter(Boolean);
  if (p[0] === 'a') return { slug: p[1], tab: p[2] || 'persona', sub: p[3] };
  return { route: p[0] || 'overview' };
}

async function route(force) {
  clearTimers();
  const r = parseHash();
  if (r.slug) {
    setActive(r.slug, r.tab);
    if (r.tab === 'fans' && r.sub) return fanDetail(r.slug, r.sub);
    const fn = { persona: persona, studio: studio, generations: generations, posts: posts, fans: fans, queue: queue }[r.tab] || persona;
    return fn(r.slug);
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
  view.querySelectorAll('tr[data-slug]').forEach(tr => tr.onclick = () => location.hash = `#/a/${tr.dataset.slug}/persona`);
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
      <div class="row between"><h3 style="margin:0"><span class="live-dot"></span>Generation queue</h3><button id="s-refresh" class="btn ghost sm">⟳ refresh</button></div>
      <div id="s-queue"><div class="loading">loading…</div></div>
    </div>`;

  const kindSel = $('#s-kind');
  const toggleKind = () => {
    const v = kindSel.value;
    $('#s-vid-only').style.display = v === 'video' ? 'block' : 'none';
    $('#s-img-only').style.display = v === 'video' ? 'none' : 'block';
  };
  kindSel.onchange = toggleKind; toggleKind();

  function readBrief() {
    const kind = kindSel.value;
    const brief = {
      kind, shot: $('#s-shot').value, action: $('#s-action').value, setting: $('#s-setting').value,
      outfit: $('#s-outfit').value, light: $('#s-light').value, mood: $('#s-mood').value,
      framing: $('#s-framing').value,
    };
    if (kind === 'image') brief.count = +$('#s-count').value;
    else {
      brief.video_method = $('#s-method').value || undefined;
      brief.duration = +$('#s-dur').value; brief.resolution = $('#s-res').value;
      const link = $('#s-driving').value.trim();
      if (link) brief.driving_video = { link };
    }
    return brief;
  }
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
      loadQueue();
    } catch (e) { toast('error: ' + e.message); }
    btn.disabled = false;
  };
  $('#s-refresh').onclick = loadQueue;

  // show current balance from the manifest ledger
  api(`/accounts/${slug}/generations`).then(d => { $('#s-balance').innerHTML = `balance ~<b>${d.balance_now_cr ?? '?'}</b> cr`; }).catch(() => {});

  async function loadQueue() {
    try {
      const d = await api(`/accounts/${slug}/gen`);
      const rows = d.requests || [];
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
    ? `<img src="${esc(r.brief.reference_image.url)}" title="your reference picture" style="height:46px;border-radius:6px;border:1px solid var(--line);cursor:zoom-in" onclick="openLightbox('${esc(r.brief.reference_image.url)}',false)">` : '';
  const logArr = Array.isArray(r.log) ? r.log : [];
  const logHtml = logArr.length ? `<details class="prompt" style="margin-top:8px"><summary>worker activity (${logArr.length})</summary>
    <div style="margin-top:6px">${logArr.slice(-12).map(l => `<div class="mono" style="font-size:12px"><span class="dim">${fmtClock(l.ts)}</span> <b>${esc(l.stage || '')}</b> ${esc(l.msg || '')}</div>`).join('')}</div></details>` : '';
  const result = r.result && r.result.file ? `<a href="/content/${encodeURIComponent(slug)}/generations/${encodeURIComponent(r.result.file)}" target="_blank">view asset ↗</a>` : '';
  return `<div class="panel" style="box-shadow:none;border-radius:9px;margin:10px 0">
    <div class="row between">
      <div class="row"><span class="tag ${STATUS_TAG[r.status] || ''}">${esc(r.status)}</span>
        <span class="tag">${esc(r.kind)}${r.video_method ? ' · ' + esc(r.video_method) : ''}</span>
        ${refImg}
        <span class="muted">#${r.id} · ~${r.est_cost_cr ?? '?'} cr · ${fmtDateTime(r.created_at)}</span></div>
      <div class="row">${result}
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
let F = { rows: [], stage: 'all', buyer: 'all', q: '' };
async function fans(slug) {
  loading();
  let d; try { d = await api('/accounts/' + slug + '/fans'); } catch (e) { view.innerHTML = errBox(e); return; }
  F = { rows: d.fans || [], stage: 'all', buyer: 'all', q: '', slug };
  const stages = [...new Set(F.rows.map(r => r.stage).filter(Boolean))];
  const buyers = [...new Set(F.rows.map(r => r.buyer_type).filter(Boolean))];
  view.innerHTML = `
    <div class="panel">
      <div class="row" style="margin-bottom:8px"><input type="search" id="f-q" placeholder="search fans…">
        <select id="f-stage"><option value="all">All stages</option>${stages.map(s => `<option>${esc(s)}</option>`).join('')}</select>
        <select id="f-buyer"><option value="all">All buyer types</option>${buyers.map(b => `<option>${esc(b)}</option>`).join('')}</select>
        <span class="dim">${F.rows.length} fans</span></div>
    </div>
    <div class="panel"><table><thead><tr><th>Fan</th><th>Stage</th><th>Buyer</th><th>Intent</th><th>Msgs</th><th>Last seen</th><th>Summary</th></tr></thead>
    <tbody id="f-body"></tbody></table></div>`;
  $('#f-q').oninput = e => { F.q = e.target.value.toLowerCase(); fBody(); };
  $('#f-stage').onchange = e => { F.stage = e.target.value; fBody(); };
  $('#f-buyer').onchange = e => { F.buyer = e.target.value; fBody(); };
  fBody();
}
function fBody() {
  let rows = F.rows.filter(r => (F.stage === 'all' || r.stage === F.stage) && (F.buyer === 'all' || r.buyer_type === F.buyer));
  if (F.q) rows = rows.filter(r => (r.username + ' ' + (r.display_name || '') + ' ' + (r.summary || '')).toLowerCase().includes(F.q));
  $('#f-body').innerHTML = rows.map(r => {
    const sc = r.intent_score == null ? '' : `<div class="ibar"><i style="width:${Math.min(100, r.intent_score)}%"></i></div> <span class="mono">${r.intent_score}</span>`;
    return `<tr data-id="${r.id}">
      <td><b>${esc(r.username)}</b><div class="dim">${esc(r.display_name || '')}</div></td>
      <td>${r.stage ? `<span class="tag stage">${esc(r.stage)}</span>` : '—'}</td>
      <td>${r.buyer_type ? `<span class="tag buyer">${esc(r.buyer_type)}</span>` : '—'}</td>
      <td>${sc}</td><td class="mono">${r.msg_count}</td><td class="dim">${fmtDateTime(r.last_seen)}</td>
      <td class="truncate dim">${esc(r.summary || '')}</td></tr>`;
  }).join('') || '<tr><td colspan="7" class="muted">no fans</td></tr>';
  $('#f-body').querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => location.hash = `#/a/${F.slug}/fans/${tr.dataset.id}`);
}

async function fanDetail(slug, id) {
  loading();
  setActive(slug, 'fans');
  let f, m;
  try { [f, m] = await Promise.all([api(`/accounts/${slug}/fans/${id}`), api(`/accounts/${slug}/fans/${id}/messages`)]); }
  catch (e) { view.innerHTML = errBox(e); return; }
  const md = f.metadata || {};
  const signals = (md.signals || []).map(s => `<span class="tag">${esc(s)}</span>`).join(' ');
  view.innerHTML = `
    <div class="row between" style="margin-bottom:14px">
      <div><a href="#/a/${slug}/fans">← all fans</a> <b style="font-size:17px;margin-left:8px">${esc(f.username)}</b> <span class="dim">${esc(f.display_name || '')}</span></div>
    </div>
    <div class="grid2">
      <div class="panel"><h3>Conversation (${(m.messages || []).length})</h3>
        <div class="chat" id="chat">${(m.messages || []).map(x => `<div class="bubble ${x.role === 'assistant' ? 'assistant' : 'user'}">${esc(x.content)}<span class="ts">${fmtClock(x.created_at)}</span></div>`).join('')}</div>
      </div>
      <div>
        <div class="panel"><h3>Funnel</h3>
          <div class="field"><label>Stage</label><input id="d-stage" value="${esc(f.stage || '')}"></div>
          <div class="field"><label>Buyer type</label><input id="d-buyer" value="${esc(f.buyer_type || '')}"></div>
          <button id="d-save" class="btn primary sm">Save funnel</button>
          <div class="row" style="margin-top:12px">
            <span class="tag">intent ${md.intent_score ?? '—'}</span>
            <span class="tag">${esc(md.temperature || '')}</span>
            <span class="tag">msgs ${f.msg_count}</span></div>
        </div>
        <div class="panel"><h3>Memory</h3>
          <div class="field"><label>Summary</label><div class="doc-md">${esc(f.summary || '—')}</div></div>
          ${md.technique ? `<div class="field"><label>Technique</label><div>${esc(md.technique)}</div></div>` : ''}
          ${md.next_move ? `<div class="field"><label>Next move</label><div>${esc(md.next_move)}</div></div>` : ''}
          ${signals ? `<div class="field"><label>Signals</label><div class="row">${signals}</div></div>` : ''}
        </div>
      </div>
    </div>`;
  const chat = $('#chat'); if (chat) chat.scrollTop = chat.scrollHeight;
  $('#d-save').onclick = async () => {
    try { await api(`/accounts/${slug}/fans/${id}`, { method: 'PATCH', body: JSON.stringify({ stage: $('#d-stage').value, buyer_type: $('#d-buyer').value }) }); toast('funnel updated'); }
    catch (e) { toast('error: ' + e.message); }
  };
}

// ---------------- QUEUE ----------------
let Q = [];
async function queue(slug) {
  loading();
  view.innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div><span class="live-dot"></span><b>Live message queue</b> <span class="dim">— incoming DMs, the delay she picked, and when they send</span></div>
      <div class="row"><span class="pill b-wait">waiting <b id="q-w">0</b></span><span class="pill b-sent">sent <b id="q-s">0</b></span><span class="pill b-super">debounced <b id="q-x">0</b></span></div>
    </div>
    <div class="panel"><table><thead><tr><th>Queued</th><th>User</th><th>Incoming</th><th>Delay</th><th>Status</th><th>Sends in / reply</th></tr></thead>
    <tbody id="q-body"><tr><td colspan="6" class="loading">loading…</td></tr></tbody></table></div>`;
  async function poll() {
    try { const d = await api('/accounts/' + slug + '/queue'); Q = d.rows || []; qRender(slug); }
    catch (e) { $('#q-body').innerHTML = `<tr><td colspan="6" class="err-banner">${esc(e.message)}</td></tr>`; }
  }
  await poll();
  timers.push(setInterval(poll, 3000));
  timers.push(setInterval(() => qRender(slug), 1000));
}
function qRender(slug) {
  if (!$('#q-body')) return;
  const now = Date.now(); let cw = 0, cs = 0, cx = 0;
  const html = Q.map(r => {
    let badge, last;
    if (r.status === 'sent') { cs++; badge = '<span class="tag b-sent">sent</span>'; last = `<span class="dim" style="font-style:italic">${esc(r.reply || '')}</span>`; }
    else if (r.status === 'superseded') { cx++; badge = '<span class="tag b-super">debounced</span>'; last = '<span class="dim">newer message replaced this</span>'; }
    else {
      const sched = r.scheduled_for ? new Date(r.scheduled_for).getTime() : now;
      const ms = sched - now;
      if (ms > 0) { cw++; badge = '<span class="tag b-wait">waiting</span>'; last = `<b class="mono">${fmtDur(ms / 1000)}</b>${r.resume_url ? ` <button class="btn sm" data-send="${r.event_id}">send now</button>` : ''}`; }
      else if (now - sched < 90000) { cw++; badge = '<span class="tag b-flight">generating…</span>'; last = '<span class="dim mono">any second</span>'; }
      else { cx++; badge = '<span class="tag b-super">no reply</span>'; last = '<span class="dim">never sent (aborted/error)</span>'; }
    }
    return `<tr><td class="mono dim">${fmtClock(r.queued_at)}</td><td><b>${esc(r.user)}</b></td>
      <td class="truncate">${esc(r.msg)}</td><td class="mono">${fmtDur(r.delay || 0)}</td><td>${badge}</td><td>${last}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">no messages yet</td></tr>';
  $('#q-body').innerHTML = html;
  $('#q-w').textContent = cw; $('#q-s').textContent = cs; $('#q-x').textContent = cx;
  $('#q-body').querySelectorAll('[data-send]').forEach(b => b.onclick = async (e) => {
    e.stopPropagation(); b.disabled = true; b.textContent = 'sending…';
    try { await api(`/accounts/${slug}/queue/${b.dataset.send}/send-now`, { method: 'POST', body: '{}' }); toast('sent now'); }
    catch (err) { toast('error: ' + err.message); }
  });
}

boot();
