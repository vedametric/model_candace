// Message-queue reconcile — ported verbatim in spirit from
// automation/test/candace_queue.html (reconcile()), but fed from Supabase `events`
// filtered by bot_id instead of the n8n webhook. The server returns reconciled rows
// with a coarse status (sent / superseded / pending); the client decides the live
// pending sub-state (waiting / generating / no-reply) from the wall clock, exactly
// as the original page did.

import { select } from './supabase.js';

export async function queueRows(botId, { limit = 200 } = {}) {
  const events = await select(
    'events',
    `bot_id=eq.${botId}&type=in.(dm_queued,dm_sent,dm_cancelled)&order=created_at.desc&limit=${limit}`,
  );
  const rows = reconcile(events);
  // Attach each fan's display name (shown next to the handle, like the fan page)
  // and any dashboard-set hold (fans.send_after) so the "+15m" button visibly
  // extends the countdown and survives a refresh (persisted, not client memory).
  const fanIds = [...new Set(rows.filter((r) => r.fan_id != null).map((r) => r.fan_id))];
  if (fanIds.length) {
    try {
      const fans = await select('fans', `id=in.(${fanIds.join(',')})&select=id,display_name,send_after`);
      const byId = {};
      fans.forEach((f) => { byId[f.id] = f; });
      rows.forEach((r) => {
        const f = byId[r.fan_id];
        if (!f) return;
        if (f.display_name) r.display_name = f.display_name;
        if (f.send_after) r.send_after = f.send_after;
      });
    } catch (_) { /* best-effort; ignore */ }
  }
  return rows;
}

export function reconcile(events) {
  const sent = {};
  const cancelled = {};
  const queuedByFan = {};
  events.forEach((e) => {
    const p = e.payload || {};
    const key = e.fan_id + '|' + p.msg_count;
    if (e.type === 'dm_sent') sent[key] = { reply: p.reply, at: e.created_at };
    if (e.type === 'dm_cancelled') cancelled[key] = e.created_at;
    if (e.type === 'dm_queued') {
      (queuedByFan[e.fan_id] = queuedByFan[e.fan_id] || []).push(p.msg_count);
    }
  });
  const maxCount = {};
  Object.keys(queuedByFan).forEach((f) => {
    maxCount[f] = Math.max.apply(null, queuedByFan[f]);
  });

  const rows = events
    .filter((e) => e.type === 'dm_queued')
    .map((e) => {
      const p = e.payload || {};
      const key = e.fan_id + '|' + p.msg_count;
      let status;
      if (sent[key]) status = 'sent';
      else if (cancelled[key]) status = 'cancelled';
      else if (p.msg_count < maxCount[e.fan_id]) status = 'superseded';
      else status = 'pending';
      return {
        event_id: e.id,
        fan_id: e.fan_id,
        count: p.msg_count,
        user: p.username || 'fan ' + e.fan_id,
        msg: p.msg || '',
        delay: p.delay_sec,
        queued_at: p.queued_at || e.created_at,
        scheduled_for: p.scheduled_for,
        resume_url: p.resume_url || '',
        status,
        reply: sent[key] ? sent[key].reply : '',
        sent_at: sent[key] ? sent[key].at : '',
      };
    });
  rows.sort((a, b) => new Date(b.queued_at) - new Date(a.queued_at));
  return rows;
}
