-- ============================================================
--  내 비서 — 표 · 잠금(RLS) (2026-09-15)
--  ★ 여러 번 실행해도 안전합니다 (if not exists).
--  ★ 모든 표는 본인(auth.uid()) 줄만 보이고 고쳐집니다.
--  되돌리기: drop table if exists public.sec_alarm_log, public.sec_push_subscriptions, public.sec_diary, public.sec_items;
-- ============================================================

create table if not exists public.sec_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 200),
  memo          text not null default '',                 -- 알람 메시지 (언제나 칸이 있음)
  due_at        timestamptz,                              -- 언제 (없으면 알람 없는 메모)
  repeat        text not null default 'none' check (repeat in ('none','daily','weekdays','weekly','monthly')),
  repeat_days   smallint[] not null default '{}',         -- weekly 일 때 요일 (0=일 … 6=토)
  notify        boolean not null default true,
  status        text not null default 'todo' check (status in ('todo','doing','done','closed')),
  next_fire_at  timestamptz,                              -- 다음 울릴 시각 (cron 이 봄)
  last_fired_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists sec_items_user_due on public.sec_items (user_id, due_at);
create index if not exists sec_items_fire on public.sec_items (next_fire_at) where next_fire_at is not null;

create table if not exists public.sec_diary (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day        date not null,
  body       text not null default '',
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);

create table if not exists public.sec_push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  label      text not null default '',
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  fail_count int not null default 0,
  unique (user_id, endpoint)
);

create table if not exists public.sec_alarm_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  item_id    uuid,
  fired_at   timestamptz not null default now(),
  devices    int not null default 0,
  sent       int not null default 0,
  detail     text not null default ''
);

-- updated_at 자동 갱신
create or replace function public.sec_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists sec_items_touch on public.sec_items;
create trigger sec_items_touch before update on public.sec_items for each row execute function public.sec_touch_updated_at();
drop trigger if exists sec_diary_touch on public.sec_diary;
create trigger sec_diary_touch before update on public.sec_diary for each row execute function public.sec_touch_updated_at();

-- 잠금
alter table public.sec_items enable row level security;
alter table public.sec_diary enable row level security;
alter table public.sec_push_subscriptions enable row level security;
alter table public.sec_alarm_log enable row level security;

do $$ begin
  -- sec_items
  if not exists (select 1 from pg_policies where policyname='sec_items_own') then
    create policy sec_items_own on public.sec_items for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where policyname='sec_diary_own') then
    create policy sec_diary_own on public.sec_diary for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where policyname='sec_push_own') then
    create policy sec_push_own on public.sec_push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where policyname='sec_log_own_read') then
    create policy sec_log_own_read on public.sec_alarm_log for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

grant select, insert, update, delete on public.sec_items, public.sec_diary, public.sec_push_subscriptions to authenticated;
grant select on public.sec_alarm_log to authenticated;
