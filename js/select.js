// 행 배열에서 필요한 값을 골라내는 순수 함수들.
//
// RPC(health_sync_pull) 가 한 번에 돌려주는 행들을 여기서 추려낸다.
// 테이블을 직접 조회할 때 쿼리로 하던 일(최신 1건, 일일 집계 우선)을
// 그대로 클라이언트에서 수행하므로, 두 경로의 결과가 같아야 한다.

import { METRICS_COL as C, SOURCE } from './config.js';
import { parseLocalStamp, toDate, laDateString } from './time.js';

const time = (row) => Date.parse(row?.[C.recordedAt] ?? '') || 0;

/** recorded_at 내림차순. 정렬 기준은 항상 측정 시각이다. */
export function sortByRecordedDesc(rows) {
  return [...rows].sort((a, b) => time(b) - time(a));
}

export function filterRows(rows, { profileId, source, metric } = {}) {
  return rows.filter((r) =>
    (!profileId || r[C.profileId] === profileId) &&
    (!source || r[C.source] === source) &&
    (!metric || r[C.metric] === metric));
}

// 단위 환산. 동기화가 체중을 lb 로, 거리를 km 로 넣어도 화면은 항상 kg / m 기준이다.
const LB = 0.45359237;
const TO_KG = { kg: 1, kilogram: 1, kilograms: 1, lb: LB, lbs: LB, pound: LB, pounds: LB, g: 0.001 };
const TO_M = { m: 1, meter: 1, meters: 1, km: 1000, mi: 1609.344, mile: 1609.344, miles: 1609.344 };
const MASS_METRICS = new Set(['bodyMass', 'leanBodyMass']);

function toStandardUnit(metric, value, unit) {
  const u = String(unit ?? '').trim().toLowerCase();
  if (value === null) return { value, unit };
  if (MASS_METRICS.has(metric) && TO_KG[u]) return { value: value * TO_KG[u], unit: 'kg' };
  if (metric === 'distanceWalkingRunning' && TO_M[u]) return { value: value * TO_M[u], unit: 'm' };
  return { value, unit };
}

export function normalize(row) {
  if (!row) return null;
  const raw = row[C.value];
  const num = typeof raw === 'number' ? raw : Number(raw);
  const { value, unit } = toStandardUnit(
    row[C.metric], Number.isFinite(num) ? num : null, row[C.unit] ?? null);
  return {
    value,
    unit,
    recordedAt: row[C.recordedAt] ?? null,
    updatedAt: row[C.updatedAt] ?? null,
    metadata: row[C.metadata] ?? null,
  };
}

/**
 * 그 행이 DB 에 마지막으로 써진 시점 (ms).
 * 동기화가 적어 둔 synced_local_time → updated_at → recorded_at 순으로 본다.
 * 같은 날의 합계 행이 여러 개일 때 "가장 나중에 동기화된 것" 을 고르는 기준이다.
 */
export function writtenAt(row) {
  const md = row?.[C.metadata];
  const t = [
    parseLocalStamp(md?.synced_local_time),
    toDate(row?.[C.updatedAt]),
    toDate(row?.[C.recordedAt]),
  ].map((d) => d?.getTime() ?? 0);
  return Math.max(...t);
}

/** (source, metric) 의 가장 최근 측정값. 날짜 필터 없음 — 언제 측정됐든 최신값. */
export function latestMetric(rows, profileId, source, metric) {
  const found = sortByRecordedDesc(filterRows(rows, { profileId, source, metric }))[0];
  return normalize(found);
}

/**
 * 특정 LA 날짜의 일일 누적값.
 *
 * 규칙: 원시 샘플을 더하지 않는다. 하루 합계는 동기화가 만든 합계 행 하나를 쓴다.
 *  - 합계 행(aggregation = 'daily_sum')이 있으면 그중 가장 나중에 동기화된 것.
 *    (예전 동기화는 매 실행마다 합계 행을 새로 추가해서 하루에 여러 개가 있을 수 있다)
 *  - 합계 행이 없을 때만 가장 최근 snapshot 을 쓴다 (legacy).
 */
