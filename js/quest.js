// 하루 퀘스트 판정 — 규칙은 config.js 의 QUEST.
//
// 기록(운동 횟수, 프로틴 체크)은 tracker.js 에 그대로 있고, 여기서는 읽어서 판정만 한다.

import { QUEST, EXERCISES } from './config.js';
import { dayEntry } from './tracker.js';
import { shiftDate } from './time.js';

const dow = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay();

export const isWeekend = (dateStr) => [0, 6].includes(dow(dateStr));

/** 그 날의 세트 (주말이면 null) */
export function setFor(dateStr) {
  return QUEST.sets[dow(dateStr)] ?? null;
}

const label = (id) => EXERCISES.find((e) => e.id === id)?.label ?? id;

/** 그 날 퀘스트 진행 상태 */
export function questStatus(log, dateStr) {
  const day = dayEntry(log, dateStr);
  const pushup = Number(day.ex.pushup) || 0;
  const set = setFor(dateStr);
  const setLeft = set ? set.ids.filter((id) => !(Number(day.ex[id]) > 0)) : [];
  const protein = !!day.meds[QUEST.proteinId];

  const pushupDone = pushup >= QUEST.pushupGoal;
  const setDone = !set || setLeft.length === 0;
  return {
    pushup,
    goal: QUEST.pushupGoal,
    pushupDone,
    set,
    setDone,
    setLeft: setLeft.map(label),
    protein,
    cleared: pushupDone && setDone && protein,
  };
}

/**
 * 연속 클리어 일수. 오늘을 아직 못 깼어도 어제까지 이어졌으면 그 수를 보여 준다
 * (오늘은 아직 끝나지 않았으니 끊긴 게 아니다).
 */
export function streak(log, today) {
  let d = questStatus(log, today).cleared ? today : shiftDate(today, -1);
  let n = 0;
  while (n < 400 && questStatus(log, d).cleared) {
    n += 1;
    d = shiftDate(d, -1);
  }
  return n;
}
