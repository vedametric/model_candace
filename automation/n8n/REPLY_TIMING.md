# Per-persona reply timing (editable from the dashboard)

> ✅ **Already applied to the live n8n server** (`Candace ManyChat ASYNC`,
> id `48WOVR3dC78VxYN8`, node `Set Delay`) on 2026-06-30. The snippet below is
> the reference / for re-import. Editing **Reply timing** in the dashboard now
> changes the live delay on the next inbound DM.

The admin dashboard now controls each bot's reply delay. It's stored on
`bots.reply_delay` (jsonb) and returned by `dm_ingest` so the n8n flow can read it
live — **no redeploy needed when you change it**, the next inbound DM uses the new
values.

```json
{ "min_sec": 120, "max_sec": 600, "quick_chance": 0.15, "quick_min_sec": 45, "quick_max_sec": 120 }
```

Meaning: most replies wait a random `min_sec..max_sec`; `quick_chance` of the time
they instead wait the snappier `quick_min_sec..quick_max_sec`. (Defaults reproduce
the original hardcoded behaviour: ~85% wait 2–10 min, ~15% wait 45–120 s.)

## Update the **Set Delay** node in `candace_manychat_async.json`

That Code node currently hardcodes the delay. Replace the delay-picking lines so it
reads the config the `DB: ingest` node returned. The ingest result now includes a
`reply_delay` object — reference it (adjust the node name in `$()` if yours differs):

```js
// reply_delay comes from dm_ingest (the "DB: ingest" node output)
const cfg = $('DB: ingest').first().json.reply_delay || {};
const minS  = cfg.min_sec        ?? 120;
const maxS  = cfg.max_sec        ?? 600;
const qP    = cfg.quick_chance   ?? 0.15;
const qMin  = cfg.quick_min_sec  ?? 45;
const qMax  = cfg.quick_max_sec  ?? 120;

let delaySec;
if (Math.random() < qP) {
  delaySec = Math.round(qMin + Math.random() * (qMax - qMin));
} else {
  delaySec = Math.round(minS + Math.random() * (maxS - minS));
}

// keep the rest of the node the same (queued_at / scheduled_for / resume_url),
// just use delaySec instead of the old hardcoded number:
const now = new Date();
const scheduledFor = new Date(now.getTime() + delaySec * 1000);
return [{ json: { ...$json, delay_sec: delaySec, queued_at: now.toISOString(),
  scheduled_for: scheduledFor.toISOString(), resume_url: $execution.resumeUrl } }];
```

Save / re-import the workflow once. After that, editing **Reply timing** in the
dashboard's Persona tab changes how long that persona waits — instantly, per bot.

Until the node is updated, the dashboard value is stored and shown but the live flow
keeps using its current hardcoded delay.