export function dailyTotal(rows, profileId, metric, localDate) {
  const sameDay = filterRows(rows, { profileId, source: SOURCE.apple, metric })
    .filter((r) => r[C.metadata]?.local_date === localDate);
  return pickDaily(sameDay, localDate);
}

/** 한 날짜의 행들 중 그 날의 합계를 고른다. 테이블 직접 조회 경로도 같은 규칙을 쓴다. */
export function pickDaily(sameDay, localDate) {
  if (!sameDay.length) return null;

  const aggregates = sameDay
    .filter((r) => r[C.metadata]?.aggregation === 'daily_sum')
    .sort((a, b) => writtenAt(b) - writtenAt(a));
  const picked = aggregates[0] ?? sortByRecordedDesc(sameDay)[0];

  return {
    ...normalize(picked),
    localDate,
    isAggregate: aggregates.length > 0,
    // 지난 날짜는 끝난 하루다. 행에 적힌 값이 오래됐어도(어제 오후에 쓴 false) 날짜로 판정한다.
    completeDay: localDate < laDateString(new Date()) ? true : (picked[C.metadata]?.complete_day ?? false),
    rowCount: sameDay.length,
  };
}

/** 앱이 "동기화가 늦다" 고 알리는 기준 */
export const SYNC_STALE_MS = 6 * 3600 * 1000;

/**
 * 동기화 상태.
 * 별도 상태 테이블 없이 metric 행에서 계산한다 — 동기화가 성공하면 오늘 합계 행이
 * 반드시 다시 써지므로, 가장 나중에 써진 행의 시각이 곧 마지막 성공 시각이다.
 *
 *   lastSyncAt      가장 나중에 써진 행의 시각 (Date)
 *   lastAppleDate   Apple Health 행의 마지막 LA 날짜
 *   lastRenphoDate  RENPHO 행의 마지막 LA 날짜
 *   delayed         마지막 동기화가 6시간보다 오래됨 (또는 기록이 전혀 없음)
 */
export function syncStatus(rows, profileId, now = Date.now()) {
  const mine = filterRows(rows, { profileId });
  let last = 0;
  for (const r of mine) last = Math.max(last, writtenAt(r));

  const lastDate = (source) => filterRows(mine, { source })
    .map((r) => r[C.metadata]?.local_date
      ?? (toDate(r[C.recordedAt]) ? laDateString(toDate(r[C.recordedAt])) : null))
    .filter(Boolean)
    .sort()
    .pop() ?? null;

  const lastSyncAt = last ? new Date(last) : null;
  return {
    lastSyncAt,
    lastAppleDate: lastDate(SOURCE.apple),
    lastRenphoDate: lastDate(SOURCE.renpho),
    delayed: !lastSyncAt || now - last > SYNC_STALE_MS,
  };
}

/**
 * RPC 응답에서 metric 행과 캘린더 행을 찾아낸다.
 * 반환 형태를 확정할 수 없으므로 여러 모양을 받아들인다.
 */
export function unpackSyncPull(payload) {
  const body = Array.isArray(payload) ? payload[0] : payload;
  if (!body || typeof body !== 'object') return { metrics: [], events: [], days: [] };

  const pick = (...names) => {
    for (const n of names) if (Array.isArray(body[n])) return body[n];
    // 키 이름이 다르면 내용으로 찾는다
    for (const [k, v] of Object.entries(body)) {
      if (!Array.isArray(v) || !v.length) continue;
      const lower = k.toLowerCase();
      if (names.some((n) => lower.includes(n.replace(/_/g, '')))) return v;
    }
    return null;
  };

  const metrics = pick('metrics', 'external_metrics', 'health_external_metrics') ?? [];
  const events = pick('calendar_events', 'events', 'calendar', 'health_calendar_events') ?? [];
  const days = pick('days', 'cloud_days', 'health_cloud_days', 'day_records') ?? [];

  // 키 이름으로 못 찾으면 행의 생김새로 가른다
  if (!metrics.length && !events.length) {
    const all = Object.values(body).filter(Array.isArray).flat();
    return {
      metrics: all.filter((r) => r && C.metric in r),
      events: all.filter((r) => r && 'start_at' in r),
      days: all.filter((r) => r && 'day' in r && ('workouts' in r || 'meds' in r)),
    };
  }
  return { metrics, events, days };
}
