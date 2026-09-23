-- Chace, health — 단축어에서 최신값을 넣는 통로
--
-- 왜 필요한가
--   앱은 DB 에 있는 최신값을 보여 준다. 그런데 DB 로 넣어 주는 동기화가 가끔만 돌아서,
--   Apple 건강·RENPHO 앱과 숫자가 어긋났다. 웹앱은 Apple 건강을 직접 읽을 수 없다.
--   iOS 단축어는 읽을 수 있으므로, 단축어가 읽어서 이 함수로 넣는다.
--   RENPHO 는 체중·체지방을 Apple 건강에 써 넣으므로 단축어 하나로 둘 다 된다.
--
-- 이 함수가 하는 것
--   * 받은 값을 health_external_metrics 에 "추가" 만 한다. 지우거나 고치지 않는다.
--   * 같은 측정(같은 종류·같은 시각)이 이미 있으면 다시 넣지 않는다.
--   * 오늘 걸음수는 하루 합계 행으로 넣는다. 값이 그대로면 넣지 않는다.
--   * 아래 profile_id 한 사람에게만 넣는다. 다른 사람의 행은 만들 수 없다.
--
-- 입력을 전부 text 로 받는 이유
--   단축어는 숫자에 단위를 붙여 보내거나("78.2 kg"), 체지방률을 0.132 로 보내기도 한다.
--   숫자로 받으면 그런 값에서 호출 자체가 실패하므로, 받은 뒤 여기서 숫자를 뽑아낸다.
--
-- 실행 방법
--   Supabase 대시보드 → SQL Editor → 아래 전체를 붙여넣고 Run.

-- 문자열에서 첫 번째 숫자를 뽑는다 ("78.2 kg" → 78.2, "3,269" → 3269). 없으면 null.
create or replace function public.chace_num(t text)
returns numeric
language sql
immutable
as $$
  select nullif(substring(replace(coalesce(t, ''), ',', '') from '-?[0-9]+(?:\.[0-9]+)?'), '')::numeric
$$;

-- 시각 문자열을 timestamptz 로. 못 읽으면 null (호출 전체를 실패시키지 않는다).
--
-- 시간대 표시(Z, +09:00, -07 등)가 없는 시각은 LA 기준으로 읽는다.
-- 그냥 캐스팅하면 DB 세션 시간대(UTC)로 읽혀서 7시간이 어긋난다.
-- 예: 'Sep 23, 2026 at 1:10 PM' → UTC 13:10 = LA 오전 6:10 (틀림)
create or replace function public.chace_ts(t text)
returns timestamptz
language plpgsql
stable
as $$
declare
  s text := btrim(coalesce(t, ''));
  m text[];
  h int;
begin
  if s = '' then return null; end if;
  if s ~* '(z|[+-][0-9]{2}(:?[0-9]{2})?)$' then
    return s::timestamptz;
  end if;

  -- 한국어 설정의 아이폰: '2026. 9. 23. 오후 1:10'
  m := regexp_match(s, '^([0-9]{4})\.\s*([0-9]{1,2})\.\s*([0-9]{1,2})\.?\s*(오전|오후)\s*([0-9]{1,2}):([0-9]{2})');
  if m is not null then
    h := m[5]::int % 12 + case when m[4] = '오후' then 12 else 0 end;
    return make_timestamp(m[1]::int, m[2]::int, m[3]::int, h, m[6]::int, 0)
           at time zone 'America/Los_Angeles';
  end if;

  return (replace(s, ' at ', ' ')::timestamp) at time zone 'America/Los_Angeles';
exception when others then
  return null;
end
$$;

