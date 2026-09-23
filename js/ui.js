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
  formatSyncTime, metricTime, syncTime, laToday, shiftDate, shortLabel,
} from './time.js';
import {
  openRenpho, openAppleHealth, canOpenRenpho, canOpenAppleHealth,
} from './open-renpho.js';
import { buildWeekGrid, gridRange, fetchCalendarEvents } from './calendar.js';
import { renderChart, renderLegend } from './chart.js';
import {
  loadLog, dayEntry, setMed, setExercise, exerciseTotal,
  medsDueOn, isDutaDay, loadCloudDays, localEvents, addEvent, removeEvent,
  MEDICATIONS, EXERCISES,
} from './tracker.js';
import { CHART_DAYS } from './config.js';
import { APP_VERSION, checkForUpdate } from './version.js';
import { consumeKeyFromUrl } from './key-link.js';
import { repairKey } from './key-repair.js';
import { checkKey } from './supabase.js';
import { getAnonKey, setAnonKey } from './settings.js';

const $ = (id) => document.getElementById(id);

/** 사용자가 입력한 일정 이름을 그대로 마크업에 넣지 않는다 */
function escapeHtml(t) {
  return String(t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
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
  // 표시 시각은 metadata 의 현지 시각을 우선한다. recorded_at 을 변환해 쓰면
  // 일일 집계처럼 기준 시각이 따로 있는 행에서 어긋난다.
  const latest = ['bodyMass', 'bodyFatPercentage', 'bodyMassIndex', 'leanBodyMass']
    .map((k) => r?.[k])
    .filter((m) => m?.recordedAt)
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))[0];

  $('renpho-synced').textContent = latest
    ? `${metricTime(latest)} 동기화`
    : '측정 기록 없음';
}

function renderApple(d) {
  // 동기화 시각: metadata.synced_local_time 이 실제 동기화 시각이다.
  // 일일 집계 행의 recorded_at 은 집계 기준 시각이라 동기화 시각이 아니다.
  const appleEntries = [d.steps, d.heartRate, d.distance]
    .filter((m) => m?.recordedAt)
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  const withSync = appleEntries.find((m) => m?.metadata?.synced_local_time) ?? appleEntries[0];
  $('apple-synced').textContent = withSync
    ? `${syncTime(withSync)} 동기화`
    : '동기화 기록 없음';

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
    ? `${metricTime(d.heartRate)} 측정`
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
let repairTried = false;

/**
 * 저장된 키가 거부되면 헷갈리는 글자를 바꿔 가며 맞는 키를 찾는다.
 * 링크나 손입력으로 들어온 키가 한 글자 틀렸을 때, 설정을 열지 않아도 스스로 낫는다.
 * 세션당 한 번만 시도한다 — 매번 수백 번씩 요청을 보내지 않기 위해서다.
 */
async function autoRepairKey() {
  if (repairTried) return false;
  repairTried = true;

  const key = getAnonKey();
  if (!key) return false;

  const probe = await checkKey();
  // 권한/RLS 문제라면 글자를 바꿔 봐야 소용없다. 키가 거부된 경우에만 시도한다.
  if (probe.ok || !probe.badKey) return false;

  $('status').hidden = false;
  const result = await repairKey(key, (done, total) => {
    $('status').textContent = `키를 맞춰 보는 중… ${done}/${total}`;
  });

  if (result.found) {
    setAnonKey(result.found);
    return true;
  }
  return false;
}

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

    // 키가 거부되면 한 번은 스스로 고쳐 본 뒤 읽는다.
    if (await autoRepairKey()) $('status').textContent = '키를 찾았습니다. 불러오는 중…';

    // 측정값과 기록(약·운동)을 함께 불러온다. 한쪽이 실패해도 다른 쪽은 보여준다.
    const [d, days] = await Promise.all([fetchDashboard(), loadCloudDays()]);

    renderRenpho(d.renpho);
    renderApple(d);
    renderAllLocal(); // 클라우드 기록이 들어온 뒤 달력·차트를 다시 그린다

    const errors = [...d.errors];
    if (!days.ok) errors.push(`기록(약·운동): ${days.error}`);
    renderErrors(errors);
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
    const events = monthEvents[cell.dateStr] ?? [];

    // 일정: 앱에서 넣은 것 + 클라우드 기록의 events + Google Calendar
    const titles = [...new Set([
      ...dayEntry(log, cell.dateStr).events,
      ...events.map((e) => e.title),
    ])];

    // 칸마다 같은 자리에 같은 것이 오도록 슬롯을 고정한다.
    // 내용이 없어도 자리를 비워 두어야 행끼리 줄이 맞는다.
    el.innerHTML =
      `<span class="d">${cell.day}</span>` +
      '<span class="slot"><i class="tag vd">비D</i></span>' +
      `<span class="slot">${isDutaDay(cell.dateStr) ? '<i class="tag dt">두타</i>' : ''}</span>` +
      `<span class="slot cnt">${total ? `${total}회` : ''}</span>` +
      `<span class="slot evt">${titles[0] ? escapeHtml(titles[0]) : ''}</span>` +
      `<span class="slot dots">${total ? '<i class="dot ex"></i>' : ''}` +
      `${titles.length ? '<i class="dot ev"></i>' : ''}</span>`;
    el.addEventListener('click', () => {
      selectedDate = cell.dateStr;
      renderCalendar();
      renderEntry();
    });
    grid.appendChild(el);
  }
}

