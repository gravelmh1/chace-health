-- Chace, health — 앱 전용 읽기 통로
--
-- 왜 필요한가
--   health_external_metrics / health_calendar_events / health_cloud_days 는
--   RLS 가 켜져 있어 anon 키로는 직접 SELECT 할 수 없다. 그게 맞는 설정이다.
--   대신 "정해진 데이터만 돌려주는 창구"를 하나 열어 그쪽으로만 읽게 한다.
--
-- 이 스크립트가 하지 않는 것
--   * 기존 테이블, 정책, 함수를 고치지 않는다.
--   * health_sync_pull() 을 건드리지 않는다 (이름을 달리 썼다).
--   * 데이터를 쓰거나 지우지 않는다. 읽기 전용이다.
--
-- 노출 범위
--   아래 profile_id 한 사람의, 최근 데이터만 나간다. 다른 행은 이 함수로 못 읽는다.
--   anon 키를 가진 사람은 이 함수를 부를 수 있으므로, 그 범위를 좁게 잡는 것이 핵심이다.
--
-- 실행 방법
--   Supabase 대시보드 → SQL Editor → 아래 전체를 붙여넣고 Run.

create or replace function public.chace_health_pull()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select '6eb29763-315a-46b7-bcf7-da24b8f1503e'::uuid as pid
  )
  select jsonb_build_object(
    'metrics', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.recorded_at desc)
      from (
        select *
        from public.health_external_metrics, me
        where profile_id = me.pid
          and recorded_at >= now() - interval '60 days'
        order by recorded_at desc
        limit 4000
      ) m
    ), '[]'::jsonb),

    'calendar_events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.start_at)
      from (
        select *
        from public.health_calendar_events, me
        where profile_id = me.pid
          and start_at >= now() - interval '90 days'
          and start_at <  now() + interval '90 days'
        order by start_at
        limit 1000
      ) e
    ), '[]'::jsonb),

    'days', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.day desc)
      from (
        select *
        from public.health_cloud_days, me
        where profile_id = me.pid
        order by day desc
        limit 400
      ) d
    ), '[]'::jsonb)
  );
$$;

-- 이 함수를 부를 수 있는 대상을 명시한다.
revoke all on function public.chace_health_pull() from public;
grant execute on function public.chace_health_pull() to anon, authenticated;

-- 확인: 행 수가 나오면 성공이다.
select
  jsonb_array_length(public.chace_health_pull() -> 'metrics')         as metrics,
  jsonb_array_length(public.chace_health_pull() -> 'calendar_events') as events,
  jsonb_array_length(public.chace_health_pull() -> 'days')            as days;
