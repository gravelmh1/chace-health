// 행 배열에서 필요한 값을 골라내는 순수 함수들.
//
// RPC(health_sync_pull) 가 한 번에 돌려주는 행들을 여기서 추려낸다.
// 테이블을 직접 조회할 때 쿼리로 하던 일(최신 1건, 일일 집계 우선)을
// 그대로 클라이언트에서 수행하므로, 두 경로의 결과가 같아야 한다.

import { METRICS_COL as C, SOURCE } from './config.js';

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

/** (source, metric) 의 가장 최근 측정값. 날짜 필터 없음 — 언제 측정됐든 최신값. */
export function latestMetric(rows, profileId, source, metric) {
  const found = sortByRecordedDesc(filterRows(rows, { profileId, source, metric }))[0];
  return normalize(found);
}

/**
 * 특정 LA 날짜의 일일 누적값.
 * 같은 날짜에 일일 집계 행과 시간별 snapshot 이 섞여 있을 수 있으므로
 * 집계 행(aggregation = 'daily_sum')을 우선하고, 없으면 가장 최근 snapshot 을 쓴다.
 */
export function dailyTotal(rows, profileId, metric, localDate) {
  const sameDay = sortByRecordedDesc(
    filterRows(rows, { profileId, source: SOURCE.apple, metric })
      .filter((r) => r[C.metadata]?.local_date === localDate),
  );
  if (!sameDay.length) return null;

  const aggregate = sameDay.find((r) => r[C.metadata]?.aggregation === 'daily_sum');
  const picked = aggregate ?? sameDay[0];

  return {
    ...normalize(picked),
    localDate,
    isAggregate: !!aggregate,
    completeDay: picked[C.metadata]?.complete_day ?? null,
    rowCount: sameDay.length,
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
