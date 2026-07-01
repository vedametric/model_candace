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
    `bot_id=eq.${botId}&type=in.(dm_queued,dm_sent)&order=created_at.desc&limit=${limit}`,
  );
  const rows = reconcile(events);
  // Attach any dashboard-set hold (fans.send_after) to pending rows, so the
  // "+15m" button visibly extends the countdown and survives a page refresh
  // (it's persisted in the DB, not just client memory).
  const pendingIds = [...new Set(rows.filter((r) => r.status === 'pending' && r.fan_id != null).map((r) => r.fan_id))];
  if (pendingIds.length) {
    try {
      const fans = await select('fans', `id=in.(${pendingIds.join(',')})&select=id,send_after`);
      const holdById = {};
      fans.forEach((f) => { if (f.send_after) holdById[f.id] = f.send_after; });
      rows.forEach((r) => { if (holdById[r.fan_id]) r.send_after = holdById[r.fan_id]; });
    } catch (_) { /* hold is best-effort; ignore */ }
  }
  return rows;
}

export function reconcile(events) {
  const sent = {};
  const queuedByFan = {};
  events.forEach((e) => {
    const p = e.payload || {};
    const key = e.fan_id + '|' + p.msg_count;
    if (e.type === 'dm_sent') sent[key] = { reply: p.reply, at: e.created_at };
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
