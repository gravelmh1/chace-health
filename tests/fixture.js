// 검증용 가짜 데이터셋 — 실제 스키마(recorded_at, start_at/end_at)를 그대로 따른다.
//
// 핵심: 9/15 의 "옛날" 행과 9/17 의 "최신" 행을 둘 다 넣는다.
// 정렬이나 필터가 틀리면 앱이 실제 버그와 똑같이 9/15 값을 보여주므로
// 테스트가 그걸 잡아낸다.
//
// updated_at 은 recorded_at 과 일부러 순서를 뒤집어 놓았다.
// 저장/갱신 시각으로 정렬하는 코드는 이 픽스처에서 반드시 실패한다.

const P = '6eb29763-315a-46b7-bcf7-da24b8f1503e';

const m = (source, metric, value, unit, recorded_at, metadata, updated_at) => ({
  profile_id: P, source, metric, value, unit, recorded_at,
  updated_at: updated_at ?? recorded_at,
  metadata,
});

const renphoMeta = (local_date, local_time) => ({
  local_date, local_time,
  local_timestamp: `${local_date}T${local_time}`,
  sample_end_local: `${local_date}T${local_time}`,
  source_bundle: 'com.renpho.health',
  timezone: 'America/Los_Angeles',
  source: 'ChatGPT Health sync',
});

// synced_local_time 을 recorded_at 과 일부러 어긋나게 둔다.
// recorded_at(19:20Z = LA 12:20)을 변환해 쓰는 코드는 12:20 을 찍고,
// synced_local_time 을 쓰는 코드는 12:45 를 찍는다 — 어느 쪽인지 테스트가 가른다.
const appleDaily = (local_date, complete_day, synced = '12:45:00') => ({
  local_date,
  aggregation: 'daily_sum',
  complete_day,
  synced_local_time: `${local_date}T${synced}`,
  timezone: 'America/Los_Angeles',
  source: 'ChatGPT Health sync',
});

export const ROWS = [
  // --- 9/15 RENPHO (화면에 잘못 떠 있던 옛날 값) ---
  // updated_at 을 9/17 로 두어, 갱신시각 정렬 시 이 행이 최신으로 올라오게 한다.
  m('RENPHO Health', 'bodyMass',          78.0, 'kg', '2026-09-15T18:19:00Z', renphoMeta('2026-09-15', '11:19:00'), '2026-09-17T20:00:00Z'),
  m('RENPHO Health', 'bodyFatPercentage', 13.2, '%',  '2026-09-15T18:19:00Z', renphoMeta('2026-09-15', '11:19:00'), '2026-09-17T20:00:00Z'),
  m('RENPHO Health', 'bodyMassIndex',     23.9, 'unitless', '2026-09-15T18:19:00Z', renphoMeta('2026-09-15', '11:19:00'), '2026-09-17T20:00:00Z'),
  m('RENPHO Health', 'leanBodyMass',      67.7, 'kg', '2026-09-15T18:19:00Z', renphoMeta('2026-09-15', '11:19:00'), '2026-09-17T20:00:00Z'),

  // --- 9/17 10:07 PDT RENPHO (DB 의 진짜 최신값) ---
  m('RENPHO Health', 'bodyMass',          78.300000001, 'kg', '2026-09-17T17:07:00Z', renphoMeta('2026-09-17', '10:07:00')),
  m('RENPHO Health', 'bodyFatPercentage', 13.2,         '%',  '2026-09-17T17:07:00Z', renphoMeta('2026-09-17', '10:07:00')),
  m('RENPHO Health', 'bodyMassIndex',     24.0,         'unitless', '2026-09-17T17:07:00Z', renphoMeta('2026-09-17', '10:07:00')),
  m('RENPHO Health', 'leanBodyMass',      67.96,        'kg', '2026-09-17T17:07:00Z', renphoMeta('2026-09-17', '10:07:00')),

  // --- 심박수: 9/16 옛날 값 + 9/17 12:17 PDT 최신값 ---
  m('Apple Health', 'heartRate',  84, 'count/min', '2026-09-17T04:17:00Z', { local_date: '2026-09-16', local_time: '21:17:00' }),
  m('Apple Health', 'heartRate', 105, 'count/min', '2026-09-17T19:17:00Z', { local_date: '2026-09-17', local_time: '12:17:00' }),

  // --- 걸음수 ---
  m('Apple Health', 'stepCount', 9120, 'count', '2026-09-16T23:59:00Z', appleDaily('2026-09-16', true)),
  // 오늘: legacy 시간별 snapshot 2건 + 일일 집계 1건이 같은 날짜에 공존한다.
  // 집계 행이 최신이 아니게 두어, "무조건 최신 1건"만 집는 코드와 구분되게 한다.
  m('Apple Health', 'stepCount', 3100, 'count', '2026-09-17T15:00:00Z', { local_date: '2026-09-17', local_time: '08:00:00' }),
  m('Apple Health', 'stepCount', 6482, 'count', '2026-09-17T19:20:00Z', appleDaily('2026-09-17', false)),
  m('Apple Health', 'stepCount', 6100, 'count', '2026-09-17T19:25:00Z', { local_date: '2026-09-17', local_time: '12:25:00' }),

  // --- 걷기·달리기 거리 (m 단위 저장) ---
  m('Apple Health', 'distanceWalkingRunning', 1770.3, 'm', '2026-09-17T19:20:00Z', appleDaily('2026-09-17', false)),
  m('Apple Health', 'distanceWalkingRunning', 5200.0, 'm', '2026-09-16T23:59:00Z', appleDaily('2026-09-16', true)),
];

export const CAL_ROWS = [
  { profile_id: P, calendar_id: 'c1', event_id: 'e1', title: '아침 러닝', category: '운동',
    start_at: '2026-09-17T14:00:00Z', end_at: '2026-09-17T15:00:00Z', location: null, source: 'google_calendar' },
  { profile_id: P, calendar_id: 'c1', event_id: 'e2', title: '헬스장', category: '운동',
    start_at: '2026-09-19T02:00:00Z', end_at: '2026-09-19T03:00:00Z', location: null, source: 'google_calendar' },
  // LA 기준 9/30 늦은 밤 → UTC 로는 10/1. 월 경계에서 잘리는지 확인하는 행.
  { profile_id: P, calendar_id: 'c1', event_id: 'e3', title: '야간 산책', category: '운동',
    start_at: '2026-10-01T04:30:00Z', end_at: '2026-10-01T05:00:00Z', location: null, source: 'google_calendar' },
];

// --- health_cloud_days: 약 / 운동 기록 -----------------------------------------
// 원본 앱 화면과 같은 값 (9/10 210회, 9/11 260회 …, 합계 620·0·180·120)
const day = (d, meds, workouts) => ({
  profile_id: P, day: d, meds, workouts, events: null,
  updated_at: `${d}T23:00:00Z`,
});

export const CLOUD_ROWS = [
  day('2026-09-10', { vitD: true },             { pushup: 60,  triceps: 90, shoulder: 60 }),
  day('2026-09-11', { vitD: true, duta: true }, { pushup: 110, triceps: 90, shoulder: 60 }),
  day('2026-09-12', { vitD: true },             { pushup: 60 }),
  day('2026-09-14', { vitD: true },             { pushup: 60 }),
  day('2026-09-15', { vitD: true, duta: true }, { pushup: 110 }),
  day('2026-09-16', { vitD: true },             { pushup: 110 }),
  day('2026-09-17', { vitD: true, duta: true }, { pushup: 110 }),
];
