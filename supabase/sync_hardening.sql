-- Chace, health — 동기화 안정화 (health_external_metrics)
--
-- 왜 필요한가
--   Apple 건강 → Supabase 동기화는 ChatGPT 자동화("건강앱 통합 동기화")가 직접 upsert 한다.
--   그 자동화가 멈췄다가 다시 돌면 최근 며칠을 다시 읽어 넣는다. 이때
--     * 하루 걸음/거리 합계를 "동기화 시각" 으로 기록하면 실행마다 합계 행이 새로 생긴다
--       (PK 가 (profile_id, recorded_at, source, metric) 이라 시각이 다르면 다른 행이다).
--     * 체중이 lb 로 들어오면 화면이 kg 과 섞인다.
--   이 스크립트는 "누가 어떻게 넣든" DB 가 스스로 한 날 한 행으로 맞추게 한다.
--
-- 이 스크립트가 하는 것
--   1) 넣기 전(BEFORE INSERT) 트리거:
--      * Apple Health 의 stepCount / distanceWalkingRunning 합계 행(aggregation='daily_sum')은
--        recorded_at 을 그 날 LA 0시로 고정한다 → 같은 날은 항상 같은 PK.
--        그 날의 고정 행이 이미 있으면 그 행을 새 값으로 고치고, 새 행은 만들지 않는다.
--        (평범한 INSERT 로 와도, upsert 로 와도 똑같이 한 행만 남는다)
--        complete_day 는 날짜로 정한다: 오늘 = false, 지난 날 = true.
--      * bodyMass / leanBodyMass 가 lb·g 로 오면 kg 으로 바꾸고, 원래 값은 metadata 에 남긴다.
--      * source 는 건드리지 않는다 ("RENPHO Health" 는 그대로 "RENPHO Health").
--   2) 고칠 때(BEFORE UPDATE) 트리거: updated_at 을 지금 시각으로 — 마지막 동기화 시각의 근거.
--
-- 이 스크립트가 하지 않는 것
--   * 기존 행을 지우거나 고치지 않는다. 트리거는 이후 새로 들어오는 값에만 작동한다.
--     (예전에 하루에 여러 개 쌓인 합계 행은 그대로 둔다. 앱이 가장 나중 것 하나만 쓴다)
--   * 원시 샘플을 더하지 않는다. 합계는 동기화가 보낸 값 그대로다.
--   * Apple 건강을 직접 읽지 않는다 (Supabase 는 읽을 수 없다). Cron / Edge Function 없음.
--
-- 다시 실행해도 안전하다 (create or replace / drop trigger if exists).
-- 실행 방법: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run.

create or replace function public.chace_metrics_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tz    constant text := 'America/Los_Angeles';
  d     date;
  canon timestamptz;
  f     numeric;
begin
  -- 1) 하루 합계 행 → 그 날 LA 0시 한 행으로
  if new.source = 'Apple Health'
     and new.metric in ('stepCount', 'distanceWalkingRunning')
     and coalesce(new.metadata->>'aggregation', '') = 'daily_sum' then

    d := coalesce(
      case when new.metadata->>'local_date' ~ '^\d{4}-\d{2}-\d{2}$'
           then (new.metadata->>'local_date')::date end,
      (new.recorded_at at time zone tz)::date);
    canon := d::timestamp at time zone tz;

    new.recorded_at := canon;
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'local_date',   to_char(d, 'YYYY-MM-DD'),
      'complete_day', d < (now() at time zone tz)::date,
      'timezone',     tz,
      'canonical_daily', true);

    update health_external_metrics
       set value = new.value, unit = new.unit, metadata = new.metadata, updated_at = now()
     where profile_id = new.profile_id and source = new.source
       and metric = new.metric and recorded_at = canon;
    if found then
      return null;  -- 이미 있는 그 날의 행을 고쳤다. 새 행은 만들지 않는다.
    end if;
  end if;

  -- 2) 체중·제지방은 kg 으로
  if new.metric in ('bodyMass', 'leanBodyMass') then
    f := case lower(btrim(coalesce(new.unit, '')))
           when 'lb' then 0.45359237 when 'lbs' then 0.45359237
           when 'pound' then 0.45359237 when 'pounds' then 0.45359237
           when 'g' then 0.001
         end;
    if f is not null and new.value is not null then
      new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
        'original_value', new.value, 'original_unit', new.unit);
      new.value := round(new.value * f, 2);
      new.unit  := 'kg';
    end if;
  end if;

  new.updated_at := now();
  return new;
end
$$;

create or replace function public.chace_metrics_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists chace_metrics_before_insert on public.health_external_metrics;
create trigger chace_metrics_before_insert
  before insert on public.health_external_metrics
  for each row execute function public.chace_metrics_before_insert();

drop trigger if exists chace_metrics_touch on public.health_external_metrics;
create trigger chace_metrics_touch
  before update on public.health_external_metrics
  for each row execute function public.chace_metrics_touch();

-- 트리거 함수는 직접 부를 일이 없다.
revoke all on function public.chace_metrics_before_insert() from public, anon, authenticated;
revoke all on function public.chace_metrics_touch() from public, anon, authenticated;
