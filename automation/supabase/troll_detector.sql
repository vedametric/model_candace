-- ============================================================================
--  Troll / zero-intent detector — config + RPC support
--  Run in the Supabase SQL Editor AFTER schema.sql. Idempotent, safe to re-run.
--
--  What this does:
--   1. Seeds an admin-editable config block at bots.settings->'troll' with sane
--      defaults (shadow_mode ON, so it observes without changing behaviour until
--      you flip it off from the admin panel). Never clobbers an existing block.
--   2. Redefines dm_ingest to also return `settings`, so the n8n "Troll Gate"
--      node can read bots.settings->'troll' in the same round-trip it already
--      makes. Additive only — the 12-arg signature is unchanged.
--
--  All weights/thresholds live in data (bots.settings), NOT in the workflow, so
--  they can be tuned live from the admin panel (candace_troll_config.html) with
--  no redeploy.
-- ============================================================================

-- ---- 1) seed default troll config on every bot that doesn't have one --------
update public.bots
   set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('troll', jsonb_build_object(
     'enabled', true,
     'shadow_mode', true,            -- observe + log only; flip to false to arm
     'decay', 0.85,                  -- prior score carried forward each turn
     'bot_test_after_turn', 3,       -- "are you ai" only counts after this many turns
     'minimal_reply_chance', 0.5,    -- at 'minimal' mode, chance she replies at all
     'weights', jsonb_build_object(
        'bot_test_repeat', 12, 'mockery', 10, 'perform_first', 12, 'empty_money', 10,
        'proof_demand', 8, 'nonsense', 6, 'zero_intent', 15, 'stall_hit', 15,
        'hostility_floor', 90),
     'cooldown', jsonb_build_object(
        'personal_disclosure', 15, 'concrete_step', 20, 'vulnerable', 10),
     'bands', jsonb_build_object('cool', 30, 'minimal', 60, 'ghost', 85),
     'stall_ladder', jsonb_build_object('callout_at', 2, 'minimal_at', 3, 'ghost_at', 4),
     'delay_penalty', jsonb_build_object(
        'cool_sec', 45, 'minimal_base_sec', 120, 'minimal_per_stall_sec', 90)
   ))
 where not (coalesce(settings, '{}'::jsonb) ? 'troll');

-- ---- 2) dm_ingest: also return the bot's settings (for the Troll Gate) -------
--  Identical to schema.sql's canonical 12-arg dm_ingest, with `settings` added
--  to the bot read and to the returned jsonb. Nothing else changes.
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
  v_person_id bigint; v_person_summary text; v_settings jsonb;
begin
  -- bot (auto-create if new)
  select id, system_prompt, model, automation_paused, reply_delay, settings
    into v_bot_id, v_prompt, v_model, v_paused, v_delay, v_settings
    from public.bots where slug = p_bot;
  if v_bot_id is null then
    insert into public.bots(slug, display_name) values (p_bot, p_bot)
    returning id, system_prompt, model, automation_paused, reply_delay, settings
      into v_bot_id, v_prompt, v_model, v_paused, v_delay, v_settings;
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
    'settings', coalesce(v_settings, '{}'::jsonb)
  );
end;
$$;

-- ---- 3) admin write RPC: merge-write troll config without clobbering others -
create or replace function public.dm_set_troll(
  p_slug  text,
  p_troll jsonb
) returns jsonb
language plpgsql
as $$
declare v_settings jsonb;
begin
  update public.bots
     set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('troll', p_troll)
   where slug = p_slug
   returning settings into v_settings;
  insert into public.events(type, payload)
  values ('troll_config_updated', jsonb_build_object('slug', p_slug));
  return coalesce(v_settings, '{}'::jsonb);
end;
$$;

-- ---- verify -----------------------------------------------------------------
-- select slug, settings->'troll'->>'shadow_mode' as shadow, settings->'troll'->'bands' as bands
-- from public.bots;
