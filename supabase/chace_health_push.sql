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
-- 단축어가 읽을 것은 4개면 된다 (걸음, 심박수, 체중, 체지방률).
--   제지방은 체중 × (1 − 체지방률) 로, BMI 는 체중 ÷ 키² 로 계산해 채운다.
--   키는 RENPHO 가 실제로 잰 BMI 기록에서 구한다. 계산한 행에는 metadata.derived = true.
--   측정 시각도 안 보내도 된다. 그 경우 직전 값과 같으면 새 측정이 아니라고 보고 넣지 않는다.
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
  last_v     numeric;
  w          numeric;   -- 이번 체중
  f          numeric;   -- 이번 체지방률 (%)
  h2         numeric;   -- 키의 제곱 (BMI 계산용)
  body_new   boolean := true;
  bmi_calc   boolean := false;  -- BMI 를 계산으로 채웠는지
  lean_calc  boolean := false;  -- 제지방을 계산으로 채웠는지
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

  -- 2) 심박수 — 측정 시각이 오면 그대로 쓴다.
  --    시각 없이 오면(단축어를 짧게 만든 경우) 지금 시각으로 넣되,
  --    직전 값과 같으면 새 측정이 아니라고 보고 넣지 않는다.
  v := chace_num(heart_rate);
  at_ts := chace_ts(heart_rate_at);
  if at_ts is null then
    select value into last_v from health_external_metrics
     where profile_id = pid and source = 'Apple Health' and metric = 'heartRate'
     order by recorded_at desc limit 1;
    if last_v is not distinct from v then v := null; end if;
    at_ts := now_ts;
  end if;
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
  w := chace_num(weight);
  f := chace_num(body_fat);
  if f is not null and f > 0 and f < 1 then f := round(f * 100, 2); end if;

  at_ts := chace_ts(weight_at);
  if at_ts is null then
    -- 시각 없이 왔으면, 직전 체중과 같을 때 새 측정이 아니라고 본다.
    select value into last_v from health_external_metrics
     where profile_id = pid and source = 'RENPHO Health' and metric = 'bodyMass'
     order by recorded_at desc limit 1;
    if last_v is not distinct from w then body_new := false; end if;
    at_ts := now_ts;
  end if;

  -- BMI·제지방이 안 오면 계산한다. (단축어가 읽을 항목을 4개로 줄이기 위함)
  --   제지방 = 체중 × (1 − 체지방률)   — 기존 기록과 일치 (78.3×0.868=67.96, 77.8×0.869=67.61)
  --   BMI   = 체중 ÷ 키²              — 키는 기존 체중·BMI 쌍에서 구한다 (없으면 1.805m)
  if body_new and w is not null then
    if chace_num(lean_mass) is null and f is not null then
      lean_mass := round(w * (1 - f / 100), 2)::text;
      lean_calc := true;
    end if;
    if chace_num(bmi) is null then
      -- 키는 RENPHO 가 실제로 잰 BMI 에서만 구한다. 우리가 계산해 넣은 BMI 로 다시 키를
      -- 구하면 반올림 오차가 쌓여 값이 조금씩 흘러간다.
      -- 한 쌍만 쓰면 BMI 가 소수 첫째 자리로 반올림돼 있어서 키가 조금 틀어진다
      -- (77.8/23.9 로 잡으면 78.3kg 이 24.1 이 되는데 RENPHO 는 24.0). 실측 기록 전체의
      -- 평균을 쓰면 반올림 오차가 상쇄돼 RENPHO 값에 가까워진다.
      select avg(m.value / b.value) into h2
        from health_external_metrics m
        join health_external_metrics b
          on b.profile_id = m.profile_id and b.recorded_at = m.recorded_at
         and b.source = 'RENPHO Health' and b.metric = 'bodyMassIndex' and b.value > 0
         and coalesce((b.metadata->>'derived')::boolean, false) = false
       where m.profile_id = pid and m.source = 'RENPHO Health' and m.metric = 'bodyMass'
         and m.recorded_at > now() - interval '180 days';
      bmi := round(w / coalesce(h2, 1.805 * 1.805), 1)::text;
      bmi_calc := true;
    end if;
  end if;

  if not body_new then
    weight := null; body_fat := null; bmi := null; lean_mass := null;
  end if;

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

  -- 체지방률 — 0.132 처럼 비율로 와도 위에서 13.2 로 바꿔 두었다.
  v := case when body_fat is null then null else f end;
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
      'derived', bmi_calc,
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
      'derived', lean_calc,
      'timezone', tz, 'source', 'Chace shortcut'));
    added := added + 1;
  end if;

  return jsonb_build_object('ok', true, 'added', added, 'at', now_ts);
end
$$;

-- 이 함수만 anon 에게 연다. 테이블 권한과 RLS 는 그대로 둔다.
revoke all on function public.chace_health_push(text, text, text, text, text, text, text, text) from public;
grant execute on function public.chace_health_push(text, text, text, text, text, text, text, text) to anon, authenticated;
