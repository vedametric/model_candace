-- Admin dashboard support migration.
-- Adds an automation pause flag the dashboard can toggle per bot.
-- The n8n async workflow gates on this column (see the "Check Paused" node added
-- to automation/n8n/candace_manychat_async.json) so pausing actually stops replies.

alter table public.bots add column if not exists automation_paused boolean not null default false;

-- Helper the dashboard calls to flip the flag (kept as an RPC so the dashboard
-- never needs table-level write grants beyond what service_role already has).
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
