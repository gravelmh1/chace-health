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
