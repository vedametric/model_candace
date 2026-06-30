// Account resolver — the heart of the multi-account model.
//
// One join key (`slug`) ties three layers together:
//   * Supabase `bots.slug`            (live DM data)
//   * filesystem `ACCOUNTS_ROOT/<slug>` (git content: generations, posts, persona docs)
//   * deploy provisioning loops over /opt/accounts/*
//
// Adding an account requires NO code change: clone the master repo to
// ACCOUNTS_ROOT/<new_slug> and ensure a `bots` row with that slug exists.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { select, hasKey } from './supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ACCOUNTS_ROOT holds one folder per account (each a clone of the master repo).
// Default to the repo two levels up from dashboard/src so `node server.js` works
// from a checkout during local dev (the repo root IS Candace's content folder).
export const ACCOUNTS_ROOT =
  process.env.ACCOUNTS_ROOT || path.resolve(__dirname, '..', '..', '..');

// Optional override map: { "<slug>": { "contentPath": "...", "label": "...", "hidden": true } }
function loadOverrides() {
  try {
    const p = path.join(__dirname, '..', 'config', 'accounts.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {}
  return {};
}

// Resolve a slug to its on-disk content folder.
// Convention: ACCOUNTS_ROOT/<slug>. Special-case the single-repo dev layout where
// the repo root itself is Candace's content (ACCOUNTS_ROOT points at the repo).
export function contentPath(slug) {
  const ov = loadOverrides()[slug];
  if (ov && ov.contentPath) return ov.contentPath;

  const perSlug = path.join(ACCOUNTS_ROOT, slug);
  if (fs.existsSync(path.join(perSlug, 'generations', 'manifest.json'))) return perSlug;

  // Dev fallback: ACCOUNTS_ROOT is itself a content repo (the master clone).
  if (fs.existsSync(path.join(ACCOUNTS_ROOT, 'generations', 'manifest.json'))) return ACCOUNTS_ROOT;

  return perSlug; // may not exist yet — callers check hasContent
}

export function hasContent(slug) {
  return fs.existsSync(path.join(contentPath(slug), 'generations', 'manifest.json'));
}

// ---- bot registry (Supabase), cached briefly to spare the DB on busy polling ----
let _cache = { at: 0, rows: null };
const TTL_MS = 15_000;

export async function listBots({ force = false } = {}) {
  if (!hasKey()) return fsAccounts();
  const now = nowMs();
  if (!force && _cache.rows && now - _cache.at < TTL_MS) return _cache.rows;
  const rows = await select(
    'bots',
    'select=id,slug,display_name,platform_account,persona_notes,model,created_at,automation_paused&order=id',
  );
  _cache = { at: now, rows };
  return rows;
}

export async function getBot(slug) {
  const rows = await listBots();
  const hit = rows.find((b) => b.slug === slug);
  if (hit) return hit;
  // fall back to a direct query in case the cache predates a new bot
  const fresh = await select('bots', `slug=eq.${encodeURIComponent(slug)}&limit=1`);
  return fresh[0] || null;
}

// Date.now is unavailable inside Workflow scripts but fine in a normal server process.
function nowMs() {
  return Date.now();
}

export function overrides() {
  return loadOverrides();
}

// When Supabase is unavailable, synthesise the account registry from disk so the
// dashboard still browses git content (read-only). Each folder under ACCOUNTS_ROOT
// with a generations/manifest.json is an account; the single-repo dev layout maps
// the repo itself to 'candace_summers'.
function fsAccounts() {
  const out = [];
  try {
    for (const name of fs.readdirSync(ACCOUNTS_ROOT)) {
      const dir = path.join(ACCOUNTS_ROOT, name);
      try {
        if (fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'generations', 'manifest.json'))) {
          out.push({ id: null, slug: name, display_name: name, platform_account: '', model: '', automation_paused: false });
        }
      } catch (_) {}
    }
  } catch (_) {}
  if (!out.length && fs.existsSync(path.join(ACCOUNTS_ROOT, 'generations', 'manifest.json'))) {
    out.push({ id: null, slug: 'candace_summers', display_name: 'Candace Summers', platform_account: 'candace_summers', model: '', automation_paused: false });
  }
  return out;
}