// --- 기록하기 -----------------------------------------------------------------

function entryLabel(dateStr) {
  const [, m, d] = dateStr.split('-');
  const wd = ['일', '월', '화', '수', '목', '금', '토'][
    new Date(`${dateStr}T00:00:00Z`).getUTCDay()
  ];
  return `${Number(m)}월 ${Number(d)}일 (${wd})`;
}

function renderEntry() {
  $('entry-date').textContent = entryLabel(selectedDate);

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

// --- 운동 일정 입력 -----------------------------------------------------------

function openEventSheet() {
  $('evt-date').textContent = entryLabel(selectedDate);
  $('evt-title').value = '';
  $('evt-sheet').hidden = false;
  renderEventList();
  $('evt-title').focus();
}

function renderEventList() {
  const list = $('evt-list');
  const mine = localEvents(selectedDate);
  const cloud = dayEntry(loadLog(), selectedDate).events.filter((t) => !mine.includes(t));

  list.innerHTML =
    mine.map((t) => `<li><span>${escapeHtml(t)}</span>` +
      `<button type="button" class="evt-del" data-title="${escapeHtml(t)}">삭제</button></li>`).join('') +
    cloud.map((t) => `<li class="ro"><span>${escapeHtml(t)}</span><em>Supabase</em></li>`).join('') ||
    '<li class="ro"><span>등록된 일정이 없습니다</span></li>';

  for (const btn of list.querySelectorAll('.evt-del')) {
    btn.addEventListener('click', () => {
      removeEvent(selectedDate, btn.dataset.title);
      renderEventList();
      renderCalendar();
    });
  }
}

function commitEvent() {
  const input = $('evt-title');
  if (!input.value.trim()) return;
  addEvent(selectedDate, input.value);
  input.value = '';
  renderEventList();
  renderCalendar();
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

function setupCardTap(id, enabled, handler) {
  const el = $(id);
  if (enabled) {
    el.addEventListener('click', handler);
    return;
  }
  el.removeAttribute('role');
  el.removeAttribute('tabindex');
  el.classList.add('no-tap');
}

function renderAllLocal() {
  renderCalendar();
  renderEntry();
  renderChartCard();
}

export function init() {
  // 주소로 키가 전달됐으면 가장 먼저 처리한다. 저장 즉시 주소에서 지운다.
  const fromLink = consumeKeyFromUrl();

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
  // 열 대상이 설정돼 있을 때만 카드를 누를 수 있게 한다.
  // 그렇지 않으면 눌러도 아무 일이 없으므로, 눌리는 것처럼 보이지 않게 둔다.
  setupCardTap('renpho-card', canOpenRenpho(), openRenpho);
  setupCardTap('apple-card', canOpenAppleHealth(), openAppleHealth);
  $('cal-today').addEventListener('click', () => {
    selectedDate = laToday();
    anchorDate = laToday();
    renderCalendar();
    renderEntry();
  });
  // + 버튼: 선택한 날짜에 운동 일정을 넣는다
  $('entry-add').addEventListener('click', openEventSheet);
  $('evt-close').addEventListener('click', () => { $('evt-sheet').hidden = true; });
  $('evt-sheet').addEventListener('click', (e) => {
    if (e.target.id === 'evt-sheet') $('evt-sheet').hidden = true;
  });
  $('evt-add').addEventListener('click', commitEvent);
  $('evt-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitEvent();
  });
  initSetup(() => { refresh(); renderAllLocal(); });

  const setupOpen = () => !$('setup').hidden || !$('evt-sheet').hidden;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || setupOpen()) return;
    // 돌아올 때마다 새 배포가 있는지 먼저 본다. 있으면 페이지가 새로 뜬다.
    checkForUpdate().then((r) => { if (!r.reloading) refresh(); });
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && !setupOpen()) refresh(); // bfcache 복원
  });

  if (fromLink.reason) renderErrors([`링크의 키를 쓸 수 없습니다: ${fromLink.reason}`]);

  // 앱을 이미 열어 둔 상태에서 #key= 링크를 누르면 주소의 조각만 바뀌고
  // 스크립트는 다시 실행되지 않는다. 그 경우도 받아 준다.
  window.addEventListener('hashchange', () => {
    const r = consumeKeyFromUrl();
    if (r.applied) {
      renderErrors([]);
      repairTried = false; // 새 키가 들어왔으니 교정을 다시 시도할 수 있어야 한다
      refresh();
      renderAllLocal();
    } else if (r.reason) {
      renderErrors([`링크의 키를 쓸 수 없습니다: ${r.reason}`]);
    }
  });

  checkForUpdate().then((r) => {
    if (r.reloading) return; // 새 버전으로 이동 중이면 여기서 멈춘다
    refresh();
  });
  renderAllLocal();
}
