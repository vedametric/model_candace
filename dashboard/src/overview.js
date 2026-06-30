// Cross-account aggregation for the Global Overview page.
// Fuses live Supabase counts (fans by stage / buyer type) with per-account
// filesystem content (spend, asset counts).

import { listBots, hasContent } from './accounts.js';
import { select, hasKey } from './supabase.js';
import { contentCounts } from './content.js';

export async function buildOverview() {
  const bots = await listBots();

  // fan rollups per bot in one query each (small tables; fine to loop)
  const perAccount = [];
  let totalFans = 0;
  let totalSpend = 0;
  let totalAssets = 0;
  let totalPosts = 0;
  const stageTotals = {};
  const buyerTotals = {};

  for (const b of bots) {
    const cc = contentCounts(b.slug);
    let fans = [];
    if (hasKey()) {
      try {
        fans = await select('fans', `bot_id=eq.${b.id}&select=stage,buyer_type,metadata`);
      } catch (_) {
        fans = [];
      }
    }
    const byStage = {};
    const byBuyer = {};
    for (const f of fans) {
      const s = f.stage || 'rapport';
      byStage[s] = (byStage[s] || 0) + 1;
      stageTotals[s] = (stageTotals[s] || 0) + 1;
      if (f.buyer_type) {
        byBuyer[f.buyer_type] = (byBuyer[f.buyer_type] || 0) + 1;
        buyerTotals[f.buyer_type] = (buyerTotals[f.buyer_type] || 0) + 1;
      }
    }
    totalFans += fans.length;
    totalSpend += cc.net_spent_cr || 0;
    totalAssets += cc.generations || 0;
    totalPosts += cc.posts || 0;

    perAccount.push({
      slug: b.slug,
      display_name: b.display_name || b.slug,
      platform_account: b.platform_account || '',
      model: b.model || '',
      hasContent: hasContent(b.slug),
      fans: fans.length,
      byStage,
      byBuyer,
      net_spent_cr: cc.net_spent_cr || 0,
      generations: cc.generations || 0,
      posts: cc.posts || 0,
    });
  }

  // 24h queue activity (queued + sent) across all bots
  let queue24h = { queued: 0, sent: 0 };
  if (hasKey()) {
    try {
      const sinceIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const ev = await select(
        'events',
        `type=in.(dm_queued,dm_sent)&created_at=gte.${sinceIso}&select=type`,
      );
      for (const e of ev) {
        if (e.type === 'dm_queued') queue24h.queued++;
        if (e.type === 'dm_sent') queue24h.sent++;
      }
    } catch (_) {}
  }

  return {
    live: hasKey(),
    totals: {
      accounts: bots.length,
      fans: totalFans,
      net_spent_cr: Math.round(totalSpend * 100) / 100,
      assets: totalAssets,
      posts: totalPosts,
    },
    stageTotals,
    buyerTotals,
    queue24h,
    accounts: perAccount,
  };
}
