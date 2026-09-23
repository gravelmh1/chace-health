// Google Calendar 운동 일정 조회 + 달력 그리드 생성.
//
// 날짜 키는 전부 LA 기준 'YYYY-MM-DD' 문자열이다.
// Date 객체의 getDate()/getMonth() 로 칸을 만들면 브라우저 시간대에 따라
// 하루가 밀리므로, 그리드 생성도 UTC 기준 계산 + LA 날짜 문자열로 처리한다.

import { selectRows } from './supabase.js';
import { CALENDAR_TABLE, CALENDAR_COL as CC, WORKOUT_CATEGORY, CALENDAR_WEEKS } from './config.js';
import { getProfileId } from './settings.js';
import { laDateString, laToday, toDate, weekStart, shiftDate } from './time.js';
import { pullSyncData } from './health-queries.js';

/**
 * [fromDate, toDate] 범위(LA 기준 날짜 문자열)의 일정을 날짜별로 묶어서 반환.
 * 컬럼은 start_at / end_at 이다 (starts_at / ends_at 아님).
 */
export async function fetchCalendarEvents(fromDate, toDate_) {
  const first = fromDate;
  const next = shiftDate(toDate_, 1);

  // RLS 때문에 테이블 직접 조회가 막힌 환경에서도 동작하도록,
  // RPC 응답이 있으면 거기서 일정을 꺼내 쓴다.
  // RPC 가 응답했다면 일정이 0건이어도 그게 답이다 (막힌 테이블로 다시 가지 않는다).
  const pulled = await pullSyncData();
  if (pulled) {
    return groupByDate((pulled.events ?? []).filter((r) => {
      const d = laDateString(toDate(r[CC.startAt]) ?? 0);
      return d >= fromDate && d <= toDate_;
    }));
  }

  let rows;
  try {
    rows = await selectRows(CALENDAR_TABLE, {
      select: [CC.title, CC.category, CC.startAt, CC.endAt, CC.location, CC.source].join(','),
      [CC.profileId]: `eq.${getProfileId()}`,
      // 경계는 오프셋 여유를 두고 넉넉히 잡은 뒤 LA 날짜로 다시 거른다.
      // 시간대 때문에 월 끝자락 일정이 잘리는 것을 막기 위함.
      [CC.startAt]: `gte.${first}T00:00:00-08:00`,
      and: `(${CC.startAt}.lt.${next}T00:00:00-07:00)`,
      order: `${CC.startAt}.asc`,
    });
  } catch (e) {
    throw new Error(`calendar: ${e.message}`);
  }

  return groupByDate(rows);
}

function groupByDate(rows) {
  const byDate = {};
  for (const row of rows) {
    const d = toDate(row[CC.startAt]);
    if (!d) continue;
    const key = laDateString(d);
    (byDate[key] ||= []).push({
      title: row[CC.title] || '일정',
      category: row[CC.category] ?? null,
      isWorkout: row[CC.category] === WORKOUT_CATEGORY,
      location: row[CC.location] ?? null,
      startAt: row[CC.startAt],
    });
  }
  return byDate;
}

/**
 * 기준 날짜가 속한 주를 가운데 둔 3주치 달력.
 * 일요일 시작이며, 칸은 항상 7 × CALENDAR_WEEKS 개다.
 *
 * 월 단위가 아니라 주 단위라 "이번 주 앞뒤"가 항상 같이 보인다.
 * 월 경계에서 빈 칸이 생기지 않는다.
 *
 * 각 칸: { dateStr, day, isToday, isAnchor }
 */
export function buildWeekGrid(anchorDate, weeks = CALENDAR_WEEKS) {
  const today = laToday();
  const start = shiftDate(weekStart(anchorDate), -7 * Math.floor((weeks - 1) / 2));

  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const dateStr = shiftDate(start, i);
    cells.push({
      dateStr,
      day: Number(dateStr.slice(8, 10)),
      isToday: dateStr === today,
      isAnchor: dateStr === anchorDate,
    });
  }
  return cells;
}

/** 그리드의 첫날 / 마지막날 (일정 조회 범위) */
export function gridRange(cells) {
  return [cells[0].dateStr, cells[cells.length - 1].dateStr];
}
