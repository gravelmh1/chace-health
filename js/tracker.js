// 약 복용 / 운동 횟수 기록 — 앱에서 직접 입력하는 값.
//
// Supabase 동기화 데이터(health_external_metrics)와 완전히 분리해서 저장한다.
// 측정값을 사람이 입력한 값으로 덮어쓰는 일이 없어야 한다.
//
// 저장 형태 (localStorage):
//   chace:log:<profileId> = {
//     "2026-09-17": { meds: { vitD: true }, ex: { pushup: 120, dumbbell: 90 } }
//   }

import {
  MEDICATIONS, EXERCISES, DUTA_DEFAULT_INTERVAL_DAYS,
  DAYS_TABLE, DAYS_COL as D,
} from './config.js';
import { getProfileId } from './settings.js';
import { laDateString } from './time.js';
import { selectRows } from './supabase.js';
import { pullSyncData } from './health-queries.js';

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

// ---------------------------------------------------------------------------
// 기록은 Supabase 의 health_cloud_days 에 있다.
//
// 이 앱에서 입력한 값은 브라우저에 따로 쌓이고(cloud 로 쓰지는 않는다),
// 화면에는 "클라우드 값 위에 로컬 수정본을 덮은" 결과를 보여준다.
// 클라우드를 덮어쓰지 않으므로 기존 기록이 손상될 일이 없다.
// ---------------------------------------------------------------------------

let cloudDays = {};   // { 'YYYY-MM-DD': { meds, workouts } }

/** workouts JSONB 에서 운동 값을 꺼낸다. 키 이름이 확정되지 않아 별칭도 함께 본다. */
function readWorkouts(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const ex of EXERCISES) {
    for (const key of [ex.id, ...(ex.aliases ?? [])]) {
      const v = Number(raw[key]);
      if (Number.isFinite(v) && v > 0) { out[ex.id] = Math.floor(v); break; }
    }
  }
  return out;
}

function readMeds(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const med of MEDICATIONS) if (raw[med.id]) out[med.id] = true;
  return out;
}

/**
 * events JSONB → 제목 배열.
 * 저장 형태가 확정되지 않아 문자열 배열과 객체 배열을 모두 받아들인다.
 */
function readEvents(raw) {
  const list = Array.isArray(raw) ? raw
    : (raw && typeof raw === 'object' ? Object.values(raw) : []);
  return list
    .map((e) => (typeof e === 'string' ? e : e?.title ?? e?.name ?? e?.label ?? ''))
    .map((t) => String(t).trim())
    .filter(Boolean);
}

function ingestDays(rows) {
  const days = {};
  for (const row of rows ?? []) {
    const day = String(row?.[D.day] ?? '').slice(0, 10);
    if (!day) continue;
    days[day] = {
      meds: readMeds(row[D.meds]),
      ex: readWorkouts(row[D.workouts]),
      events: readEvents(row[D.events]),
    };
  }
  return days;
}

/**
 * 클라우드 기록을 불러온다. RPC 응답에 들어 있으면 그것을 쓰고,
 * 없으면 테이블을 직접 읽는다. 실패해도 로컬 입력은 계속 동작한다.
 */
export async function loadCloudDays() {
  try {
    const pulled = await pullSyncData();
    if (pulled?.days?.length) {
      cloudDays = ingestDays(pulled.days);
      return { ok: true, via: 'rpc', count: Object.keys(cloudDays).length };
    }
  } catch { /* 아래 직접 조회로 넘어간다 */ }

  try {
    const rows = await selectRows(DAYS_TABLE, {
      select: [D.day, D.meds, D.workouts].join(','),
      [D.profileId]: `eq.${getProfileId()}`,
      order: `${D.day}.desc`,
      limit: '400',
    });
    cloudDays = ingestDays(rows);
    return { ok: true, via: 'table', count: Object.keys(cloudDays).length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 클라우드 값 위에 이 앱에서 입력한 로컬 수정본을 덮은 결과 */
export function loadLog() {
  const local = readJson(logKey(), {});
  const merged = {};
  for (const day of new Set([...Object.keys(cloudDays), ...Object.keys(local)])) {
    const c = cloudDays[day] ?? { meds: {}, ex: {}, events: [] };
    const l = local[day] ?? { meds: {}, ex: {}, events: [] };
    merged[day] = {
      meds: { ...c.meds, ...l.meds },
      ex: { ...c.ex, ...l.ex },
      // 클라우드 일정 + 이 앱에서 넣은 일정. 같은 제목은 한 번만.
      events: [...new Set([...(c.events ?? []), ...(l.events ?? [])])],
    };
  }
  return merged;
}

/** 이 앱에서 입력한 값만 (클라우드 제외) */
function loadLocal() {
  return readJson(logKey(), {});
}

export function dayEntry(log, dateStr) {
  return log[dateStr] || { meds: {}, ex: {}, events: [] };
}

/** 그 날의 운동 일정 (이 앱에서 입력한 것만) */
export function localEvents(dateStr) {
  return loadLocal()[dateStr]?.events ?? [];
}

/** 운동 일정 추가. 클라우드에는 쓰지 않고 브라우저에만 쌓는다. */
export function addEvent(dateStr, title) {
  const t = String(title || '').trim();
  if (!t) return;
  const log = loadLocal();
  const day = { meds: {}, ex: {}, events: [], ...log[dateStr] };
  day.events = [...new Set([...(day.events ?? []), t])];
  log[dateStr] = day;
  writeJson(logKey(), log);
}

export function removeEvent(dateStr, title) {
  const log = loadLocal();
  const day = log[dateStr];
  if (!day?.events) return;
  day.events = day.events.filter((e) => e !== title);
  log[dateStr] = day;
  writeJson(logKey(), log);
}

export function setMed(dateStr, medId, taken) {
  const log = loadLocal();
  const day = { meds: {}, ex: {}, events: [], ...log[dateStr] };
  day.meds = { ...day.meds };
  day.meds[medId] = !!taken; // false 도 남긴다 (클라우드의 true 를 덮기 위해)
  log[dateStr] = day;
  writeJson(logKey(), log);
  return log;
}

export function setExercise(dateStr, exId, count) {
  const log = loadLocal();
  const day = { meds: {}, ex: {}, events: [], ...log[dateStr] };
  day.ex = { ...day.ex };
  // 0 도 값으로 남긴다. 지워버리면 클라우드 값이 다시 올라와 '0 으로 내림'이 안 된다.
  day.ex[exId] = Math.max(0, Math.floor(Number(count) || 0));
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

/** 클라우드에서 읽어온 날짜 수 (진단용) */
export function cloudDayCount() {
  return Object.keys(cloudDays).length;
}

export { MEDICATIONS, EXERCISES };
