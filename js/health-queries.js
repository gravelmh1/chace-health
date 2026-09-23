// health_external_metrics 조회 계층.
//
// 설계 원칙 — "옛날 값이 보이던" 문제를 구조적으로 막기 위한 규칙:
//
//  1. metric 마다 독립적으로 최신 1건을 조회한다.
//     체중 기록 한 건을 통째로 읽어서 거기 붙은 체지방/BMI/근육량을 같이 쓰면,
//     그 측정 세션에 일부 metric 이 없었을 때 카드 전체가 과거 시점으로 고정된다.
//     (9/15 값이 화면에 남아 있던 전형적인 패턴)
//
//  2. 정렬은 항상 "측정 시각(recorded_at)" 기준.
//     이 테이블에 measured_at / created_at 은 존재하지 않는다.
//     저장 시각으로 정렬하면 동기화가 몰아 들어올 때 순서가 뒤집힌다.
//
//  3. 날짜 경계가 필요한 조회는 UTC timestamp 범위로 자르지 않는다.
//     LA 기준 날짜 문자열(metadata->>local_date)로 직접 매칭한다.
//     UTC 로 자르면 LA 오후 5시 이후의 데이터가 "내일"로 넘어가 오늘 걸음수가 0 이 된다.
//
//  4. 데이터가 없으면 0 이 아니라 null 을 돌려준다.
//     "측정값 0" 과 "측정 기록 없음" 은 다른 상태이고, UI 도 다르게 보여야 한다.

import { selectOne, selectRows, callRpc } from './supabase.js';
import { unpackSyncPull, latestMetric, dailyTotal } from './select.js';
import {
  METRICS_TABLE, METRICS_COL as C, SOURCE, SYNC_PULL_FNS,
} from './config.js';
import { getProfileId, getAnonKey } from './settings.js';
import { laToday } from './time.js';

const SELECT = `${C.value},${C.unit},${C.recordedAt},${C.metadata}`;

