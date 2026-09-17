// 렌더링 + 갱신 트리거.
//
// "새로 열었는데 옛날 값" 문제를 막기 위한 재조회 시점:
//   - 최초 로드
//   - 탭이 다시 보일 때 (visibilitychange) — 홈으로 갔다 돌아온 경우
//   - bfcache 복원 (pageshow persisted) — iOS Safari 가 페이지를 통째로 되살릴 때
//   - 새로고침 버튼
//
// 화면에 남은 값은 절대 재사용하지 않는다. 매번 DB 를 다시 읽는다.

import { fetchDashboard } from './health-queries.js';
import { isConfigured } from './supabase.js';
import { formatDateTime, formatDate, formatRelative, laToday } from './time.js';
import { openRenpho } from './open-renpho.js';
import {
  buildMonthGrid, fetchCalendarEvents, loadWorkouts, saveWorkoutCount,
} from './calendar.js';

const $ = (id) => document.getElementById(id);

const DASH = '—';

/** 숫자 포맷. null 이면 대시(측정값 없음) — 절대 0 으로 대체하지 않는다. */
function num(v, digits = 1) {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return v.toFixed(digits);
}

function int(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return Math.round(v).toLocaleString('en-US');
}

// --- 대시보드 ---------------------------------------------------------------

function renderRenpho(r) {
  $('renpho-weight').textContent = num(r?.bodyMass?.value, 1);
  $('renpho-fat').textContent = num(r?.bodyFatPercentage?.value, 1);
  $('renpho-bmi').textContent = num(r?.bodyMassIndex?.value, 1);
  $('renpho-lean').textContent = num(r?.leanBodyMass?.value, 2);

  $('renpho-synced').textContent = r?.syncedAt
    ? `${formatDateTime(r.syncedAt)} · ${formatRelative(r.syncedAt)}`
    : '측정 기록 없음';
}

function renderHeartRate(hr) {
  $('hr-value').textContent = int(hr?.value);
  $('hr-time').textContent = hr?.measuredAt
    ? `${formatDateTime(hr.measuredAt)} · ${formatRelative(hr.measuredAt)}`
    : '측정 기록 없음';
}

function renderSteps(s) {
  $('steps-value').textContent = int(s?.value);

  const note = $('steps-note');
  if (!s) {
    note.textContent = '기록 없음';
    note.classList.remove('stale');
  } else if (s.isToday) {
    // 오늘은 아직 진행 중이므로 "현재까지" 라고 명시한다.
    note.textContent = `오늘 (${formatDate(laToday() + 'T12:00:00Z')}) 현재까지`;
    note.classList.remove('stale');
  } else {
    note.textContent = `오늘 집계 없음 · 마지막 기록 ${s.localDate ?? formatDate(s.measuredAt)}`;
    note.classList.add('stale');
  }
}

function renderErrors(errors) {
  const box = $('errors');
  if (!errors?.length) {
    box.hidden = true;
    box.textContent = '';
    return;
  }
  box.hidden = false;
  box.textContent = `일부 항목을 불러오지 못했습니다: ${errors.join(' / ')}`;
}

let refreshing = false;

export async function refresh() {
  if (refreshing) return;
  refreshing = true;

  const btn = $('refresh-btn');
  btn.classList.add('spinning');
  $('status').textContent = '불러오는 중…';

  try {
    if (!isConfigured) {
      $('status').textContent = 'js/config.js 에 Supabase anon key 를 넣어주세요';
      renderErrors(['SUPABASE_ANON_KEY 미설정']);
      return;
    }

    const d = await fetchDashboard();
    renderRenpho(d.renpho);
    renderHeartRate(d.heartRate);
    renderSteps(d.steps);
    renderErrors(d.errors);
    $('status').textContent = `업데이트 ${formatDateTime(d.fetchedAt)}`;
  } catch (e) {
    $('status').textContent = '불러오기 실패';
    renderErrors([e.message]);
  } finally {
    btn.classList.remove('spinning');
    refreshing = false;
  }
}

// --- 달력 -------------------------------------------------------------------

let viewYear;
let viewMonth; // 1-12

async function renderCalendar() {
  $('cal-label').textContent = `${viewYear}년 ${viewMonth}월`;

  const grid = $('cal-grid');
  grid.innerHTML = '';

  const workouts = loadWorkouts();
  let events = {};
  try {
    events = await fetchCalendarEvents(viewYear, viewMonth);
  } catch (e) {
    // 달력 일정을 못 가져와도 운동 기록 입력은 계속 동작해야 한다.
    console.warn('calendar fetch failed:', e.message);
  }

  for (const cell of buildMonthGrid(viewYear, viewMonth)) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'cal-cell';

    if (!cell.inMonth) {
      el.classList.add('empty');
      el.disabled = true;
      grid.appendChild(el);
      continue;
    }

    if (cell.isToday) el.classList.add('today');

    const count = workouts[cell.dateStr];
    if (count) el.classList.add('has-workout');
    if (events[cell.dateStr]?.length) el.classList.add('has-event');

    el.innerHTML =
      `<span class="d">${cell.day}</span>` +
      (count ? `<span class="wk">${count}</span>` : '') +
      (events[cell.dateStr]?.length ? '<span class="ev"></span>' : '');

    el.addEventListener('click', () => promptWorkout(cell.dateStr, workouts[cell.dateStr]));
    grid.appendChild(el);
  }
}

function promptWorkout(dateStr, current) {
  const input = window.prompt(`${dateStr} 운동 횟수 (0 = 삭제)`, current ?? '');
  if (input === null) return;
  saveWorkoutCount(dateStr, input);
  renderCalendar();
}

function shiftMonth(delta) {
  viewMonth += delta;
  if (viewMonth < 1) { viewMonth = 12; viewYear -= 1; }
  if (viewMonth > 12) { viewMonth = 1; viewYear += 1; }
  renderCalendar();
}

// --- 초기화 -----------------------------------------------------------------

export function init() {
  const [y, m] = laToday().split('-');
  viewYear = Number(y);
  viewMonth = Number(m);

  $('refresh-btn').addEventListener('click', () => { refresh(); renderCalendar(); });
  $('renpho-card').addEventListener('click', openRenpho);
  $('cal-prev').addEventListener('click', () => shiftMonth(-1));
  $('cal-next').addEventListener('click', () => shiftMonth(1));

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) refresh(); // bfcache 복원
  });

  refresh();
  renderCalendar();
}
