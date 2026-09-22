-- Automatic retry for rulings/legislation whose AI brief never completed (upload succeeded but
-- generation failed or was never run, e.g. Gemini was overloaded) — runs every 15 minutes via
-- pg_cron, calling the process-pending-rulings edge function.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- A small locked-down secret store: RLS is enabled with no policies at all, so it's completely
-- unreachable through the client API (PostgREST) for any role — only server-side callers that
-- bypass RLS (the table owner running this cron job, or a service-role client) can ever read it.
create table if not exists system_secrets (
  name text primary key,
  value text not null
);
alter table system_secrets enable row level security;

insert into system_secrets (name, value)
values ('cron_shared_secret', encode(gen_random_bytes(24), 'hex'))
on conflict (name) do nothing;

select cron.schedule(
  'process-pending-rulings',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://rgkxftfbdfnzcbykmurx.supabase.co/functions/v1/process-pending-rulings',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (select value from system_secrets where name = 'cron_shared_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
