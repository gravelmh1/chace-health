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
import { openSetup, initSetup } from './setup.js';
import {
  formatSyncTime, formatRelative, formatHeaderDate, laToday,
} from './time.js';
import { openRenpho } from './open-renpho.js';
import { buildMonthGrid, fetchCalendarEvents } from './calendar.js';
import {
  loadLog, dayEntry, setMed, setExercise, exerciseTotal,
  medsDueOn, medProgress, isDutaDay, MEDICATIONS, EXERCISES,
} from './tracker.js';

const $ = (id) => document.getElementById(id);
const DASH = '—';
const METERS_PER_MILE = 1609.344;

/** 측정값이 없으면 대시. 절대 0 으로 대체하지 않는다. */
function num(v, digits = 1) {
  return v === null || v === undefined || !Number.isFinite(v) ? DASH : v.toFixed(digits);
}
function int(v) {
  return v === null || v === undefined || !Number.isFinite(v)
    ? DASH : Math.round(v).toLocaleString('en-US');
}

let selectedDate = laToday();
let viewYear;
let viewMonth; // 1-12
let lastWeight = null;

// --- 건강 데이터 카드 ---------------------------------------------------------

function renderRenpho(r) {
  $('renpho-weight').textContent = num(r?.bodyMass?.value, 1);
  $('renpho-fat').textContent = num(r?.bodyFatPercentage?.value, 1);
  $('renpho-bmi').textContent = num(r?.bodyMassIndex?.value, 1);
  $('renpho-lean').textContent = num(r?.leanBodyMass?.value, 2);

  $('renpho-synced').textContent = r?.syncedAt
    ? `${formatSyncTime(r.syncedAt)} 동기화`
    : '측정 기록 없음';

  lastWeight = r?.bodyMass?.value ?? null;
  $('sum-weight').textContent = num(lastWeight, 1);
}

function renderApple(d) {
  // 걸음수
  $('steps-value').textContent = int(d.steps?.value);
  const note = $('steps-note');
  if (!d.steps) {
    note.textContent = '걸음 · 기록 없음';
    note.classList.remove('stale');
  } else if (d.steps.isToday) {
    note.textContent = '걸음 · 오늘 현재까지';
    note.classList.remove('stale');
  } else {
    note.textContent = `걸음 · 마지막 기록 ${d.steps.localDate ?? ''}`;
    note.classList.add('stale');
  }

  // 거리: m 로 저장되므로 mi 로 환산해 표시한다
  const meters = d.distance?.value;
  $('dist-value').textContent =
    Number.isFinite(meters) ? (meters / METERS_PER_MILE).toFixed(1) : DASH;

  // 심박수
  $('hr-value').textContent = int(d.heartRate?.value);
  $('hr-time').textContent = d.heartRate?.recordedAt
    ? `${formatSyncTime(d.heartRate.recordedAt)} · ${formatRelative(d.heartRate.recordedAt)}`
    : '기록 없음';
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
    if (!isConfigured()) {
      $('status').textContent = 'Supabase anon key 가 필요합니다';
      renderErrors(['설정(⚙)에서 anon key 를 입력하세요']);
      openSetup();
      return;
    }

    const d = await fetchDashboard();
    renderRenpho(d.renpho);
    renderApple(d);
    renderErrors(d.errors);
    $('status').textContent = `업데이트 ${formatSyncTime(d.fetchedAt)}`;
  } catch (e) {
    $('status').textContent = '불러오기 실패';
    renderErrors([e.message]);
  } finally {
    btn.classList.remove('spinning');
    refreshing = false;
  }
}

// --- 달력 ---------------------------------------------------------------------

let monthEvents = {};

async function renderCalendar() {
  $('cal-label').textContent = `${viewYear}년 ${viewMonth}월`;

  try {
    monthEvents = await fetchCalendarEvents(viewYear, viewMonth);
  } catch (e) {
    // 일정을 못 가져와도 약/운동 입력은 계속 동작해야 한다.
    monthEvents = {};
    console.warn('calendar fetch failed:', e.message);
  }

  const log = loadLog();
  const grid = $('cal-grid');
  grid.innerHTML = '';

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
    if (cell.dateStr === selectedDate) el.classList.add('sel');

    const total = exerciseTotal(log, cell.dateStr);
    const taken = dayEntry(log, cell.dateStr).meds;
    const tags = [];

    // 비D 는 매일, 두타는 복용 예정일에만
    tags.push(`<i class="tag vd${taken.vitaminD ? ' on' : ''}">비D</i>`);
    if (isDutaDay(cell.dateStr)) {
      tags.push(`<i class="tag dt${taken.duta ? ' on' : ''}">두타</i>`);
    }

    el.innerHTML =
      `<span class="d">${cell.day}</span>` +
      `<span class="tags">${tags.join('')}</span>` +
      (total ? `<span class="cnt">${total}회</span>` : '') +
      (monthEvents[cell.dateStr]?.length ? '<span class="ev"></span>' : '');

    el.addEventListener('click', () => {
      selectedDate = cell.dateStr;
      renderCalendar();
      renderEntry();
    });
    grid.appendChild(el);
  }
}

