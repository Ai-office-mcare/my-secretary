-- 내 비서 — 1분마다 알람 함수 부르기 (2026-09-15)
-- ★ 비밀 머리표(x-cron-secret)는 여기 적지 않고 Vault 에 넣습니다. 이 파일은 여러 번 실행해도 안전합니다.
create extension if not exists pg_cron;
create extension if not exists pg_net;
grant usage on schema cron to postgres;
-- 비밀값은 vault 에 (이미 있으면 갱신)
do $$ begin
  if exists (select 1 from vault.secrets where name = 'sec_cron_secret') then
    perform vault.update_secret((select id from vault.secrets where name='sec_cron_secret'), '__CRON_SECRET__');
  else
    perform vault.create_secret('__CRON_SECRET__', 'sec_cron_secret');
  end if;
end $$;
-- 같은 이름의 일정이 있으면 지우고 다시 겁니다
do $$ begin
  if exists (select 1 from cron.job where jobname = 'sec-send-alarms-every-minute') then
    perform cron.unschedule('sec-send-alarms-every-minute');
  end if;
end $$;
select cron.schedule(
  'sec-send-alarms-every-minute',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://nadsaldjxviuvfbzglxl.supabase.co/functions/v1/sec-send-alarms',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sec_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $job$
);
