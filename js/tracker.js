// 약 복용 / 운동 횟수 기록 — 앱에서 직접 입력하는 값.
//
// Supabase 동기화 데이터(health_external_metrics)와 완전히 분리해서 저장한다.
// 측정값을 사람이 입력한 값으로 덮어쓰는 일이 없어야 한다.
//
// 저장 형태 (localStorage):
//   chace:log:<profileId> = {
//     "2026-09-17": { meds: { vitaminD: true }, ex: { pushup: 120, dumbbell: 90 } }
//   }

import { MEDICATIONS, EXERCISES, DUTA_DEFAULT_INTERVAL_DAYS } from './config.js';
import { getProfileId } from './settings.js';
import { laDateString } from './time.js';

const logKey = () => `chace:log:${getProfileId()}`;
const dutaKey = () => `chace:duta:${getProfileId()}`;

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback; // 프라이빗 모드 등에서 막혀도 화면은 계속 동작해야 한다
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadLog() {
  return readJson(logKey(), {});
}

export function dayEntry(log, dateStr) {
  return log[dateStr] || { meds: {}, ex: {} };
}

export function setMed(dateStr, medId, taken) {
  const log = loadLog();
  const day = { meds: {}, ex: {}, ...log[dateStr] };
  day.meds = { ...day.meds };
  if (taken) day.meds[medId] = true;
  else delete day.meds[medId];
  log[dateStr] = day;
  writeJson(logKey(), log);
  return log;
}

export function setExercise(dateStr, exId, count) {
  const log = loadLog();
  const day = { meds: {}, ex: {}, ...log[dateStr] };
  day.ex = { ...day.ex };
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n > 0) day.ex[exId] = n;
  else delete day.ex[exId];
  log[dateStr] = day;
  writeJson(logKey(), log);
  return log;
}

/** 그 날 운동 총 횟수 (달력 칸에 찍는 숫자) */
export function exerciseTotal(log, dateStr) {
  const ex = dayEntry(log, dateStr).ex;
  return Object.values(ex).reduce((a, b) => a + (Number(b) || 0), 0);
}

// --- 두타 복용 주기 -----------------------------------------------------------
// 원본 앱의 주기를 확인할 수 없어 설정으로 뺐다. 기본값은 매일.

export function getDutaSchedule() {
  const s = readJson(dutaKey(), null);
  return {
    intervalDays: Number(s?.intervalDays) > 0 ? Number(s.intervalDays) : DUTA_DEFAULT_INTERVAL_DAYS,
    anchor: s?.anchor || laDateString(new Date()),
  };
}

export function setDutaSchedule(intervalDays, anchor) {
  const n = Math.max(1, Math.floor(Number(intervalDays) || 1));
  return writeJson(dutaKey(), { intervalDays: n, anchor: anchor || laDateString(new Date()) });
}

/** dateStr 이 두타 복용 예정일인지. 날짜 문자열끼리만 비교해 시간대 영향을 받지 않는다. */
export function isDutaDay(dateStr) {
  const { intervalDays, anchor } = getDutaSchedule();
  if (intervalDays === 1) return true;
  const days = Math.round((Date.parse(`${dateStr}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86400000);
  return Number.isFinite(days) && ((days % intervalDays) + intervalDays) % intervalDays === 0;
}

/** 그 날 먹어야 하는 약 목록 */
export function medsDueOn(dateStr) {
  return MEDICATIONS.filter((m) => m.daily || (m.id === 'duta' && isDutaDay(dateStr)));
}

/** '1/2' 형태의 약 복용 진행률 */
export function medProgress(log, dateStr) {
  const due = medsDueOn(dateStr);
  const taken = dayEntry(log, dateStr).meds;
  return { done: due.filter((m) => taken[m.id]).length, total: due.length };
}

export { MEDICATIONS, EXERCISES };