// --- 선택한 날짜의 약 / 운동 입력 ----------------------------------------------

function renderEntry() {
  $('entry-label').textContent = formatHeaderDate(selectedDate);

  const log = loadLog();
  const day = dayEntry(log, selectedDate);
  const due = medsDueOn(selectedDate);

  // 약
  const medBox = $('med-list');
  medBox.innerHTML = '';
  for (const med of MEDICATIONS) {
    const isDue = due.some((m) => m.id === med.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `med${day.meds[med.id] ? ' on' : ''}${isDue ? '' : ' off-day'}`;
    btn.disabled = !isDue;
    btn.textContent = med.label;
    btn.title = isDue ? '' : '복용 예정일이 아닙니다';
    btn.addEventListener('click', () => {
      setMed(selectedDate, med.id, !day.meds[med.id]);
      renderEntry();
      renderCalendar();
      renderSummary();
    });
    medBox.appendChild(btn);
  }

  // 운동
  const exBox = $('ex-list');
  exBox.innerHTML = '';
  for (const ex of EXERCISES) {
    const count = day.ex[ex.id] ?? 0;
    const rowEl = document.createElement('div');
    rowEl.className = 'ex-row';
    rowEl.innerHTML =
      `<span class="ex-name">${ex.label}</span>` +
      `<div class="stepper">
         <button type="button" class="st minus" aria-label="${ex.label} 줄이기">−</button>
         <input class="ex-count" type="number" min="0" step="1" inputmode="numeric" value="${count}">
         <button type="button" class="st plus" aria-label="${ex.label} 늘리기">+</button>
       </div>`;

    const input = rowEl.querySelector('.ex-count');
    const commit = (v) => {
      setExercise(selectedDate, ex.id, v);
      renderEntry();
      renderCalendar();
      renderSummary();
    };
    rowEl.querySelector('.minus').addEventListener('click', () => commit(Number(input.value) - 10));
    rowEl.querySelector('.plus').addEventListener('click', () => commit(Number(input.value) + 10));
    input.addEventListener('change', () => commit(input.value));

    exBox.appendChild(rowEl);
  }
}

function renderSummary() {
  const log = loadLog();
  const today = laToday();
  $('sum-ex').textContent = exerciseTotal(log, today);
  const { done, total } = medProgress(log, today);
  $('sum-med').textContent = `${done}/${total}`;
  $('sum-weight').textContent = num(lastWeight, 1);
}

function shiftMonth(delta) {
  viewMonth += delta;
  if (viewMonth < 1) { viewMonth = 12; viewYear -= 1; }
  if (viewMonth > 12) { viewMonth = 1; viewYear += 1; }
  renderCalendar();
}

// --- 초기화 -------------------------------------------------------------------

function renderAllLocal() {
  renderCalendar();
  renderEntry();
  renderSummary();
}

export function init() {
  const today = laToday();
  selectedDate = today;
  const [y, m] = today.split('-');
  viewYear = Number(y);
  viewMonth = Number(m);

  $('today-label').textContent = formatHeaderDate();

  $('refresh-btn').addEventListener('click', () => { refresh(); renderAllLocal(); });
  $('setup-btn').addEventListener('click', openSetup);
  $('renpho-card').addEventListener('click', openRenpho);
  $('cal-prev').addEventListener('click', () => shiftMonth(-1));
  $('cal-next').addEventListener('click', () => shiftMonth(1));
  initSetup(() => { refresh(); renderAllLocal(); });

  const setupOpen = () => !$('setup').hidden;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !setupOpen()) refresh();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && !setupOpen()) refresh(); // bfcache 복원
  });

  refresh();
  renderAllLocal();
}
