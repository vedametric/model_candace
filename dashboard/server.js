// Multi-account admin dashboard — Express bootstrap.
// Serves the vanilla-JS SPA from public/, the JSON API from /api, and per-account
// media from /content/:slug/(generations|posted|reference)/<file>.
//
// Basic Auth + TLS are handled by nginx in production; locally the app is open.

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import api from './src/routes/api.js';
import { contentPath, hasContent } from './src/accounts.js';
import { REST_BASE, hasKey } from './src/supabase.js';

// load .env (tiny parser — avoids a dependency)
loadDotEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// tiny request log
app.use((req, _res, next) => {
  if (req.path.startsWith('/api')) console.log(`${req.method} ${req.path}`);
  next();
});

// health
app.get('/healthz', (_req, res) =>
  res.json({ ok: true, live: hasKey(), rest: REST_BASE, ts: new Date().toISOString() }),
);

// API
app.use('/api', api);

// Per-account media. Folder names on disk:
//   generations/  ·  "posted images"/  ·  reference/
const SUBDIRS = { generations: 'generations', posted: 'posted images', reference: 'reference' };
app.get('/content/:slug/:kind/*', (req, res) => {
  const { slug, kind } = req.params;
  const sub = SUBDIRS[kind];
  if (!sub) return res.status(404).end();
  if (!hasContent(slug) && kind !== 'reference') {
    // still allow reference even if manifest missing
  }
  const rel = req.params[0] || '';
  const base = path.join(contentPath(slug), sub);
  const full = path.join(base, rel);
  // path traversal guard
  if (!full.startsWith(base)) return res.status(400).end();
  if (!fs.existsSync(full)) return res.status(404).end();
  res.sendFile(full);
});

// SPA static + fallback
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`admin-dashboard listening on http://${HOST}:${PORT}`);
  console.log(`  supabase: ${hasKey() ? REST_BASE : '(no SUPABASE_SERVICE_KEY — live data disabled)'}`);
});

// ---- minimal .env loader (no dependency) ----
function loadDotEnv() {
  try {
    const p = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch (_) {}
}
