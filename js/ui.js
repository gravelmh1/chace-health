// 렌더링 + 갱신 트리거.
//
// "새로 열었는데 옛날 값" 문제를 막기 위한 재조회 시점:
//   - 최초 로드
//   - 탭이 다시 보일 때 (visibilitychange) — 홈으로 갔다 돌아온 경우
//   - bfcache 복원 (pageshow persisted) — iOS Safari 가 페이지를 통째로 되살릴 때
//   - '최신' 버튼
//
// 화면에 남은 값은 절대 재사용하지 않는다. 매번 DB 를 다시 읽는다.

import { fetchDashboard } from './health-queries.js';
import { isConfigured } from './supabase.js';
import { openSetup, initSetup } from './setup.js';
import {
  formatSyncTime, laToday, shiftDate, shortLabel,
} from './time.js';
import { openRenpho } from './open-renpho.js';
import { buildWeekGrid, gridRange, fetchCalendarEvents } from './calendar.js';
import { renderChart, renderLegend } from './chart.js';
import {
  loadLog, dayEntry, setMed, setExercise, exerciseTotal,
  medsDueOn, isDutaDay, MEDICATIONS, EXERCISES,
} from './tracker.js';
import { CHART_DAYS } from './config.js';

const $ = (id) => document.getElementById(id);
const DASH = '—';
const METERS_PER_MILE = 1609.344;
const STEP = 10; // +/- 버튼 증감 단위

/** 소수점 이하 불필요한 0 을 없앤다. 78.0 → '78', 78.3 → '78.3', 67.96 → '67.96' */
function trimNum(v, maxDigits = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return String(Number(v.toFixed(maxDigits)));
}
/** 항상 소수점 n자리 (BMI 23.9 / 24.0 처럼 자릿수를 고정해야 하는 값) */
function fixed(v, digits = 1) {
  return v === null || v === undefined || !Number.isFinite(v) ? DASH : v.toFixed(digits);
}
function int(v) {
  return v === null || v === undefined || !Number.isFinite(v)
    ? DASH : Math.round(v).toLocaleString('en-US');
}

let selectedDate = laToday();
let anchorDate = laToday();  // 달력이 가운데 두는 주
let monthEvents = {};

// --- 건강 데이터 카드 ---------------------------------------------------------

function renderRenpho(r) {
  $('renpho-weight').textContent = trimNum(r?.bodyMass?.value, 2);
  $('renpho-fat').textContent = fixed(r?.bodyFatPercentage?.value, 1);
  $('renpho-bmi').textContent = fixed(r?.bodyMassIndex?.value, 1);
  $('renpho-lean').textContent = trimNum(r?.leanBodyMass?.value, 2);
  $('renpho-synced').textContent = r?.syncedAt
    ? `${formatSyncTime(r.syncedAt)} 동기화`
    : '측정 기록 없음';
}

function renderApple(d) {
  // 동기화 시각 = Apple 계열에서 가장 최근 측정 시각
  const times = [d.steps?.recordedAt, d.heartRate?.recordedAt, d.distance?.recordedAt]
    .filter(Boolean)
    .sort();
  const synced = times[times.length - 1] ?? null;
  $('apple-synced').textContent = synced ? `${formatSyncTime(synced)} 동기화` : '동기화 기록 없음';

  $('steps-value').textContent = int(d.steps?.value);

  const note = $('steps-note');
  const meters = d.distance?.value;
  const miles = Number.isFinite(meters) ? (meters / METERS_PER_MILE).toFixed(1) : null;

  if (!d.steps) {
    note.textContent = '기록 없음';
    note.classList.add('stale');
  } else if (d.steps.isToday) {
    note.textContent = miles ? `${miles} mi 걷기·달리기` : '오늘 현재까지';
    note.classList.remove('stale');
  } else {
    note.textContent = `마지막 기록 ${d.steps.localDate ?? ''}`;
    note.classList.add('stale');
  }

  $('hr-value').textContent = int(d.heartRate?.value);
  $('hr-time').textContent = d.heartRate?.recordedAt
    ? `${formatSyncTime(d.heartRate.recordedAt)} 측정`
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
  $('status').hidden = false;
  $('status').textContent = '불러오는 중…';

  try {
    if (!isConfigured()) {
      $('status').hidden = false;
      $('status').textContent = 'Supabase anon key 가 필요합니다';
      renderErrors(['설정(⚙)에서 anon key 를 입력하세요']);
      openSetup();
      return;
    }

    const d = await fetchDashboard();
    renderRenpho(d.renpho);
    renderApple(d);
    renderErrors(d.errors);
    $('status').hidden = true;
  } catch (e) {
    $('status').hidden = false;
    $('status').textContent = '불러오기 실패';
    renderErrors([e.message]);
  } finally {
    btn.classList.remove('spinning');
    refreshing = false;
  }
}

// --- 3주 달력 -----------------------------------------------------------------

function markSvg(ex) {
  const shapes = {
    arrow: `<path d="M3 11 L11 3 M11 3 L11 8 M11 3 L6 3" stroke="${ex.color}" stroke-width="2" stroke-linecap="round" fill="none"/>`,
    diamond: `<path d="M7 1.5 L12.5 7 L7 12.5 L1.5 7 Z" fill="${ex.color}"/>`,
    circle: `<circle cx="7" cy="7" r="5" fill="${ex.color}"/>`,
    triangle: `<path d="M7 2 L12.5 11.5 L1.5 11.5 Z" fill="${ex.color}"/>`,
  };
  return `<svg class="ex-mark" viewBox="0 0 14 14" aria-hidden="true">${shapes[ex.shape] ?? shapes.circle}</svg>`;
}

