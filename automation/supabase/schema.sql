-- ============================================================================
--  Multi-bot AI DM memory schema  (Supabase / Postgres)
--  Run this in the Supabase SQL Editor (or psql) once.
--
--  Design:
--   * Multi-bot from day one. Candace is one row in `bots`; add more bots later
--     with no schema change. All per-fan data is partitioned by bot_id.
--   * "Log as much as possible": every inbound message and every reply is kept
--     forever in `messages`; raw webhooks + system events go in `events`.
--   * Fast for the chat loop: one RPC (`dm_ingest`) upserts the fan, logs the
--     inbound message, and returns the recent window + summary + stage in a
--     single round-trip. `dm_log_reply` / `dm_set_summary` / `dm_set_stage`
--     handle the write-backs.
-- ============================================================================

-- ---- master registry of bots ------------------------------------------------
create table if not exists public.bots (
  id               bigint generated always as identity primary key,
  slug             text unique not null,                 -- 'candace_summers'
  display_name     text,
  platform_account text,                                  -- e.g. tiktok handle
  persona_notes    text,
  system_prompt    text,                                  -- full personality / brain (set via candace_prompt.sql)
  model            text default 'gpt-4o',                 -- LLM model for this bot's replies
  created_at       timestamptz not null default now()
);
-- if upgrading an existing install, these add the new columns:
alter table public.bots add column if not exists system_prompt text;
alter table public.bots add column if not exists model text default 'gpt-4o';
alter table public.bots add column if not exists telegram_handle text;   -- e.g. @candace_summers (funnel destination)
alter table public.bots add column if not exists instagram_url text;

-- ---- one row per fan, per bot, per platform --------------------------------
create table if not exists public.fans (
  id            bigint generated always as identity primary key,
  bot_id        bigint not null references public.bots(id) on delete cascade,
  platform      text   not null default 'tiktok',
  username      text   not null,
  display_name  text,
  summary       text   not null default '',              -- running memory note
  stage         text   not null default 'rapport',       -- funnel stage (v3)
  buyer_type    text,                                     -- provider/baller/shy/sub
  msg_count     int    not null default 0,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  metadata      jsonb  not null default '{}'::jsonb,
  unique (bot_id, platform, username)
);
create index if not exists idx_fans_bot          on public.fans(bot_id);
create index if not exists idx_fans_lookup        on public.fans(bot_id, platform, username);

-- ---- full, permanent message log -------------------------------------------
create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  fan_id      bigint not null references public.fans(id) on delete cascade,
  bot_id      bigint not null references public.bots(id) on delete cascade,
  role        text   not null check (role in ('user','assistant','system')),
  content     text   not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_messages_fan_time on public.messages(fan_id, created_at);

