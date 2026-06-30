// Filesystem content reader — pulls the git-managed per-account assets:
// generations manifest, posting log, persona markdown docs, reference images.
// NOTE: the posting folder is literally named "posted images" (with a space) —
// always build paths with path.join, never string concatenation.

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { contentPath } from './accounts.js';

export const POSTED_DIR = 'posted images';

// Persona docs surfaced in the Persona tab, in display order.
export const PERSONA_DOCS = [
  { name: 'soul.md', label: 'Soul (persona bible)' },
  { name: 'talking_style.md', label: 'Talking style' },
  { name: 'conversation_master.md', label: 'Conversation master (DM → conversion)' },
  { name: 'approved_examples.md', label: 'Approved examples' },
  { name: 'candace_system_prompt.md', label: 'System prompt (doc)' },
];

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

export function readManifest(slug) {
  const p = path.join(contentPath(slug), 'generations', 'manifest.json');
  return readJsonSafe(p) || { items: [], count: 0 };
}

export function readPostedLog(slug) {
  const p = path.join(contentPath(slug), POSTED_DIR, 'posted_log.json');
  return readJsonSafe(p) || { profile: null, posts: [] };
}

export async function readDoc(slug, name) {
  if (!PERSONA_DOCS.some((d) => d.name === name)) {
    throw Object.assign(new Error('unknown persona doc'), { status: 400 });
  }
  const p = path.join(contentPath(slug), name);
  try {
    return await fsp.readFile(p, 'utf8');
  } catch (_) {
    return '';
  }
}

export async function writeDoc(slug, name, body) {
  if (!PERSONA_DOCS.some((d) => d.name === name)) {
    throw Object.assign(new Error('unknown persona doc'), { status: 400 });
  }
  const p = path.join(contentPath(slug), name);
  await fsp.writeFile(p, body, 'utf8');
  return p;
}

// Return the persona docs as { name, label, exists, content } (content optional).
export async function readPersonaDocs(slug, { withContent = true } = {}) {
  const out = [];
  for (const d of PERSONA_DOCS) {
    const p = path.join(contentPath(slug), d.name);
    const exists = fs.existsSync(p);
    out.push({
      name: d.name,
      label: d.label,
      exists,
      content: exists && withContent ? await fsp.readFile(p, 'utf8') : '',
    });
  }
  return out;
}

// List reference images (identity anchors) under reference/.
export function listReference(slug) {
  const dir = path.join(contentPath(slug), 'reference');
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .map((f) => ({ file: f, url: `/content/${encodeURIComponent(slug)}/reference/${encodeURIComponent(f)}` }));
  } catch (_) {
    return [];
  }
}

// Parse social handles / funnel links out of the persona docs (the DB has no
// telegram/instagram columns — the truth lives in soul.md / system prompt text).
export function parseSocials(slug) {
  const socials = {};
  const grab = (file) => {
    try {
      return fs.readFileSync(path.join(contentPath(slug), file), 'utf8');
    } catch (_) {
      return '';
    }
  };
  const text = [grab('soul.md'), grab('candace_system_prompt.md'), grab('CLAUDE.md')].join('\n');

  const ig = text.match(/instagram\.com\/([A-Za-z0-9_.]+)/i) || text.match(/\bmodel_[A-Za-z0-9_.]+\b/);
  if (ig) socials.instagram = ig[1] ? `@${ig[1]}` : ig[0];

  const tg = text.match(/telegram[^A-Za-z0-9]{0,12}@?([A-Za-z0-9_]{4,})/i);
  if (tg) socials.telegram = `@${tg[1]}`;

  const tt = text.match(/tiktok\.com\/@?([A-Za-z0-9_.]+)/i);
  if (tt) socials.tiktok = `@${tt[1]}`;

  return socials;
}

// Compact content counts for the account switcher / overview.
export function contentCounts(slug) {
  const manifest = readManifest(slug);
  const posted = readPostedLog(slug);
  return {
    generations: manifest.count || (manifest.items ? manifest.items.length : 0),
    posts: Array.isArray(posted.posts) ? posted.posts.length : 0,
    net_spent_cr: manifest.net_spent_cr || 0,
    total_size_human: manifest.total_size_human || '',
  };
}