async function renderCalendar() {
  const cells = buildWeekGrid(anchorDate);
  const [from, to] = gridRange(cells);

  try {
    monthEvents = await fetchCalendarEvents(from, to);
  } catch (e) {
    monthEvents = {}; // 일정을 못 가져와도 약/운동 입력은 계속 동작해야 한다
    console.warn('calendar fetch failed:', e.message);
  }

  const log = loadLog();
  const grid = $('cal-grid');
  grid.innerHTML = '';

  for (const cell of cells) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'cal-cell';
    if (cell.isToday) el.classList.add('today');
    if (cell.dateStr === selectedDate) el.classList.add('sel');

    const total = exerciseTotal(log, cell.dateStr);
    const taken = dayEntry(log, cell.dateStr).meds;
    const events = monthEvents[cell.dateStr] ?? [];

    let html = `<span class="d">${cell.day}</span>`;
    html += '<i class="tag vd">비D</i>';
    if (isDutaDay(cell.dateStr)) html += '<i class="tag dt">두타</i>';
    if (total) html += `<span class="cnt">${total}회</span>`;
    if (events.length) html += `<span class="evt">${events[0].title}</span>`;

    const dots = [];
    if (total) dots.push('<i class="dot ex"></i>');
    if (events.length) dots.push('<i class="dot ev"></i>');
    html += `<span class="dots">${dots.join('')}</span>`;

    el.innerHTML = html;
    el.addEventListener('click', () => {
      selectedDate = cell.dateStr;
      renderCalendar();
      renderEntry();
    });
    grid.appendChild(el);
  }
}

// --- 기록하기 -----------------------------------------------------------------

function renderEntry() {
  const [, m, d] = selectedDate.split('-');
  const wd = ['일', '월', '화', '수', '목', '금', '토'][
    new Date(`${selectedDate}T00:00:00Z`).getUTCDay()
  ];
  $('entry-date').textContent = `${Number(m)}월 ${Number(d)}일 (${wd})`;

  const log = loadLog();
  const day = dayEntry(log, selectedDate);

  // 운동 타일
  const grid = $('ex-grid');
  grid.innerHTML = '';
  for (const ex of EXERCISES) {
    const count = day.ex[ex.id] ?? 0;
    const tile = document.createElement('div');
    tile.className = 'ex-tile';
    tile.innerHTML =
      `<div class="ex-top"><span class="ex-name">${ex.label}</span>${markSvg(ex)}</div>
       <div class="ex-ctl">
         <button type="button" class="rnd minus" aria-label="${ex.label} ${STEP}회 빼기">−</button>
         <span class="ex-val">${count}<em>회</em></span>
         <button type="button" class="rnd plus" aria-label="${ex.label} ${STEP}회 더하기">+</button>
       </div>`;

    const commit = (v) => {
      setExercise(selectedDate, ex.id, v);
      renderEntry();
      renderCalendar();
      renderChartCard();
    };
    tile.querySelector('.minus').addEventListener('click', () => commit(count - STEP));
    tile.querySelector('.plus').addEventListener('click', () => commit(count + STEP));
    grid.appendChild(tile);
  }

  // 약
  const due = medsDueOn(selectedDate);
  const medBox = $('med-list');
  medBox.innerHTML = '';
  for (const med of MEDICATIONS) {
    const isDue = due.some((x) => x.id === med.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `med ${med.id === 'duta' ? 'dt' : 'vd'}` +
      (day.meds[med.id] ? ' on' : '') + (isDue ? '' : ' off-day');
    btn.disabled = !isDue;
    btn.textContent = med.label;
    btn.title = isDue ? '' : '복용 예정일이 아닙니다';
    btn.addEventListener('click', () => {
      setMed(selectedDate, med.id, !day.meds[med.id]);
      renderEntry();
      renderCalendar();
    });
    medBox.appendChild(btn);
  }
}

// --- 최근 2주 운동 ------------------------------------------------------------

function renderChartCard() {
  const log = loadLog();
  const today = laToday();
  const dates = [];
  for (let i = CHART_DAYS - 1; i >= 0; i--) dates.push(shiftDate(today, -i));

  const series = {};
  for (const ex of EXERCISES) {
    series[ex.id] = dates.map((d) => dayEntry(log, d).ex[ex.id] ?? 0);
  }

  $('chart-legend').innerHTML = renderLegend(series);
  $('chart-body').innerHTML = renderChart(dates, series);
}

// --- 초기화 -------------------------------------------------------------------

function renderAllLocal() {
  renderCalendar();
  renderEntry();
  renderChartCard();
}

export function init() {
  const today = laToday();
  selectedDate = today;
  anchorDate = today;

  const [, m, d] = today.split('-');
  const wd = ['일', '월', '화', '수', '목', '금', '토'][
    new Date(`${today}T00:00:00Z`).getUTCDay()
  ];
  $('today-label').textContent = `${Number(m)}월 ${Number(d)}일 (${wd})`;

  $('refresh-btn').addEventListener('click', () => { refresh(); renderAllLocal(); });
  $('setup-btn').addEventListener('click', openSetup);
  $('renpho-card').addEventListener('click', openRenpho);
  $('cal-today').addEventListener('click', () => {
    selectedDate = laToday();
    anchorDate = laToday();
    renderCalendar();
    renderEntry();
  });
  // + 버튼: 선택한 날짜의 모든 운동을 한 번에 올린다
  $('entry-add').addEventListener('click', () => {
    const log = loadLog();
    const day = dayEntry(log, selectedDate);
    for (const ex of EXERCISES) setExercise(selectedDate, ex.id, (day.ex[ex.id] ?? 0) + STEP);
    renderEntry();
    renderCalendar();
    renderChartCard();
  });
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
