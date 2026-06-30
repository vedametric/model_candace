// Thin server-side Supabase REST (PostgREST) client.
// The service_role key lives ONLY here (server-side) and is never sent to the browser.
// All write helpers are scoped — there is no raw-SQL passthrough.

const RAW_URL = process.env.SUPABASE_URL || 'https://vvnefkexzhfgvuusavvl.supabase.co/rest/v1';
// Accept either the project URL or the full /rest/v1 base; normalise to /rest/v1.
export const REST_BASE = RAW_URL.replace(/\/+$/, '').endsWith('/rest/v1')
  ? RAW_URL.replace(/\/+$/, '')
  : RAW_URL.replace(/\/+$/, '') + '/rest/v1';

const KEY = process.env.SUPABASE_SERVICE_KEY || '';

export function hasKey() {
  return Boolean(KEY);
}

function headers(extra = {}) {
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

class SupabaseError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SupabaseError';
    this.status = status || 502;
  }
}
export { SupabaseError };

function ensureKey() {
  if (!KEY) {
    throw new SupabaseError(
      'SUPABASE_SERVICE_KEY is not set — live data unavailable. Set it in the dashboard .env on the server.',
      503,
    );
  }
}

// GET /rest/v1/<table>?<query>. `query` is a PostgREST query string (already encoded).
export async function select(table, query = '') {
  ensureKey();
  const url = `${REST_BASE}/${table}${query ? '?' + query : ''}`;
  const res = await fetch(url, { headers: headers(), cache: 'no-store' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new SupabaseError(`Supabase select ${table} failed (${res.status}): ${body.slice(0, 300)}`, 502);
  }
  return res.json();
}

// PATCH /rest/v1/<table>?<filter> with a partial row. Returns the updated rows.
export async function patch(table, filterQuery, body) {
  ensureKey();
  const url = `${REST_BASE}/${table}?${filterQuery}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new SupabaseError(`Supabase patch ${table} failed (${res.status}): ${t.slice(0, 300)}`, 502);
  }
  return res.json();
}

// POST /rest/v1/rpc/<fn> with a JSON body of named args.
export async function rpc(fn, args = {}) {
  ensureKey();
  const url = `${REST_BASE}/rpc/${fn}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new SupabaseError(`Supabase rpc ${fn} failed (${res.status}): ${t.slice(0, 300)}`, 502);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}
