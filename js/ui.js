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
  formatSyncTime, metricTime, laToday, shiftDate, shortLabel,
} from './time.js';
import {
  openRenpho, openAppleHealth, canOpenRenpho, canOpenAppleHealth,
} from './open-renpho.js';
import { buildWeekGrid, gridRange, fetchCalendarEvents } from './calendar.js';
import { renderChart, renderLegend, dayDetail } from './chart.js';
import {
  loadLog, dayEntry, setMed, setExercise,
  medsDueOn, isDutaDay, loadCloudDays, localEvents, addEvent, removeEvent,
  MEDICATIONS, EXERCISES,
} from './tracker.js';
import { CHART_DAYS, QUEST } from './config.js';
import { questStatus, streak, isWeekend, setFor } from './quest.js';
import { APP_VERSION, checkForUpdate } from './version.js';
import { consumeKeyFromUrl } from './key-link.js';
import { maybeAutoSync, runHealthShortcut, isAppleMobile } from './health-shortcut.js';
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

let selectedDate = laToday();
let anchorDate = laToday();  // 달력이 가운데 두는 주
let monthEvents = {};

// --- 건강 데이터 카드 ---------------------------------------------------------

function renderRenpho(r) {
  $('renpho-weight').textContent = trimNum(r?.bodyMass?.value, 2);
  $('renpho-fat').textContent = fixed(r?.bodyFatPercentage?.value, 1);
  $('renpho-bmi').textContent = fixed(r?.bodyMassIndex?.value, 1);
  const delta = r?.weightDelta14;
  const el = $('renpho-delta');
  el.hidden = !Number.isFinite(delta);
  if (Number.isFinite(delta)) el.textContent = `2주 ${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta).toFixed(1)}`;
  // 표시 시각은 metadata 의 현지 시각을 우선한다.
  const latest = ['bodyMass', 'bodyFatPercentage', 'bodyMassIndex']
    .map((k) => r?.[k])
    .filter((m) => m?.recordedAt)
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))[0];

  $('renpho-synced').textContent = latest ? `${metricTime(latest)} 측정` : '측정 기록 없음';
}

const dayLabel = (d) => (d ? shortLabel(d) : '없음');

/**
 * 동기화 상태. 6시간 넘게 새 데이터가 안 들어왔으면 카드 위에 작은 한 줄로 알린다.
 * 팝업·알림창은 띄우지 않는다. 자세한 내용은 설정 화면에 늘 적어 둔다.
 */
function renderSync(sync) {
  const warn = $('sync-warn');
  const when = sync?.lastSyncAt ? formatSyncTime(sync.lastSyncAt) : '기록 없음';
  const detail = `마지막 동기화 ${when} · Apple ${dayLabel(sync?.lastAppleDate)} · RENPHO ${dayLabel(sync?.lastRenphoDate)}`;

  $('setup-sync').textContent = detail;
  warn.hidden = !sync?.delayed;
  warn.textContent = sync?.delayed ? `Health sync delayed · ${detail}` : '';
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
    renderSync(d.sync);
    // 데이터가 오래됐으면 아이폰 단축어로 Apple 건강 값을 새로 보낸다 (잠금이 풀린 지금이 기회다).
    maybeAutoSync(d.sync);
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

    const events = monthEvents[cell.dateStr] ?? [];

    // 일정: 앱에서 넣은 것 + 클라우드 기록의 events + Google Calendar
    const titles = [...new Set([
      ...dayEntry(log, cell.dateStr).events,
      ...events.map((e) => e.title),
    ])];

    // 퀘스트: 지난 날·오늘은 결과, 앞으로의 날은 그 날 할 세트.
    const future = cell.dateStr > laToday();
    const q = questStatus(log, cell.dateStr);
    let mark;
    let sub;
    if (future) {
      el.classList.add('future');
      mark = '';
      sub = `<span class="plan">${isWeekend(cell.dateStr) ? '푸쉬업' : setFor(cell.dateStr).label.replace(/ · /g, '')}</span>`;
    } else if (q.cleared) {
      el.classList.add('cleared');
      mark = '<span class="star" aria-label="퀘스트 클리어">⭐</span>';
      sub = `<span class="bonus">${q.pushup > q.goal ? `+${q.pushup - q.goal}` : '클리어'}</span>`;
    } else {
      mark = '<span class="qdots">' +
        `<i class="q-pu${q.pushupDone ? ' on' : ''}" title="푸쉬업"></i>` +
        (q.set ? `<i class="q-set${q.setDone ? ' on' : ''}" title="세트"></i>` : '') +
        `<i class="q-pr${q.protein ? ' on' : ''}" title="프로틴"></i></span>`;
      sub = q.pushup ? `<span class="pu" title="푸쉬업 ${q.pushup}/${q.goal}">${q.pushup}</span>` : '';
    }

    // 칸마다 같은 자리에 같은 것이 오도록 슬롯을 고정한다.
    el.innerHTML =
      `<span class="d">${cell.day}</span>` +
      `<span class="slot qmark">${mark}</span>` +
      `<span class="slot cnt">${sub}</span>` +
      `<span class="slot">${isDutaDay(cell.dateStr) ? '<i class="tag dt">두타</i>' : ''}</span>` +
      `<span class="slot evt">${titles[0] ? escapeHtml(titles[0]) : ''}</span>`;
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
  const weekend = isWeekend(selectedDate);
  $('entry-date').textContent = `${entryLabel(selectedDate)} · ${weekend ? '주말' : '평일'}`;

  const log = loadLog();
  const day = dayEntry(log, selectedDate);
  const q = questStatus(log, selectedDate);

  // 연속 클리어 (오늘 기준)
  const n = streak(log, laToday());
  $('streak').hidden = n < 1;
  $('streak').textContent = `🔥 ${n}일 연속`;

  // 퀘스트 목록
  const pct = Math.min(100, Math.round((q.pushup / q.goal) * 100));
  const items = [
    `<li class="${q.pushupDone ? 'done' : ''}">
       <div class="qi"><b>푸쉬업 ${q.goal}개</b><span class="qv">${q.pushup} / ${q.goal}${q.pushup > q.goal ? ` <em class="plus">+${q.pushup - q.goal}</em>` : ''}</span></div>
       <div class="pbar"><span style="width:${pct}%"></span></div></li>`,
    q.set
      ? `<li class="${q.setDone ? 'done' : ''}">
           <div class="qi"><b>${q.set.label} 세트</b><span class="qv">${q.setDone ? '완료' : `${q.setLeft.join(' · ')} 남음`}</span></div></li>`
      : '<li class="done"><div class="qi"><b>주말</b><span class="qv">푸쉬업만</span></div></li>',
    `<li class="${q.protein ? 'done' : ''}">
       <div class="qi"><b>프로틴</b><button type="button" id="protein-btn" class="chk${q.protein ? ' on' : ''}" aria-pressed="${q.protein}" aria-label="프로틴 먹음">✓</button></div></li>`,
  ];
  $('quest-list').innerHTML = items.join('');
  $('quest-clear').hidden = !q.cleared;
  $('protein-btn').addEventListener('click', () => {
    setMed(selectedDate, QUEST.proteinId, !q.protein);
    renderEntry();
    renderCalendar();
  });

  // 운동 기록: 네 가지 모두 10개씩
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

  renderEventList();
}

