-- ============================================================================
--  Fan steering + reply hold — dashboard fan-page / queue controls
--  Run in the Supabase SQL Editor. Idempotent, safe to re-run.
--
--   * director_note: a hidden instruction a human sets on the fan page. The
--     ManyChat responder's Build Messages node injects it as a high-priority
--     system message (read via the get-fan node), so it steers her next replies
--     without being sent to the fan. Cleared with an empty string.
--   * send_after: a timestamp the dashboard "+15m" button pushes forward. The
--     responder's Hold gate (after the human-delay wait) waits until this time
--     before sending, so a human can delay a specific fan's next auto-reply.
-- ============================================================================

alter table public.fans add column if not exists director_note text;
alter table public.fans add column if not exists send_after timestamptz;
-- next_directive: a ONE-SHOT steer applied to the very next reply, then the
-- responder clears it. (director_note is the persistent/standing version.)
alter table public.fans add column if not exists next_directive text;

create or replace function public.dm_set_next_directive(p_fan_id bigint, p_note text)
returns void language plpgsql as $$
begin
  update public.fans set next_directive = nullif(btrim(p_note), '') where id = p_fan_id;
  insert into public.events(fan_id, type, payload)
  values (p_fan_id, 'next_directive_set', jsonb_build_object('len', coalesce(length(p_note),0)));
end; $$;

-- set/clear the director's note.
create or replace function public.dm_set_director_note(p_fan_id bigint, p_note text)
returns void language plpgsql as $$
begin
  update public.fans set director_note = nullif(btrim(p_note), '') where id = p_fan_id;
  insert into public.events(fan_id, type, payload)
  values (p_fan_id, 'director_note_set', jsonb_build_object('len', coalesce(length(p_note),0)));
end; $$;

-- add N minutes to a fan's hold (from the later of now / existing send_after).
create or replace function public.dm_add_hold(p_fan_id bigint, p_minutes int)
returns timestamptz language plpgsql as $$
declare v_new timestamptz;
begin
  update public.fans
     set send_after = greatest(coalesce(send_after, now()), now()) + make_interval(mins => p_minutes)
   where id = p_fan_id
   returning send_after into v_new;
  insert into public.events(fan_id, type, payload)
  values (p_fan_id, 'hold_extended', jsonb_build_object('minutes', p_minutes, 'send_after', v_new));
  return v_new;
end; $$;

-- cancel a pending/waiting auto-reply: bump msg_count so the waiting responder
-- execution aborts at its "Check Latest" debounce gate and sends nothing (the
-- human then takes over with "Send as Candace"). Dashboard: queue "✕ cancel".
create or replace function public.dm_cancel_pending_reply(p_fan_id bigint)
returns bigint language plpgsql as $$
declare v_count int;
begin
  update public.fans set msg_count = msg_count + 1 where id = p_fan_id returning msg_count into v_count;
  insert into public.events(fan_id, type, payload)
  values (p_fan_id, 'reply_cancelled', jsonb_build_object('msg_count', v_count));
  return v_count;
end; $$;

-- "Play hard to get": ignore a fan's next N inbound messages (log, don't reply).
-- fans.ignore_count is consumed per-inbound by the responders' "Ignore gate"
-- (dm_take_ignore) right after dm_ingest; dashboard fan page sets it.
alter table public.fans add column if not exists ignore_count int not null default 0;

create or replace function public.dm_set_ignore(p_fan_id bigint, p_n int)
returns int language plpgsql as $$
declare v int;
begin
  update public.fans set ignore_count = greatest(0, coalesce(p_n,0)) where id = p_fan_id returning ignore_count into v;
  insert into public.events(fan_id, type, payload) values (p_fan_id, 'ignore_set', jsonb_build_object('n', v));
  return v;
end; $$;

create or replace function public.dm_take_ignore(p_fan_id bigint)
returns jsonb language plpgsql as $$
declare v int;
begin
  select ignore_count into v from public.fans where id = p_fan_id;
  if coalesce(v,0) > 0 then
    update public.fans set ignore_count = ignore_count - 1 where id = p_fan_id;
    return jsonb_build_object('skip', true, 'remaining', v - 1);
  end if;
  return jsonb_build_object('skip', false, 'remaining', 0);
end; $$;

-- Cancel a specific queued reply from the queue page: bump msg_count (abort the
-- waiting execution at its debounce gate) AND write a dm_cancelled marker keyed
-- to that queued message's count so the queue UI shows it as cancelled.
create or replace function public.dm_cancel_queued(p_fan_id bigint, p_queued_count int)
returns bigint language plpgsql as $$
declare v_count int;
begin
  update public.fans set msg_count = msg_count + 1 where id = p_fan_id returning msg_count into v_count;
  insert into public.events(fan_id, type, payload)
  values (p_fan_id, 'dm_cancelled', jsonb_build_object('msg_count', p_queued_count));
  return v_count;
end; $$;
