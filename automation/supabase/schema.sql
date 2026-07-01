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
-- per-bot reply pacing + pause toggle (set from the admin dashboard, returned by
-- dm_ingest). data, not code, so each bot/surface is tuned without editing n8n.
alter table public.bots add column if not exists automation_paused boolean not null default false;
alter table public.bots add column if not exists reply_delay jsonb not null default
  '{"min_sec":120,"max_sec":600,"quick_chance":0.15,"quick_min_sec":45,"quick_max_sec":120}'::jsonb;
-- misc per-bot settings (e.g. telegram spice level).
alter table public.bots add column if not exists settings jsonb not null default '{}'::jsonb;
-- behaviour guards, editable from the dashboard Persona page. per-persona jsonb of
-- {greeting_flat, no_question, funnel_stage_note} = {enabled,text} and
-- {age_gate, relationship_gate} = {enabled[,keywords]}. returned by dm_ingest and
-- read by the n8n Build Messages / Apply Profile nodes (which fall back to their
-- built-in defaults when a key is absent). data, not code — no redeploy to tune.
alter table public.bots add column if not exists guards jsonb not null default '{}'::jsonb;

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

-- ---- cross-platform identity -----------------------------------------------
-- a real human, independent of which platform/handle they use. lets Candace on
-- Telegram remember what someone said on TikTok once their fan rows are linked.
-- one person <- many fan rows (tiktok handle, telegram handle, ...).
create table if not exists public.persons (
  id          bigint generated always as identity primary key,
  label       text,                                   -- best-known name/handle
  summary     text   not null default '',             -- cross-platform running memory
  metadata    jsonb  not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
-- link each fan to a person (nullable; filled when you link them in the dashboard)
alter table public.fans add column if not exists person_id bigint references public.persons(id);
create index if not exists idx_fans_person on public.fans(person_id);

-- extra contact fields captured from the source platform (e.g. ManyChat on tiktok).
alter table public.fans add column if not exists first_name   text;
alter table public.fans add column if not exists last_name    text;
alter table public.fans add column if not exists email        text;
alter table public.fans add column if not exists phone        text;
alter table public.fans add column if not exists subscribed_at text;
alter table public.fans add column if not exists manychat_id  text;

-- structured, durable profile the responder's profiler accumulates: a small
-- jsonb of raw facts (name, age, location, occupation, relationship, interests).
-- injected back into every reply so Candace references what she knows. merged
-- cross-platform in dm_ingest (per key, the most-recently-seen linked fan wins).
alter table public.fans add column if not exists profile jsonb not null default '{}'::jsonb;

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
-- NOTE: the canonical production signature is the 12-arg one below. It reads the
-- per-bot automation_paused + reply_delay (the n8n Set Delay node uses them),
-- captures the source-platform contact fields (ManyChat), and returns the linked
-- person's cross-platform summary. n8n calls it by NAME with whichever params it
-- has, so the extra 6 default to null. Do NOT add a second (e.g. 6-arg) overload
-- with these same names or PostgREST can't disambiguate (PGRST203).
create or replace function public.dm_ingest(
  p_bot text, p_platform text, p_username text, p_display text, p_user_msg text,
  p_window integer default 10,
  p_first_name text default null, p_last_name text default null, p_email text default null,
  p_phone text default null, p_subscribed text default null, p_subscriber_id text default null
) returns jsonb
language plpgsql
as $$
declare
  v_bot_id bigint; v_fan_id bigint; v_summary text; v_stage text; v_count int;
  v_recent jsonb; v_prompt text; v_model text; v_paused boolean; v_delay jsonb;
  v_person_id bigint; v_person_summary text; v_profile jsonb; v_guards jsonb;
begin
  -- bot (auto-create if new)
  select id, system_prompt, model, automation_paused, reply_delay, guards
    into v_bot_id, v_prompt, v_model, v_paused, v_delay, v_guards
    from public.bots where slug = p_bot;
  if v_bot_id is null then
    insert into public.bots(slug, display_name) values (p_bot, p_bot)
    returning id, system_prompt, model, automation_paused, reply_delay, guards
      into v_bot_id, v_prompt, v_model, v_paused, v_delay, v_guards;
  end if;

  -- fan (upsert) + source-platform contact fields
  insert into public.fans(bot_id, platform, username, display_name, first_name, last_name, email, phone, subscribed_at, manychat_id)
  values (v_bot_id, p_platform, lower(p_username), nullif(p_display,''), nullif(p_first_name,''),
          nullif(p_last_name,''), nullif(p_email,''), nullif(p_phone,''), nullif(p_subscribed,''), nullif(p_subscriber_id,''))
  on conflict (bot_id, platform, username)
    do update set
      display_name = coalesce(nullif(excluded.display_name,''), public.fans.display_name),
      first_name   = coalesce(nullif(excluded.first_name,''),   public.fans.first_name),
      last_name    = coalesce(nullif(excluded.last_name,''),    public.fans.last_name),
      email        = coalesce(nullif(excluded.email,''),        public.fans.email),
      phone        = coalesce(nullif(excluded.phone,''),        public.fans.phone),
      subscribed_at= coalesce(nullif(excluded.subscribed_at,''),public.fans.subscribed_at),
      manychat_id  = coalesce(nullif(excluded.manychat_id,''),  public.fans.manychat_id),
      last_seen    = now()
  returning id into v_fan_id;

  -- log inbound message
  insert into public.messages(fan_id, bot_id, role, content)
  values (v_fan_id, v_bot_id, 'user', p_user_msg);

  -- counters
  update public.fans set msg_count = msg_count + 1, last_seen = now()
   where id = v_fan_id returning summary, stage, msg_count into v_summary, v_stage, v_count;

  -- recent window, chronological
  select coalesce(jsonb_agg(jsonb_build_object('role', role, 'content', content) order by created_at), '[]'::jsonb)
    into v_recent
  from (select role, content, created_at from public.messages where fan_id = v_fan_id order by created_at desc limit p_window) t;

  -- cross-platform memory: linked person's running summary (manual links)
  select person_id into v_person_id from public.fans where id = v_fan_id;
  if v_person_id is not null then
    select summary into v_person_summary from public.persons where id = v_person_id;
    -- cross-platform profile: per key, value from the most-recently-seen linked fan
    select coalesce((
      select jsonb_object_agg(key, value)
      from (
        select key, value, row_number() over (partition by key order by f.last_seen desc) rn
        from public.fans f, lateral jsonb_each(coalesce(f.profile,'{}'::jsonb))
        where f.person_id = v_person_id
      ) x where rn = 1
    ), '{}'::jsonb) into v_profile;
  else
    select profile into v_profile from public.fans where id = v_fan_id;
  end if;

  -- audit
  insert into public.events(bot_id, fan_id, type, payload)
  values (v_bot_id, v_fan_id, 'inbound_message',
          jsonb_build_object('platform', p_platform, 'username', lower(p_username)));

  return jsonb_build_object(
    'bot_id', v_bot_id, 'fan_id', v_fan_id,
    'summary', coalesce(v_summary, ''), 'stage', coalesce(v_stage, 'rapport'),
    'count', v_count, 'recent', v_recent,
    'system_prompt', coalesce(v_prompt, ''), 'model', coalesce(v_model, 'gpt-4o'),
    'automation_paused', coalesce(v_paused, false),
    'reply_delay', coalesce(v_delay, '{"min_sec":120,"max_sec":600,"quick_chance":0.15,"quick_min_sec":45,"quick_max_sec":120}'::jsonb),
    'person_id', v_person_id,
    'person_summary', coalesce(v_person_summary, ''),
    'profile', coalesce(v_profile, '{}'::jsonb),
    'guards', coalesce(v_guards, '{}'::jsonb)
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

-- ============================================================================
--  Cross-platform identity RPCs (manual sync from the admin dashboard)
-- ============================================================================

-- Link two fan rows (e.g. a tiktok fan and a telegram fan) to the same person.
-- Reuses an existing person if either side already has one, else creates one.
-- If the person has no summary yet, seeds it from the two fans' summaries so the
-- bot immediately "knows" the cross-platform history. Returns the person.
create or replace function public.dm_link_person(
  p_fan_id       bigint,
  p_other_fan_id bigint
) returns jsonb
language plpgsql
as $$
declare
  v_person_id bigint;
  v_a_person  bigint; v_b_person bigint;
  v_a_sum text; v_b_sum text; v_a_label text; v_b_label text;
  v_merged text;
begin
  select person_id, summary, platform || ' @' || username
    into v_a_person, v_a_sum, v_a_label
    from public.fans where id = p_fan_id;
  select person_id, summary, platform || ' @' || username
    into v_b_person, v_b_sum, v_b_label
    from public.fans where id = p_other_fan_id;

  v_person_id := coalesce(v_a_person, v_b_person);
  if v_person_id is null then
    insert into public.persons(label, summary)
    values (coalesce(v_a_label, v_b_label), '')
    returning id into v_person_id;
  end if;

  -- attach both fans to the person
  update public.fans set person_id = v_person_id
   where id in (p_fan_id, p_other_fan_id);

  -- seed cross-platform memory only if the person summary is still empty
  -- (never clobber a summary you've already curated by hand)
  select summary into v_merged from public.persons where id = v_person_id;
  if v_merged is null or length(btrim(v_merged)) = 0 then
    v_merged := '';
    if coalesce(v_a_sum, '') <> '' then
      v_merged := '[' || v_a_label || '] ' || v_a_sum;
    end if;
    if coalesce(v_b_sum, '') <> '' then
      v_merged := case when v_merged = '' then '' else v_merged || E'\n' end
                  || '[' || v_b_label || '] ' || v_b_sum;
    end if;
    update public.persons set summary = v_merged where id = v_person_id;
  end if;

  insert into public.events(type, payload)
  values ('person_linked', jsonb_build_object(
    'person_id', v_person_id, 'fans', jsonb_build_array(p_fan_id, p_other_fan_id)));

  return jsonb_build_object('person_id', v_person_id, 'summary', v_merged);
end;
$$;

-- Detach a fan from its person (undo a link).
create or replace function public.dm_unlink_fan(p_fan_id bigint)
returns void
language plpgsql
as $$
begin
  update public.fans set person_id = null where id = p_fan_id;
  insert into public.events(fan_id, type, payload)
  values (p_fan_id, 'person_unlinked', jsonb_build_object('fan_id', p_fan_id));
end;
$$;

-- Edit a person's cross-platform memory note by hand.
create or replace function public.dm_set_person_summary(
  p_person_id bigint,
  p_summary   text
) returns void
language plpgsql
as $$
begin
  update public.persons set summary = p_summary where id = p_person_id;
  insert into public.events(type, payload)
  values ('person_summary_updated', jsonb_build_object('person_id', p_person_id));
end;
$$;

-- Rebuild a linked person's cross-platform memory from all their fan rows'
-- current summaries. Called by the responders after each profile update so the
-- shared memory (incl. accumulated raw facts) stays fresh, not frozen at link
-- time. No-op if the fan isn't linked.
create or replace function public.dm_refresh_person(p_fan_id bigint)
returns void
language plpgsql
as $$
declare
  v_person_id bigint;
  v_merged    text;
begin
  select person_id into v_person_id from public.fans where id = p_fan_id;
  if v_person_id is null then return; end if;
  select string_agg('[' || platform || ' @' || username || '] ' || summary, E'\n' order by platform, username)
    into v_merged
    from public.fans
   where person_id = v_person_id and coalesce(btrim(summary), '') <> '';
  update public.persons set summary = coalesce(v_merged, '') where id = v_person_id;
end;
$$;

-- ---- seed the Candace bot ---------------------------------------------------
insert into public.bots(slug, display_name, platform_account)
values ('candace_summers', 'Candace Summers', 'candace_summers')
on conflict (slug) do nothing;

-- candace_summers reply pacing comes from the bots.reply_delay column default
-- (120-600s, ~15% quick 45-120s) — the same values the TikTok workflow uses.
-- Telegram overrides its own reply_delay in candace_telegram.sql.

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