// --- 운동 일정 입력 -----------------------------------------------------------

function renderEventList() {
  const list = $('evt-list');
  const mine = localEvents(selectedDate);
  const cloud = dayEntry(loadLog(), selectedDate).events.filter((t) => !mine.includes(t));

  list.innerHTML =
    mine.map((t) => `<li><span>${escapeHtml(t)}</span>` +
      `<button type="button" class="evt-del" data-title="${escapeHtml(t)}" aria-label="${escapeHtml(t)} 삭제">✕</button></li>`).join('') +
    cloud.map((t) => `<li class="ro"><span>${escapeHtml(t)}</span></li>`).join('');

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
  chartState = { dates, series };
  showChartDay(chartState.selected ?? null);
}

// 막대를 누르면 그 날의 운동별 숫자를 차트 아래 한 줄로 보여 준다 (팝업 없음).
let chartState = { dates: [], series: {}, selected: null };

function showChartDay(i) {
  const { dates, series } = chartState;
  chartState.selected = i;
  document.querySelectorAll('#chart-body .bar').forEach((g) =>
    g.classList.toggle('on', Number(g.dataset.i) === i));
  const box = $('chart-detail');
  box.textContent = i === null || !dates[i]
    ? '막대를 누르면 그 날의 운동별 횟수가 나옵니다'
    : dayDetail(dates[i], series, i);
}

function setupChartTap() {
  const pick = (e) => {
    const g = e.target.closest?.('.bar');
    if (g) showChartDay(Number(g.dataset.i));
  };
  $('chart-body').addEventListener('click', pick);
  $('chart-body').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e); }
  });
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

  // '최신': 아이폰이면 단축어로 Apple 건강 값을 먼저 보내고, 돌아오면 새로 읽는다.
  $('refresh-btn').addEventListener('click', () => {
    if (isAppleMobile()) runHealthShortcut();
    refresh(); renderAllLocal();
  });
  $('setup-btn').addEventListener('click', openSetup);
  // 열 대상이 설정돼 있을 때만 카드를 누를 수 있게 한다.
  // 그렇지 않으면 눌러도 아무 일이 없으므로, 눌리는 것처럼 보이지 않게 둔다.
  setupCardTap('renpho-card', canOpenRenpho(), openRenpho);
  setupCardTap('apple-card', canOpenAppleHealth(), openAppleHealth);
  setupChartTap();
  // 매일 먹는 약(비타민D)은 모든 칸에 똑같이 찍히므로 칸에서 빼고 제목 옆에 한 번만 적는다.
  $('cal-daily').innerHTML = MEDICATIONS.filter((m) => m.daily)
    .map((m) => `<i class="tag vd">${escapeHtml(m.short)} 매일</i>`).join('');
  $('cal-today').addEventListener('click', () => {
    selectedDate = laToday();
    anchorDate = laToday();
    renderCalendar();
    renderEntry();
  });
  // + 버튼: 선택한 날짜에 운동 일정을 넣는다
  $('evt-add').addEventListener('click', commitEvent);
  $('evt-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitEvent();
  });
  initSetup(() => { refresh(); renderAllLocal(); });

  const setupOpen = () => !$('setup').hidden;
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
