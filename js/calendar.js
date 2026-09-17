// 운동 달력 — 월 단위 그리드 + 날짜별 운동 횟수 + Google Calendar 일정 표시.
//
// 날짜 키는 전부 LA 기준 'YYYY-MM-DD' 문자열이다.
// Date 객체의 getDate()/getMonth() 로 칸을 만들면 브라우저 시간대에 따라
// 하루가 밀리므로, 그리드 생성도 LA 날짜 문자열을 기준으로 한다.

import { selectRows } from './supabase.js';
import { CALENDAR_TABLE, CALENDAR_COL as CC } from './config.js';
import { getProfileId } from './settings.js';
import { laDateString, laToday, toDate } from './time.js';

const workoutKey = () => `chace:workouts:${getProfileId()}`;

// --- 운동 횟수 입력 (로컬 저장) -------------------------------------------
// 주의: 이건 사용자가 앱에서 직접 입력하는 값이라 Supabase 동기화 데이터와
// 별개다. health_external_metrics 를 덮어쓰지 않는다.

export function loadWorkouts() {
  try {
    return JSON.parse(localStorage.getItem(workoutKey()) || '{}');
  } catch {
    return {};
  }
}

export function saveWorkoutCount(dateStr, count) {
  const all = loadWorkouts();
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) delete all[dateStr];
  else all[dateStr] = Math.floor(n);
  try {
    localStorage.setItem(workoutKey(), JSON.stringify(all));
  } catch { /* 저장 실패해도 화면은 계속 동작 */ }
  return all;
}

// --- Google Calendar 운동 일정 --------------------------------------------

/** 해당 월(LA 기준)의 일정을 날짜별로 묶어서 반환 */
export async function fetchCalendarEvents(year, month /* 1-12 */) {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  const next = `${nextY}-${String(nextM).padStart(2, '0')}-01`;

  let rows;
  try {
    rows = await selectRows(CALENDAR_TABLE, {
      select: `${CC.title},${CC.startsAt},${CC.endsAt},${CC.source}`,
      [CC.profileId]: `eq.${getProfileId()}`,
      // 경계는 넉넉히 잡고(오프셋 여유) LA 날짜로 다시 거른다. 시간대 때문에
      // 월 끝자락 일정이 잘리는 것을 막기 위함.
      [CC.startsAt]: `gte.${first}T00:00:00-08:00`,
      order: `${CC.startsAt}.asc`,
      and: `(${CC.startsAt}.lt.${next}T00:00:00-07:00)`,
    });
  } catch (e) {
    throw new Error(`calendar: ${e.message}`);
  }

  const byDate = {};
  for (const row of rows) {
    const d = toDate(row[CC.startsAt]);
    if (!d) continue;
    const key = laDateString(d);
    (byDate[key] ||= []).push({
      title: row[CC.title] || '일정',
      startsAt: row[CC.startsAt],
    });
  }
  return byDate;
}

// --- 그리드 생성 ------------------------------------------------------------

/**
 * 해당 월의 달력 칸 배열.
 * 각 칸: { dateStr, day, inMonth, isToday }
 */
export function buildMonthGrid(year, month /* 1-12 */) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // 1일의 요일 (0=일). UTC 로 계산해야 브라우저 시간대 영향을 안 받는다.
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const today = laToday();

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ dateStr: null, day: null, inMonth: false, isToday: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ dateStr, day, inMonth: true, isToday: dateStr === today });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ dateStr: null, day: null, inMonth: false, isToday: false });
  }
  return cells;
}