-- ---- raw event / audit log (log everything) --------------------------------
create table if not exists public.events (
  id          bigint generated always as identity primary key,
  bot_id      bigint,
  fan_id      bigint,
  type        text,                                       -- inbound_webhook, reply_sent, summary_updated...
  payload     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_events_time on public.events(created_at);

-- ============================================================================
--  RPCs used by the n8n workflow
-- ============================================================================

-- Upsert the bot+fan, log the inbound user message, bump counters, and return
-- the conversation context (summary, stage, count, and the last p_window turns
-- in chronological order) in one call.
create or replace function public.dm_ingest(
  p_bot      text,
  p_platform text,
  p_username text,
  p_display  text,
  p_user_msg text,
  p_window   int default 10
) returns jsonb
language plpgsql
as $$
declare
  v_bot_id  bigint;
  v_fan_id  bigint;
  v_summary text;
  v_stage   text;
  v_count   int;
  v_recent  jsonb;
  v_prompt  text;
  v_model   text;
begin
  -- bot (auto-create if new)
  select id, system_prompt, model into v_bot_id, v_prompt, v_model
    from public.bots where slug = p_bot;
  if v_bot_id is null then
    insert into public.bots(slug, display_name) values (p_bot, p_bot)
    returning id, system_prompt, model into v_bot_id, v_prompt, v_model;
  end if;

  -- fan (upsert)
  insert into public.fans(bot_id, platform, username, display_name)
  values (v_bot_id, p_platform, lower(p_username), p_display)
  on conflict (bot_id, platform, username)
    do update set display_name = coalesce(excluded.display_name, public.fans.display_name),
                  last_seen = now()
  returning id into v_fan_id;

  -- log inbound message
  insert into public.messages(fan_id, bot_id, role, content)
  values (v_fan_id, v_bot_id, 'user', p_user_msg);

  -- counters
  update public.fans
     set msg_count = msg_count + 1, last_seen = now()
   where id = v_fan_id
   returning summary, stage, msg_count into v_summary, v_stage, v_count;

  -- recent window, chronological
  select coalesce(jsonb_agg(jsonb_build_object('role', role, 'content', content)
                            order by created_at), '[]'::jsonb)
    into v_recent
  from (
    select role, content, created_at
    from public.messages
    where fan_id = v_fan_id
    order by created_at desc
    limit p_window
  ) t;

  -- audit
  insert into public.events(bot_id, fan_id, type, payload)
  values (v_bot_id, v_fan_id, 'inbound_message',
          jsonb_build_object('platform', p_platform, 'username', lower(p_username)));

  return jsonb_build_object(
    'bot_id',        v_bot_id,
    'fan_id',        v_fan_id,
    'summary',       coalesce(v_summary, ''),
    'stage',         coalesce(v_stage, 'rapport'),
    'count',         v_count,
    'recent',        v_recent,
    'system_prompt', coalesce(v_prompt, ''),
    'model',         coalesce(v_model, 'gpt-4o')
  );
end;
$$;

-- Log Candace's reply.
create or replace function public.dm_log_reply(
  p_fan_id bigint,
  p_bot_id bigint,
  p_reply  text
) returns void
language plpgsql
as $$
begin
  insert into public.messages(fan_id, bot_id, role, content)
  values (p_fan_id, p_bot_id, 'assistant', p_reply);
  update public.fans set last_seen = now() where id = p_fan_id;
  insert into public.events(bot_id, fan_id, type, payload)
  values (p_bot_id, p_fan_id, 'reply_sent', jsonb_build_object('len', length(p_reply)));
end;
$$;

-- Update the running memory note.
create or replace function public.dm_set_summary(
  p_fan_id bigint,
  p_summary text
) returns void
language plpgsql
as $$
begin
  update public.fans set summary = p_summary where id = p_fan_id;
  insert into public.events(fan_id, type, payload)
  values (p_fan_id, 'summary_updated', jsonb_build_object('summary', p_summary));
end;
$$;

-- Update the funnel stage / buyer type (for v3).
create or replace function public.dm_set_stage(
  p_fan_id bigint,
  p_stage  text,
  p_buyer_type text default null
) returns void
language plpgsql
as $$
begin
  update public.fans
     set stage = coalesce(p_stage, stage),
         buyer_type = coalesce(p_buyer_type, buyer_type)
   where id = p_fan_id;
end;
$$;

-- ---- seed the Candace bot ---------------------------------------------------
insert into public.bots(slug, display_name, platform_account)
values ('candace_summers', 'Candace Summers', 'candace_summers')
on conflict (slug) do nothing;

-- ---- convenience view: just Candace's fans ---------------------------------
create or replace view public.candace_fans as
  select f.* from public.fans f
  join public.bots b on b.id = f.bot_id
  where b.slug = 'candace_summers';

-- ---- grants for Supabase roles (skipped automatically on a plain Postgres) --
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role, anon, authenticated;
    grant all on all tables in schema public to service_role;
    grant all on all sequences in schema public to service_role;
    grant execute on all functions in schema public to service_role;
  end if;
end $$;
