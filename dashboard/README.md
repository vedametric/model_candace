# Vedametric — Multi-Account Admin Dashboard

A single control panel across the whole system. Candace is one **account**; the
dashboard is built to manage many accounts (future clones of this master repo).

It fuses two data sources per account:

- **Live (Supabase REST)** — accounts registry, fans, funnel stage, buyer type,
  intent, chat transcripts, and the live message queue. Filtered by `bot_id`.
- **Git content (filesystem)** — the generations gallery (`generations/manifest.json`),
  posting log (`posted images/posted_log.json`), persona docs, and reference images.

## What it does

- **Global Overview** — accounts, fans-by-stage, buyer-type split, total spend, asset
  counts, 24h DM activity, per-account table.
- **Per account:** Persona (edit identity, model, system prompt, persona docs;
  pause/resume automation), Generations (gallery + filters + cost stats), Posts
  (log + upload status), Fans (funnel table → fan detail with transcript + memory;
  edit stage/buyer type), Queue (live; 3s poll / 1s countdown; "send now").

## Run locally

```bash
cd dashboard
npm install
# content-only (no live data):
ACCOUNTS_ROOT=.. node server.js
# with live data:
SUPABASE_SERVICE_KEY=<service_role key> ACCOUNTS_ROOT=/path/to/accounts node server.js
```

Then open http://127.0.0.1:8787. Without a service key the app degrades gracefully
to content-only (accounts are derived from the filesystem).

## Environment

See `.env.example`. Key vars: `PORT`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
`ACCOUNTS_ROOT`. Optional `DASHBOARD_GIT_TOKEN`/`DASHBOARD_GIT_REMOTE` make persona-doc
edits commit+push back to git (so they survive redeploys).

## Multi-account model — adding an account (no code change)

The single join key is the **slug**:

- Supabase `bots.slug`
- filesystem `ACCOUNTS_ROOT/<slug>/` (a clone of the master repo's content)

To add account `<slug>`:

1. Clone the master repo to `/opt/accounts/<slug>` and swap in that persona's
   content (soul.md, talking_style.md, generations/, posted images/, reference/, …).
2. Ensure a `bots` row exists with `slug = <slug>` (auto-created on first DM, or seed it).
3. It appears in the switcher automatically.

## Deploy

Pushing to the working branch triggers `.github/workflows/deploy-dashboard.yml`,
which rsyncs the app + content to the droplet and runs `deploy/provision.sh`
(Node, systemd unit `admin-dashboard`, nginx reverse proxy on :80 with HTTP Basic
Auth). Add the `SUPABASE_SERVICE_KEY` GitHub Actions secret for live data.

## Layout

```
server.js            express bootstrap, API + media mounts + SPA fallback
src/supabase.js      server-side Supabase REST client (holds the service key)
src/accounts.js      slug -> bot_id + content-dir resolver (+ fs fallback)
src/content.js       manifest / posted_log / persona docs / reference reader
src/queue.js         events -> queue reconcile (ported from candace_queue.html)
src/overview.js      cross-account aggregation
src/git.js           optional commit+push for persona-doc edits
src/routes/api.js    all read + write endpoints
public/              vanilla-JS SPA (index.html, app.js, styles.css)
```
