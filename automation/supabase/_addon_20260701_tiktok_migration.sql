-- ============================================================================
--  TEMPORARY ADD-ON — 20260701 TikTok history migration (cutover)
--  ---------------------------------------------------------------------------
--  Purpose: when automation is turned on for ALL TikTok fans, people who
--  already have a DM history (exported before cutover) should not look brand
--  new. This holds that exported history and backfills it into the live tables
--  the first time such a user messages, BEFORE the new message is logged — so
--  Candace keeps continuity.
--
--  Pieces:
--   1. table  public."20260701_tiktok_migration"  — the exported history,
--      one row per user (keyed by username = handle without '@', lowercased),
--      messages normalized to [{role, content, created_at}].
--   2. rpc    public.dm_migrate_history(p_bot, p_platform, p_username)
--      — idempotent, fail-open backfill. No-ops when there is no un-migrated
--      history for the user, or when the fan already has live messages.
--   3. n8n    "MIGRATE: history (addon)" node in the TikTok workflow
--      (candace_manychat_async.json), wired Dedup: gate -> MIGRATE -> DB: ingest,
--      calling this RPC. DB: ingest reads inbound fields from $('Extract Inbound')
--      so it is decoupled from the inserted node.
--
--  Data is loaded from the TikTok export via the Supabase REST API (bulk insert),
--  not committed here (181 conversations / 404 messages).
--
--  ⛑️  TO REMOVE (after a couple of days, per plan — it adds one extra hop of
--      latency to the first message from each fan):
--        1. In n8n: delete the "MIGRATE: history (addon)" node and reconnect
--           Dedup: gate -> DB: ingest, then revert DB: ingest jsonBody to use
--           $json.username / $json.display / $json.msg (instead of
--           $('Extract Inbound').first().json.*).  Re-deploy + activate.
--        2. In SQL:
--             drop function if exists public.dm_migrate_history(text,text,text);
--             drop table if exists public."20260701_tiktok_migration";
-- ============================================================================

create table if not exists public."20260701_tiktok_migration" (
  id             bigint generated always as identity primary key,
  username       text not null unique,            -- match key: handle sans @, lowercased
  name           text,
  handle         text,
  messages       jsonb not null default '[]'::jsonb,    -- normalized [{role,content,created_at}]
  message_count  int  not null default 0,
  source_messages jsonb not null default '[]'::jsonb,   -- raw export rows (audit)
  migrated       boolean not null default false,        -- set once injected into live history
  migrated_at    timestamptz,
  imported_at    timestamptz not null default now()
);

create or replace function public.dm_migrate_history(
  p_bot text, p_platform text, p_username text
) returns jsonb
language plpgsql
as $$
declare
  v_bot_id bigint; v_fan_id bigint; v_row public."20260701_tiktok_migration"%rowtype;
  v_existing int; v_n int := 0; v_uname text := lower(regexp_replace(coalesce(p_username,''),'^@',''));
begin
  if v_uname = '' then return jsonb_build_object('migrated', false, 'reason', 'no_username'); end if;

  select id into v_bot_id from public.bots where slug = p_bot;
  if v_bot_id is null then return jsonb_build_object('migrated', false, 'reason', 'no_bot'); end if;

  select * into v_row from public."20260701_tiktok_migration"
    where username = v_uname and migrated = false
    order by id limit 1;
  if not found then return jsonb_build_object('migrated', false, 'reason', 'no_history'); end if;

  insert into public.fans(bot_id, platform, username, display_name)
    values (v_bot_id, p_platform, v_uname, nullif(v_row.name,''))
    on conflict (bot_id, platform, username) do update set last_seen = now()
    returning id into v_fan_id;

  -- only backfill when the fan has no live history yet (avoid duplicates)
  select count(*) into v_existing from public.messages where fan_id = v_fan_id;
  if v_existing > 0 then
    update public."20260701_tiktok_migration" set migrated = true, migrated_at = now() where id = v_row.id;
    return jsonb_build_object('migrated', false, 'reason', 'fan_has_history', 'fan_id', v_fan_id);
  end if;

  insert into public.messages(fan_id, bot_id, role, content, created_at)
    select v_fan_id, v_bot_id,
           case when (e->>'role') in ('user','assistant','system') then (e->>'role') else 'user' end,
           coalesce(nullif(e->>'content',''), '[media]'),
           coalesce((e->>'created_at')::timestamptz, now())
    from jsonb_array_elements(v_row.messages) e;
  get diagnostics v_n = row_count;

  update public.fans set msg_count = msg_count + v_n where id = v_fan_id;
  update public."20260701_tiktok_migration" set migrated = true, migrated_at = now() where id = v_row.id;
  insert into public.events(bot_id, fan_id, type, payload)
    values (v_bot_id, v_fan_id, 'history_migrated',
            jsonb_build_object('username', v_uname, 'count', v_n, 'source', '20260701_tiktok_migration'));

  return jsonb_build_object('migrated', true, 'count', v_n, 'fan_id', v_fan_id);
end;
$$;
