// health_external_metrics 조회 계층.
//
// 설계 원칙 — "옛날 값이 보이던" 문제를 구조적으로 막기 위한 규칙:
//
//  1. metric 마다 독립적으로 최신 1건을 조회한다.
//     체중 기록 한 건을 통째로 읽어서 거기 붙은 체지방/BMI/근육량을 같이 쓰면,
//     그 측정 세션에 일부 metric 이 없었을 때 카드 전체가 과거 시점으로 고정된다.
//     (9/15 값이 화면에 남아 있던 전형적인 패턴)
//
//  2. 정렬은 항상 "측정 시각(measured_at)" 기준. 저장 시각(created_at)이 아니다.
//     동기화가 몰아서 들어오면 저장 순서와 측정 순서가 서로 뒤집힌다.
//
//  3. 날짜 경계가 필요한 조회는 UTC timestamp 범위로 자르지 않는다.
//     LA 기준 날짜 문자열(metadata->>local_date)로 직접 매칭한다.
//     UTC 로 자르면 LA 오후 5시 이후의 데이터가 "내일"로 넘어가 오늘 걸음수가 0 이 된다.
//
//  4. 데이터가 없으면 0 이 아니라 null 을 돌려준다.
//     "측정값 0" 과 "측정 기록 없음" 은 다른 상태이고, UI 도 다르게 보여야 한다.

import { selectOne } from './supabase.js';
import {
  PROFILE_ID, METRICS_TABLE, METRICS_COL as C, SOURCE,
} from './config.js';
import { laToday } from './time.js';

const SELECT = `${C.value},${C.unit},${C.measuredAt},${C.metadata}`;

/** 행 하나를 앱 내부 표준 형태로 정규화 */
function normalize(row) {
  if (!row) return null;
  const raw = row[C.value];
  const value = typeof raw === 'number' ? raw : Number(raw);
  return {
    value: Number.isFinite(value) ? value : null,
    unit: row[C.unit] ?? null,
    measuredAt: row[C.measuredAt] ?? null,
    metadata: row[C.metadata] ?? null,
  };
}

/**
 * (source, metric) 조합의 가장 최근 측정값 1건.
 * 날짜 필터가 전혀 없다 = 언제 측정됐든 무조건 최신값을 가져온다.
 */
export async function fetchLatestMetric(source, metric) {
  try {
    const row = await selectOne(METRICS_TABLE, {
      select: SELECT,
      [C.profileId]: `eq.${PROFILE_ID}`,
      [C.source]: `eq.${source}`,
      [C.metric]: `eq.${metric}`,
      order: `${C.measuredAt}.desc`,
    });
    return normalize(row);
  } catch (e) {
    throw new Error(`${source}/${metric}: ${e.message}`);
  }
}

/** 여러 metric 을 병렬로. 하나가 실패해도 나머지 카드는 살린다. */
export async function fetchLatestMetrics(source, metrics) {
  const results = await Promise.allSettled(
    metrics.map((m) => fetchLatestMetric(source, m)),
  );
  const out = {};
  const errors = [];
  metrics.forEach((m, i) => {
    const r = results[i];
    if (r.status === 'fulfilled') {
      out[m] = r.value;
    } else {
      out[m] = null;
      errors.push(r.reason?.message || String(r.reason));
    }
  });
  return { metrics: out, errors };
}

export const RENPHO_METRICS = [
  'bodyMass',
  'bodyFatPercentage',
  'bodyMassIndex',
  'leanBodyMass',
];

/**
 * RENPHO 카드 데이터.
 * syncedAt = 가져온 metric 들의 measured_at 중 가장 최신값.
 * (고정된 "동기화 시각" 컬럼이 아니라 실제 측정 시각에서 계산한다)
 */
export async function fetchRenpho() {
  const { metrics, errors } = await fetchLatestMetrics(SOURCE.renpho, RENPHO_METRICS);

  let syncedAt = null;
  for (const m of RENPHO_METRICS) {
    const t = metrics[m]?.measuredAt;
    if (t && (!syncedAt || new Date(t) > new Date(syncedAt))) syncedAt = t;
  }

  return { ...metrics, syncedAt, errors };
}

/** 가장 최근 심박수 1건 (측정값 + 측정 시각). */
export async function fetchHeartRate() {
  return fetchLatestMetric(SOURCE.apple, 'heartRate');
}

/**
 * 오늘(LA 기준) 걸음수.
 *
 * metadata->>local_date 가 오늘인 행 중 가장 최근 것.
 * 하루가 끝나기 전 incomplete day 라도 그 시점까지의 누적값이 그대로 나온다.
 *
 * 오늘 행이 아직 없으면 0 으로 떨어뜨리지 않고, 마지막으로 기록된 날의 값을
 * stale 표시와 함께 돌려준다. 화면에 근거 없는 0 이 찍히는 일을 막는 장치.
 */
export async function fetchStepsToday() {
  const today = laToday();

  let row;
  try {
    row = await selectOne(METRICS_TABLE, {
      select: SELECT,
      [C.profileId]: `eq.${PROFILE_ID}`,
      [C.source]: `eq.${SOURCE.apple}`,
      [C.metric]: 'eq.stepCount',
      // LA 기준 날짜 문자열로 직접 매칭. UTC timestamp 범위로 자르지 않는다.
      [`${C.metadata}->>local_date`]: `eq.${today}`,
      order: `${C.measuredAt}.desc`,
    });
  } catch (e) {
    throw new Error(`stepCount(today): ${e.message}`);
  }

  if (row) {
    return { ...normalize(row), localDate: today, isToday: true };
  }

  // 오늘 집계가 아직 안 들어온 경우 → 마지막 기록일의 값
  const last = await fetchLatestMetric(SOURCE.apple, 'stepCount');
  if (!last) return null;

  return {
    ...last,
    localDate: last.metadata?.local_date ?? null,
    isToday: false,
  };
}

/** 세 카드를 한 번에. 개별 실패가 전체를 죽이지 않는다. */
export async function fetchDashboard() {
  const [renpho, heartRate, steps] = await Promise.allSettled([
    fetchRenpho(),
    fetchHeartRate(),
    fetchStepsToday(),
  ]);

  const unwrap = (r) => (r.status === 'fulfilled' ? r.value : null);
  const errs = [renpho, heartRate, steps]
    .filter((r) => r.status === 'rejected')
    .map((r) => r.reason?.message || String(r.reason));

  const renphoVal = unwrap(renpho);

  return {
    renpho: renphoVal,
    heartRate: unwrap(heartRate),
    steps: unwrap(steps),
    errors: [...errs, ...(renphoVal?.errors ?? [])],
    fetchedAt: new Date().toISOString(),
  };
}
