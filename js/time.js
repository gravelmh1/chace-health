// 시간/날짜 유틸 — 전부 America/Los_Angeles 기준.
//
// 이 앱에서 날짜가 하루 밀리는 사고의 원인은 거의 항상 아래 두 가지입니다.
//   1) new Date().toISOString().slice(0,10)  → UTC 날짜라 LA 오후 5시 이후 +1일
//   2) date.getDate() / getMonth()           → 브라우저 로컬 시간대에 의존
// 그래서 이 파일 밖에서는 그 두 패턴을 쓰지 않습니다.

import { TIME_ZONE } from './config.js';

/** LA 기준 'YYYY-MM-DD'. en-CA 로케일이 ISO 형태를 돌려줍니다. */
export function laDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** LA 기준 오늘 'YYYY-MM-DD' */
export function laToday() {
  return laDateString(new Date());
}

/** LA 기준 n일 전 'YYYY-MM-DD' */
export function laDaysAgo(n) {
  return laDateString(new Date(Date.now() - n * 86400000));
}

/** '9/17 10:07 AM' 형태 (LA 기준) */
export function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

/** '9/17' 형태 (LA 기준) */
export function formatDate(value) {
  const d = toDate(value);
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    month: 'numeric',
    day: 'numeric',
  }).format(d);
}

/** '방금 전' / '12분 전' / '3시간 전' / '2일 전' */
export function formatRelative(value) {
  const d = toDate(value);
  if (!d) return '';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return '방금 전';
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

/** 해당 timestamp 가 LA 기준 오늘인지 */
export function isLaToday(value) {
  const d = toDate(value);
  return !!d && laDateString(d) === laToday();
}

/**
 * timestamptz 문자열을 Date 로. Postgres 가 '2026-09-17 10:07:00+00' 처럼
 * 공백 구분자로 돌려주는 경우가 있어 Safari 가 파싱에 실패합니다 → 정규화 후 파싱.
 */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value) ? null : value;

  let s = String(value).trim();
  if (!s) return null;

  s = s.replace(' ', 'T');
  // '+00' → '+00:00' (Safari 가 요구하는 형태)
  s = s.replace(/([+-]\d{2})$/, '$1:00');
  // 타임존 표기가 아예 없으면 UTC 로 간주 (Supabase timestamptz 의 기본 반환은 UTC)
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(s)) s += 'Z';

  const d = new Date(s);
  return isNaN(d) ? null : d;
}

/** '9월 17일 (목)' — 상단 헤더용 (LA 기준) */
export function formatHeaderDate(dateStr) {
  const d = dateStr ? new Date(`${dateStr}T12:00:00Z`) : new Date();
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: dateStr ? 'UTC' : TIME_ZONE,
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month')} ${get('day')}일 (${get('weekday')})`;
}

/** '9. 17. 오전 10:07' — 동기화/측정 시각 표기 (LA 기준)
 *
 * 오전/오후는 직접 만든다. 런타임(Node/브라우저)의 ICU 데이터에 따라
 * ko-KR + hour12 가 'AM' 을 돌려주는 경우가 있어 표기가 흔들린다.
 */
export function formatSyncTime(value) {
  const d = toDate(value);
  if (!d) return '—';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';

  const hour = Number(get('hour')) % 24;
  const period = hour < 12 ? '오전' : '오후';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;

  return `${get('month')}. ${get('day')}. ${period} ${h12}:${get('minute')}`;
}

/** 'YYYY-MM-DD' 를 n일 이동한 날짜 문자열로. 시간대 영향 없음. */
export function shiftDate(dateStr, days) {
  const t = Date.parse(`${dateStr}T00:00:00Z`) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** 그 날짜가 속한 주의 일요일 (LA 기준 날짜 문자열) */
export function weekStart(dateStr) {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return shiftDate(dateStr, -dow);
}

/** '9/17' 짧은 라벨 (차트 x축용) */
export function shortLabel(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/**
 * metadata 에 들어 있는 "현지 벽시계" 문자열을 그대로 표시한다.
 * ('2026-09-17T12:30:00' 같은 값 — 이미 LA 기준이라 시간대 변환을 하면 안 된다)
 *
 * recorded_at 을 변환해 쓰면 일일 집계 행에서 어긋난다.
 * 그 행의 recorded_at 은 동기화 시각이 아니라 집계 기준 시각이기 때문이다.
 */
export function formatLocalStamp(value) {
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, , mo, d, h, mi] = m;
  const hour = Number(h) % 24;
  const period = hour < 12 ? '오전' : '오후';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${Number(mo)}. ${Number(d)}. ${period} ${h12}:${mi}`;
}

/**
 * 한 측정값의 표시 시각.
 * metadata 의 현지 시각을 우선하고, 없을 때만 recorded_at 을 LA 로 변환한다.
 */
export function metricTime(entry) {
  const md = entry?.metadata;
  if (md) {
    const fromLocal =
      formatLocalStamp(md.local_timestamp)
      ?? formatLocalStamp(md.sample_end_local)
      ?? formatLocalStamp(md.sample_time_local)
      ?? (md.local_date && md.local_time
            ? formatLocalStamp(`${md.local_date}T${md.local_time}`)
            : null);
    if (fromLocal) return fromLocal;
  }
  return formatSyncTime(entry?.recordedAt);
}

/** 동기화 시각. synced_local_time 이 있으면 그것이 진짜 동기화 시각이다. */
export function syncTime(entry) {
  const t = formatLocalStamp(entry?.metadata?.synced_local_time);
  return t ?? metricTime(entry);
}

/**
 * metadata 의 현지 시각 문자열을 실제 시점(Date)으로.
 *   '2026-09-22T09:02:53-07:00' → 오프셋이 있으면 그대로
 *   '2026-09-23T09:27:14'       → 오프셋이 없으면 LA 벽시계로 읽는다
 * 여러 행의 동기화 시각을 비교할 때 쓴다. 못 읽으면 null.
 */
export function parseLocalStamp(value) {
  const s = String(value ?? '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return null;
  if (m[7]) return toDate(s.replace(' ', 'T'));

  const [, y, mo, d, h, mi, sec] = m.map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, sec || 0);
  // 그 벽시계 시각의 LA 오프셋을 구해 되돌린다 (서머타임 경계도 두 번 보정하면 맞는다)
  let t = wall;
  for (let i = 0; i < 2; i++) t = wall - laOffsetMs(new Date(t));
  return new Date(t);
}

/** 그 시점의 LA 오프셋 (UTC 대비 ms). PDT = -7h, PST = -8h */
function laOffsetMs(date) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(date);
  const g = (t) => Number(p.find((x) => x.type === t)?.value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}
