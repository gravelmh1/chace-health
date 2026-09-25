-- Chace, health — 동기화 점검 (읽기 전용. 아무것도 바꾸지 않는다)
-- Supabase → SQL Editor 에서 블록별로 실행.

-- 1) 날짜별·항목별 행 수 (최근 7일, LA 날짜)
--    stepCount / distanceWalkingRunning 은 daily_sum 이 날짜당 1행이어야 정상.
--    9/22 이후 칸이 비어 있으면 그 날 동기화가 안 들어온 것이다.
select coalesce(metadata->>'local_date',
                to_char(recorded_at at time zone 'America/Los_Angeles', 'YYYY-MM-DD')) as la_date,
       source, metric,
       count(*)                                                     as rows,
       count(*) filter (where metadata->>'aggregation' = 'daily_sum') as daily_sum_rows,
       max(value)                                                   as max_value,
       string_agg(distinct unit, ',')                               as units
  from health_external_metrics
 where profile_id = '6eb29763-315a-46b7-bcf7-da24b8f1503e'
   and recorded_at >= now() - interval '8 days'
 group by 1, 2, 3
 order by 1 desc, 2, 3;

-- 2) 하루 합계 중복 — 한 날짜에 daily_sum 이 2개 이상인 곳 (트리거 설치 이후엔 새로 생기면 안 됨)
select metadata->>'local_date' as la_date, metric, count(*) as daily_sum_rows,
       array_agg(value order by updated_at desc) as values_newest_first
  from health_external_metrics
 where profile_id = '6eb29763-315a-46b7-bcf7-da24b8f1503e'
   and source = 'Apple Health'
   and metric in ('stepCount', 'distanceWalkingRunning')
   and metadata->>'aggregation' = 'daily_sum'
 group by 1, 2
having count(*) > 1
 order by 1 desc;

-- 3) PK 중복 (있으면 안 됨 — 0행이어야 정상)
select profile_id, recorded_at, source, metric, count(*)
  from health_external_metrics
 group by 1, 2, 3, 4
having count(*) > 1;

-- 4) 항목별 최신값 · 단위 · source · 마지막 동기화
select distinct on (source, metric)
       source, metric, value, unit,
       recorded_at at time zone 'America/Los_Angeles' as recorded_la,
       metadata->>'local_date'        as local_date,
       metadata->>'synced_local_time' as synced_local_time,
       updated_at at time zone 'America/Los_Angeles'  as updated_la
  from health_external_metrics
 where profile_id = '6eb29763-315a-46b7-bcf7-da24b8f1503e'
 order by source, metric, recorded_at desc;

-- 5) 체중이 kg 이 아닌 행 / RENPHO 가 아닌 source 로 들어온 체성분 (0행이 정상)
select source, metric, unit, count(*)
  from health_external_metrics
 where profile_id = '6eb29763-315a-46b7-bcf7-da24b8f1503e'
   and metric in ('bodyMass', 'leanBodyMass', 'bodyFatPercentage', 'bodyMassIndex')
   and (source <> 'RENPHO Health' or (metric in ('bodyMass', 'leanBodyMass') and unit <> 'kg'))
 group by 1, 2, 3;

-- 6) 마지막 동기화 시각 (앱의 "Health sync delayed" 판단 근거 — 6시간 넘으면 경고)
select max(updated_at) at time zone 'America/Los_Angeles' as last_write_la,
       now() - max(updated_at)                            as age
  from health_external_metrics
 where profile_id = '6eb29763-315a-46b7-bcf7-da24b8f1503e';

-- 7) 트리거가 설치됐는지
select tgname from pg_trigger
 where tgrelid = 'public.health_external_metrics'::regclass and not tgisinternal;
