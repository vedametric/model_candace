-- ============================================================================
--  Troll / zero-intent detector — config + RPC support
--  Run in the Supabase SQL Editor AFTER schema.sql + the guards/profile
--  migrations. Idempotent, safe to re-run.
--
--  What this does:
--   1. Seeds an admin-editable config block at bots.settings->'troll' with sane
--      defaults (shadow_mode ON). Never clobbers an existing block.
--   2. Redefines dm_ingest to ALSO return `settings` (alongside the existing
--      `guards` + `profile` it already returns), so the n8n "Troll Gate" node
--      can read bots.settings->'troll' in the same round-trip. IMPORTANT: this
--      function keeps guards + profile intact — do not run an older dm_ingest
--      body over this or you will drop the per-persona guards + profile memory.
--   3. Adds dm_set_troll(slug, troll) to merge-write config from the admin panel.
--
--  troll config lives in bots.settings->'troll' (a jsonb key), which is SEPARATE
--  from the bots.guards column used by the persona behaviour guards.
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

-- ---- 2) dm_ingest: return guards + profile (unchanged) + settings (added) ----
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
  v_person_id bigint; v_person_summary text; v_profile jsonb; v_guards jsonb; v_settings jsonb;
begin
  select id, system_prompt, model, automation_paused, reply_delay, guards, settings
    into v_bot_id, v_prompt, v_model, v_paused, v_delay, v_guards, v_settings
    from public.bots where slug = p_bot;
  if v_bot_id is null then
    insert into public.bots(slug, display_name) values (p_bot, p_bot)
    returning id, system_prompt, model, automation_paused, reply_delay, guards, settings
      into v_bot_id, v_prompt, v_model, v_paused, v_delay, v_guards, v_settings;
  end if;

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

  insert into public.messages(fan_id, bot_id, role, content)
  values (v_fan_id, v_bot_id, 'user', p_user_msg);

  update public.fans set msg_count = msg_count + 1, last_seen = now()
   where id = v_fan_id returning summary, stage, msg_count into v_summary, v_stage, v_count;

  select coalesce(jsonb_agg(jsonb_build_object('role', role, 'content', content) order by created_at), '[]'::jsonb)
    into v_recent
  from (select role, content, created_at from public.messages where fan_id = v_fan_id order by created_at desc limit p_window) t;

  select person_id into v_person_id from public.fans where id = v_fan_id;
  if v_person_id is not null then
    select summary into v_person_summary from public.persons where id = v_person_id;
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
    'guards', coalesce(v_guards, '{}'::jsonb),
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