create or replace function public.chace_health_push(
  steps          text default null,
  heart_rate     text default null,
  heart_rate_at  text default null,
  weight         text default null,
  weight_at      text default null,
  body_fat       text default null,
  bmi            text default null,
  lean_mass      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pid        constant uuid := '6eb29763-315a-46b7-bcf7-da24b8f1503e';
  tz         constant text := 'America/Los_Angeles';
  now_ts     timestamptz := now();
  today      text := to_char(now() at time zone tz, 'YYYY-MM-DD');
  added      int := 0;
  v          numeric;
  at_ts      timestamptz;
  last_steps numeric;
begin
  -- 공통: 한 행 넣기. 같은 (종류, 시각)이 이미 있으면 건너뛴다.
  -- (지역 함수가 없어 반복 블록으로 쓴다)

  -- 1) 오늘 걸음수 — 하루 합계. 직전 합계와 같으면 넣지 않는다.
  v := chace_num(steps);
  if v is not null and v >= 0 and v < 200000 then
    select value into last_steps
      from health_external_metrics
     where profile_id = pid and source = 'Apple Health' and metric = 'stepCount'
       and metadata->>'local_date' = today
       and metadata->>'aggregation' = 'daily_sum'
     order by recorded_at desc
     limit 1;

    if last_steps is distinct from v then
      insert into health_external_metrics (profile_id, recorded_at, source, metric, value, unit, metadata)
      values (pid, now_ts, 'Apple Health', 'stepCount', v, 'count', jsonb_build_object(
        'local_date', today,
        'local_time', to_char(now_ts at time zone tz, 'HH24:MI:SS'),
        'aggregation', 'daily_sum',
        'complete_day', false,
        'synced_local_time', to_char(now_ts at time zone tz, 'YYYY-MM-DD"T"HH24:MI:SS'),
        'timezone', tz,
        'source', 'Chace shortcut'));
      added := added + 1;
    end if;
  end if;

  -- 2) 심박수 — 측정 시각 그대로.
  v := chace_num(heart_rate);
  at_ts := coalesce(chace_ts(heart_rate_at), now_ts);
  if v is not null and v between 20 and 250 and not exists (
       select 1 from health_external_metrics
        where profile_id = pid and source = 'Apple Health' and metric = 'heartRate'
          and recorded_at = at_ts) then
    insert into health_external_metrics (profile_id, recorded_at, source, metric, value, unit, metadata)
    values (pid, at_ts, 'Apple Health', 'heartRate', v, 'count/min', jsonb_build_object(
      'local_date', to_char(at_ts at time zone tz, 'YYYY-MM-DD'),
      'local_time', to_char(at_ts at time zone tz, 'HH24:MI:SS'),
      'synced_local_time', to_char(now_ts at time zone tz, 'YYYY-MM-DD"T"HH24:MI:SS'),
      'timezone', tz,
      'source', 'Chace shortcut'));
    added := added + 1;
  end if;

  -- 3) 체성분 (RENPHO 가 Apple 건강에 써 넣은 값) — 체중 측정 시각을 넷이 공유한다.
  at_ts := coalesce(chace_ts(weight_at), now_ts);

  -- 체중
  v := chace_num(weight);
  if v is not null and v between 20 and 300 and not exists (
       select 1 from health_external_metrics
        where profile_id = pid and source = 'RENPHO Health' and metric = 'bodyMass'
          and recorded_at = at_ts) then
    insert into health_external_metrics (profile_id, recorded_at, source, metric, value, unit, metadata)
    values (pid, at_ts, 'RENPHO Health', 'bodyMass', v, 'kg', jsonb_build_object(
      'local_date', to_char(at_ts at time zone tz, 'YYYY-MM-DD'),
      'local_time', to_char(at_ts at time zone tz, 'HH24:MI:SS'),
      'timezone', tz, 'source', 'Chace shortcut'));
    added := added + 1;
  end if;

  -- 체지방률 — 0.132 처럼 비율로 오면 13.2 로 바꾼다.
  v := chace_num(body_fat);
  if v is not null and v > 0 and v < 1 then v := round(v * 100, 2); end if;
  if v is not null and v between 1 and 70 and not exists (
       select 1 from health_external_metrics
        where profile_id = pid and source = 'RENPHO Health' and metric = 'bodyFatPercentage'
          and recorded_at = at_ts) then
    insert into health_external_metrics (profile_id, recorded_at, source, metric, value, unit, metadata)
    values (pid, at_ts, 'RENPHO Health', 'bodyFatPercentage', v, '%', jsonb_build_object(
      'local_date', to_char(at_ts at time zone tz, 'YYYY-MM-DD'),
      'local_time', to_char(at_ts at time zone tz, 'HH24:MI:SS'),
      'timezone', tz, 'source', 'Chace shortcut'));
    added := added + 1;
  end if;

  -- BMI
  v := chace_num(bmi);
  if v is not null and v between 10 and 60 and not exists (
       select 1 from health_external_metrics
        where profile_id = pid and source = 'RENPHO Health' and metric = 'bodyMassIndex'
          and recorded_at = at_ts) then
    insert into health_external_metrics (profile_id, recorded_at, source, metric, value, unit, metadata)
    values (pid, at_ts, 'RENPHO Health', 'bodyMassIndex', v, 'unitless', jsonb_build_object(
      'local_date', to_char(at_ts at time zone tz, 'YYYY-MM-DD'),
      'local_time', to_char(at_ts at time zone tz, 'HH24:MI:SS'),
      'timezone', tz, 'source', 'Chace shortcut'));
    added := added + 1;
  end if;

  -- 제지방
  v := chace_num(lean_mass);
  if v is not null and v between 10 and 200 and not exists (
       select 1 from health_external_metrics
        where profile_id = pid and source = 'RENPHO Health' and metric = 'leanBodyMass'
          and recorded_at = at_ts) then
    insert into health_external_metrics (profile_id, recorded_at, source, metric, value, unit, metadata)
    values (pid, at_ts, 'RENPHO Health', 'leanBodyMass', v, 'kg', jsonb_build_object(
      'local_date', to_char(at_ts at time zone tz, 'YYYY-MM-DD'),
      'local_time', to_char(at_ts at time zone tz, 'HH24:MI:SS'),
      'timezone', tz, 'source', 'Chace shortcut'));
    added := added + 1;
  end if;

  return jsonb_build_object('ok', true, 'added', added, 'at', now_ts);
end
$$;

-- 이 함수만 anon 에게 연다. 테이블 권한과 RLS 는 그대로 둔다.
revoke all on function public.chace_health_push(text, text, text, text, text, text, text, text) from public;
grant execute on function public.chace_health_push(text, text, text, text, text, text, text, text) to anon, authenticated;