/** 행 하나를 앱 내부 표준 형태로 정규화 */
function normalize(row) {
  if (!row) return null;
  const raw = row[C.value];
  const value = typeof raw === 'number' ? raw : Number(raw);
  return {
    value: Number.isFinite(value) ? value : null,
    unit: row[C.unit] ?? null,
    recordedAt: row[C.recordedAt] ?? null,
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
      [C.profileId]: `eq.${getProfileId()}`,
      [C.source]: `eq.${source}`,
      [C.metric]: `eq.${metric}`,
      order: `${C.recordedAt}.desc`,
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
 * syncedAt = 가져온 metric 들의 recorded_at 중 가장 최신값.
 * (고정된 "동기화 시각" 컬럼이 아니라 실제 측정 시각에서 계산한다)
 */
export async function fetchRenpho() {
  const { metrics, errors } = await fetchLatestMetrics(SOURCE.renpho, RENPHO_METRICS);

  let syncedAt = null;
  for (const m of RENPHO_METRICS) {
    const t = metrics[m]?.recordedAt;
    if (t && (!syncedAt || new Date(t) > new Date(syncedAt))) syncedAt = t;
  }

  return { ...metrics, syncedAt, errors };
}

/** 가장 최근 심박수 1건 (측정값 + 측정 시각). */
export async function fetchHeartRate() {
  return fetchLatestMetric(SOURCE.apple, 'heartRate');
}

/**
 * 특정 LA 날짜의 일일 누적값 (stepCount, distanceWalkingRunning 등).
 *
 * 주의: 날짜당 행이 1개라고 가정하면 안 된다.
 *   - 현재 방식: metadata.aggregation = 'daily_sum' 인 일일 집계 행 1건
 *   - 과거 방식: 같은 local_date 에 시간별 누적 snapshot 행이 여러 개
 * 그래서 그 날짜의 행을 모두 받아서, 집계 행이 있으면 그것을 쓰고
 * 없으면 가장 최근 snapshot 을 쓴다.
 *
 * 하루가 끝나기 전(complete_day = false)이어도 그 시점까지의 누적값을 그대로 쓴다.
 */
async function fetchDailyTotal(metric, localDate) {
  let rows;
  try {
    rows = await selectRows(METRICS_TABLE, {
      select: SELECT,
      [C.profileId]: `eq.${getProfileId()}`,
      [C.source]: `eq.${SOURCE.apple}`,
      [C.metric]: `eq.${metric}`,
      // LA 기준 날짜 문자열로 직접 매칭. UTC timestamp 범위로 자르지 않는다.
      [`${C.metadata}->>local_date`]: `eq.${localDate}`,
      order: `${C.recordedAt}.desc`,
      limit: '50',
    });
  } catch (e) {
    throw new Error(`${metric}(${localDate}): ${e.message}`);
  }

  if (!rows.length) return null;

  // 집계 행 우선. 없으면 가장 최근 snapshot (rows 는 이미 recorded_at 내림차순)
  const aggregate = rows.find((r) => r[C.metadata]?.aggregation === 'daily_sum');
  const picked = aggregate ?? rows[0];

  return {
    ...normalize(picked),
    localDate,
    isAggregate: !!aggregate,
    completeDay: picked[C.metadata]?.complete_day ?? null,
    rowCount: rows.length,
  };
}

/**
 * 오늘(LA 기준) 걸음수.
 * 오늘 행이 아직 없으면 0 으로 떨어뜨리지 않고, 마지막 기록일의 값을
 * stale 표시와 함께 돌려준다. 화면에 근거 없는 0 이 찍히는 일을 막는 장치.
 */
export async function fetchStepsToday() {
  const today = laToday();

  const todayRow = await fetchDailyTotal('stepCount', today);
  if (todayRow) return { ...todayRow, isToday: true };

  const last = await fetchLatestMetric(SOURCE.apple, 'stepCount');
  if (!last) return null;

  return {
    ...last,
    localDate: last.metadata?.local_date ?? null,
    isToday: false,
  };
}

/** 오늘(LA 기준) 걷기·달리기 거리. 단위는 m 로 저장된다. */
export async function fetchDistanceToday() {
  const today = laToday();

  const todayRow = await fetchDailyTotal('distanceWalkingRunning', today);
  if (todayRow) return { ...todayRow, isToday: true };

  const last = await fetchLatestMetric(SOURCE.apple, 'distanceWalkingRunning');
  if (!last) return null;

  return { ...last, localDate: last.metadata?.local_date ?? null, isToday: false };
}

// ---------------------------------------------------------------------------
// 읽기 경로는 두 가지다.
//
//  1. RPC health_sync_pull() — 원본 앱이 쓰던 통로.
//     테이블에 RLS 가 걸려 있어 anon 으로 직접 SELECT 가 막히는 환경에서도
//     동작한다. 한 번의 요청으로 최근 데이터를 통째로 받아 클라이언트에서 추린다.
//
//  2. 테이블 직접 조회 — RPC 가 없을 때의 폴백.
//
// 먼저 1을 시도하고, 함수가 없을 때만 2로 내려간다.
// 어느 쪽이든 고르는 규칙(최신 1건, 일일 집계 우선)은 동일하다.
// ---------------------------------------------------------------------------

// 어떤 이름이 통했는지 기억해 두고 다음부터는 그것만 부른다.
export let SYNC_PULL_FN = SYNC_PULL_FNS[0];

// null=아직 모름, true=쓸 수 있음, false=이 키로는 안 됨.
// 어떤 키로 판정했는지 함께 기억한다 — 키가 바뀌면 다시 판정해야 한다.
let rpcAvailable = null;
let probedKey = null;

// 한 번의 새로고침에서 대시보드와 달력이 같은 응답을 쓰도록 아주 짧게만 캐시한다.
// (캐시 때문에 옛날 값이 남는 일이 없도록 수명을 3초로 묶는다)
const PULL_TTL_MS = 3000;
let lastPull = { at: 0, data: null };

/** RPC 응답을 가져온다. 함수가 없으면 null. */
export async function pullSyncData() {
  const key = getAnonKey();

  // 키가 없을 때의 실패는 RPC 에 대한 판정이 아니다.
  // 여기서 "안 됨" 으로 못박으면, 키를 넣은 뒤에도 계속 테이블로만 가게 된다.
  if (!key) return null;

  // 키가 바뀌었으면 이전 판정과 캐시를 버린다.
  if (probedKey !== key) {
    probedKey = key;
    rpcAvailable = null;
    lastPull = { at: 0, data: null };
  }

  if (rpcAvailable === false) return null;
  if (lastPull.data && Date.now() - lastPull.at < PULL_TTL_MS) return lastPull.data;

  for (const fn of SYNC_PULL_FNS) {
    try {
      const data = unpackSyncPull(await callRpc(fn));
      if (!data.metrics.length && !data.days.length && !data.events.length) continue;
      SYNC_PULL_FN = fn;
      rpcAvailable = true;
      lastPull = { at: Date.now(), data };
      return data;
    } catch {
      // 이 이름은 없거나 막혀 있다 — 다음 후보로.
    }
  }
  rpcAvailable = false;
  lastPull = { at: 0, data: null };
  return null;
}

/** RPC 로 받은 행에서 대시보드를 구성한다. */
function dashboardFromRows(metrics) {
  const profileId = getProfileId();
  const today = laToday();

  const renphoMetrics = {};
  let syncedAt = null;
  for (const m of RENPHO_METRICS) {
    const v = latestMetric(metrics, profileId, SOURCE.renpho, m);
    renphoMetrics[m] = v;
    if (v?.recordedAt && (!syncedAt || new Date(v.recordedAt) > new Date(syncedAt))) {
      syncedAt = v.recordedAt;
    }
  }

  const stepsToday = dailyTotal(metrics, profileId, 'stepCount', today);
  const distToday = dailyTotal(metrics, profileId, 'distanceWalkingRunning', today);

  const lastOf = (metric) => {
    const last = latestMetric(metrics, profileId, SOURCE.apple, metric);
    return last ? { ...last, localDate: last.metadata?.local_date ?? null, isToday: false } : null;
  };

  return {
    renpho: { ...renphoMetrics, syncedAt, errors: [] },
    heartRate: latestMetric(metrics, profileId, SOURCE.apple, 'heartRate'),
    steps: stepsToday ? { ...stepsToday, isToday: true } : lastOf('stepCount'),
    distance: distToday ? { ...distToday, isToday: true } : lastOf('distanceWalkingRunning'),
    errors: [],
  };
}

/** 세 카드를 한 번에. 개별 실패가 전체를 죽이지 않는다. */
export async function fetchDashboard() {
  const pulled = await pullSyncData();
  if (pulled?.metrics?.length) {
    return { ...dashboardFromRows(pulled.metrics), via: 'rpc', fetchedAt: new Date().toISOString() };
  }
  // RPC 가 없거나 빈 응답이면 테이블을 직접 읽어 본다.
  // 그쪽이 막혀 있으면 그 오류 메시지가 원인(RLS 등)을 드러낸다.
  return fetchDashboardByTable();
}

async function fetchDashboardByTable() {
  const [renpho, heartRate, steps, distance] = await Promise.allSettled([
    fetchRenpho(),
    fetchHeartRate(),
    fetchStepsToday(),
    fetchDistanceToday(),
  ]);

  const unwrap = (r) => (r.status === 'fulfilled' ? r.value : null);
  const errs = [renpho, heartRate, steps, distance]
    .filter((r) => r.status === 'rejected')
    .map((r) => r.reason?.message || String(r.reason));

  const renphoVal = unwrap(renpho);

  return {
    renpho: renphoVal,
    heartRate: unwrap(heartRate),
    steps: unwrap(steps),
    distance: unwrap(distance),
    errors: [...errs, ...(renphoVal?.errors ?? [])],
    via: 'table',
    fetchedAt: new Date().toISOString(),
  };
}
