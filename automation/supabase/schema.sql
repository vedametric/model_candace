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
alter table public.bots add column if not exists automation_paused boolean not null default false;  -- admin dashboard pause toggle
alter table public.bots add column if not exists reply_delay jsonb not null default
  '{"min_sec":120,"max_sec":600,"quick_chance":0.15,"quick_min_sec":45,"quick_max_sec":120}'::jsonb;  -- per-persona reply timing (see automation/n8n/REPLY_TIMING.md)

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
  -- contact fields captured from ManyChat (system_firstname/lastname/email/phone, etc.)
  first_name    text,
  last_name     text,
  email         text,
  phone         text,
  subscribed_at text,
  manychat_id   text,                                     -- ManyChat subscriber/contact id
  unique (bot_id, platform, username)
);
-- upgrades:
alter table public.fans add column if not exists first_name text;
alter table public.fans add column if not exists last_name text;
alter table public.fans add column if not exists email text;
alter table public.fans add column if not exists phone text;
alter table public.fans add column if not exists subscribed_at text;
alter table public.fans add column if not exists manychat_id text;
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

-- ---- content-generation request queue (admin dashboard Studio) --------------
-- The dashboard inserts compliant briefs/prompts; a Claude/MCP worker drains the
-- queue. The status machine enforces the start-frame approval gate before any video
-- spend. See generations/WORKER_RUNBOOK.md.
create table if not exists public.gen_requests (
  id            bigint generated always as identity primary key,
  bot_id        bigint references public.bots(id) on delete cascade,
  slug          text not null,
  kind          text not null default 'image',     -- 'image' | 'video'
  video_method  text,                               -- 'seedance' | 'motion_control' | null
  status        text not null default 'queued',     -- queued|generating|awaiting_approval|approved|running_video|done|rejected|failed|canceled
  brief         jsonb not null default '{}'::jsonb,
  prompt        text,
  parent_id     bigint references public.gen_requests(id) on delete set null,
  options       jsonb not null default '[]'::jsonb, -- count:2 results [{job_id,url,picked}]
  approved_job  text,
  driving_video jsonb,
  result        jsonb,
  est_cost_cr   numeric,
  error         text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_gen_requests_bot_status on public.gen_requests(bot_id, status, created_at desc);
alter table public.gen_requests add column if not exists log jsonb not null default '[]'::jsonb;  -- worker progress log

-- worker appends a progress entry (shown live in the dashboard)
create or replace function public.gen_log(p_id bigint, p_stage text, p_msg text)
returns void language plpgsql as $$
begin
  update public.gen_requests
     set log = log || jsonb_build_object('ts', now(), 'stage', p_stage, 'msg', p_msg)
   where id = p_id;
end;
$$;

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
  p_window   int default 10,
  p_first_name text default null, p_last_name text default null, p_email text default null,
  p_phone text default null, p_subscribed text default null, p_subscriber_id text default null
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
  v_paused  boolean;
  v_delay   jsonb;
begin
  -- bot (auto-create if new)
  select id, system_prompt, model, automation_paused, reply_delay
    into v_bot_id, v_prompt, v_model, v_paused, v_delay
    from public.bots where slug = p_bot;
  if v_bot_id is null then
    insert into public.bots(slug, display_name) values (p_bot, p_bot)
    returning id, system_prompt, model, automation_paused, reply_delay
      into v_bot_id, v_prompt, v_model, v_paused, v_delay;
  end if;

  -- fan (upsert + contact fields from ManyChat; coalesce so a later blank never wipes)
  insert into public.fans(bot_id, platform, username, display_name, first_name, last_name, email, phone, subscribed_at, manychat_id)
  values (v_bot_id, p_platform, lower(p_username), nullif(p_display,''), nullif(p_first_name,''),
          nullif(p_last_name,''), nullif(p_email,''), nullif(p_phone,''), nullif(p_subscribed,''), nullif(p_subscriber_id,''))
  on conflict (bot_id, platform, username)
    do update set
      display_name  = coalesce(nullif(excluded.display_name,''),  public.fans.display_name),
      first_name    = coalesce(nullif(excluded.first_name,''),    public.fans.first_name),
      last_name     = coalesce(nullif(excluded.last_name,''),     public.fans.last_name),
      email         = coalesce(nullif(excluded.email,''),         public.fans.email),
      phone         = coalesce(nullif(excluded.phone,''),         public.fans.phone),
      subscribed_at = coalesce(nullif(excluded.subscribed_at,''), public.fans.subscribed_at),
      manychat_id   = coalesce(nullif(excluded.manychat_id,''),   public.fans.manychat_id),
      last_seen     = now()
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
    'model',         coalesce(v_model, 'gpt-4o'),
    'automation_paused', coalesce(v_paused, false),  -- admin dashboard pause flag (see automation/n8n/PAUSE_GATE.md)
    'reply_delay', coalesce(v_delay, '{"min_sec":120,"max_sec":600,"quick_chance":0.15,"quick_min_sec":45,"quick_max_sec":120}'::jsonb)  -- per-persona timing (see automation/n8n/REPLY_TIMING.md)
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

-- Admin dashboard: pause / resume a bot's auto-replies (the n8n flow gates on
-- bots.automation_paused, returned by dm_ingest — see automation/n8n/PAUSE_GATE.md).
create or replace function public.set_automation_paused(p_slug text, p_paused boolean)
returns boolean
language plpgsql
as $$
begin
  update public.bots set automation_paused = p_paused where slug = p_slug;
  insert into public.events(bot_id, type, payload)
  select id, 'automation_paused', jsonb_build_object('paused', p_paused)
    from public.bots where slug = p_slug;
  return p_paused;
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
