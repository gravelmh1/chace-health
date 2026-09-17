// 검증용 가짜 데이터셋.
//
// 핵심: 9/15 의 "옛날" 행과 9/17 의 "최신" 행을 둘 다 넣는다.
// 정렬이나 필터가 틀리면 앱이 실제 버그와 똑같이 9/15 값을 보여주므로,
// 테스트가 그걸 잡아낸다.
//
// 또한 measured_at(측정시각)과 created_at(저장시각)의 순서를 일부러 뒤집어 놓았다.
// created_at 으로 정렬하는 코드는 이 픽스처에서 반드시 실패한다.

const P = '6eb29763-315a-46b7-bcf7-da24b8f1503e';

const m = (source, metric, value, unit, measured_at, created_at, local_date) => ({
  profile_id: P, source, metric, value, unit, measured_at,
  created_at: created_at ?? measured_at,
  metadata: local_date ? { local_date } : {},
});

export const ROWS = [
  // --- 9/15 RENPHO (화면에 잘못 떠 있던 옛날 값) ---
  m('RENPHO Health', 'bodyMass',          78.0,  'kg', '2026-09-15T18:19:00Z', '2026-09-17T20:00:00Z', '2026-09-15'),
  m('RENPHO Health', 'bodyFatPercentage', 13.2,  '%',  '2026-09-15T18:19:00Z', '2026-09-17T20:00:00Z', '2026-09-15'),
  m('RENPHO Health', 'bodyMassIndex',     23.9,  null, '2026-09-15T18:19:00Z', '2026-09-17T20:00:00Z', '2026-09-15'),
  m('RENPHO Health', 'leanBodyMass',      67.7,  'kg', '2026-09-15T18:19:00Z', '2026-09-17T20:00:00Z', '2026-09-15'),

  // --- 9/17 10:07 PDT RENPHO (DB 의 진짜 최신값) ---
  m('RENPHO Health', 'bodyMass',          78.300000001, 'kg', '2026-09-17T17:07:00Z', '2026-09-17T17:10:00Z', '2026-09-17'),
  m('RENPHO Health', 'bodyFatPercentage', 13.2,         '%',  '2026-09-17T17:07:00Z', '2026-09-17T17:10:00Z', '2026-09-17'),
  m('RENPHO Health', 'bodyMassIndex',     24.0,         null, '2026-09-17T17:07:00Z', '2026-09-17T17:10:00Z', '2026-09-17'),
  m('RENPHO Health', 'leanBodyMass',      67.96,        'kg', '2026-09-17T17:07:00Z', '2026-09-17T17:10:00Z', '2026-09-17'),

  // --- 심박수: 9/16 옛날 값 + 9/17 12:17 PDT 최신값 ---
  m('Apple Health', 'heartRate',  84, 'BPM', '2026-09-17T04:17:00Z', null, '2026-09-16'),
  m('Apple Health', 'heartRate', 105, 'BPM', '2026-09-17T19:17:00Z', null, '2026-09-17'),

  // --- 걸음수 일일 집계 ---
  m('Apple Health', 'stepCount', 9120, 'count', '2026-09-16T23:59:00Z', null, '2026-09-16'),
  // 오늘(LA 9/17) 진행 중 누적값. 같은 날 여러 번 갱신되는 상황도 재현.
  m('Apple Health', 'stepCount', 3100, 'count', '2026-09-17T15:00:00Z', null, '2026-09-17'),
  m('Apple Health', 'stepCount', 6482, 'count', '2026-09-17T19:20:00Z', null, '2026-09-17'),
];

export const CAL_ROWS = [
  { profile_id: P, title: '아침 러닝',  starts_at: '2026-09-17T14:00:00Z', ends_at: '2026-09-17T15:00:00Z', source: 'Google Calendar' },
  { profile_id: P, title: '헬스장',     starts_at: '2026-09-19T02:00:00Z', ends_at: '2026-09-19T03:00:00Z', source: 'Google Calendar' },
  // LA 기준 9/30 늦은 밤 → UTC 로는 10/1. 월 경계에서 잘리는지 확인하는 행.
  { profile_id: P, title: '야간 산책',  starts_at: '2026-10-01T04:30:00Z', ends_at: '2026-10-01T05:00:00Z', source: 'Google Calendar' },
];
