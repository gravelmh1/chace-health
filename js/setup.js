// 설정 시트 — anon key 입력 + 실제 스키마 진단.
//
// 코드를 고치지 않고 앱에서 바로 키를 넣을 수 있게 한다.
// 키를 저장한 직후 실제 테이블을 읽어서, config.js 의 컬럼 매핑이
// 실제 스키마와 맞는지 그 자리에서 보여준다.

import { describeTable, callRpc, checkKey } from './supabase.js';
import {
  getAnonKey, setAnonKey, inspectKey, getProfileId, setProfileId,
  getRenphoScheme, setRenphoScheme,
} from './settings.js';
import { getDutaSchedule, setDutaSchedule } from './tracker.js';
import {
  METRICS_TABLE, METRICS_COL, CALENDAR_TABLE, CALENDAR_COL,
  DAYS_TABLE, DAYS_COL, EXERCISES, MEDICATIONS, SYNC_PULL_FNS,
  RENPHO_SCHEME_CANDIDATES,
} from './config.js';

import { unpackSyncPull } from './select.js';
import { APP_VERSION } from './version.js';
import { repairKey } from './key-repair.js';

const $ = (id) => document.getElementById(id);

export function openSetup() {
  $('setup').hidden = false;
  $('setup-key').value = getAnonKey();
  $('setup-profile').value = getProfileId();
  const duta = getDutaSchedule();
  $('setup-duta-interval').value = duta.intervalDays;
  $('setup-duta-anchor').value = duta.anchor;
  $('setup-renpho').value = getRenphoScheme();
  renderSchemeTries();
  $('setup-version').textContent = `버전 ${APP_VERSION}`;
  $('setup-msg').textContent = '';
  $('setup-msg').className = 'setup-msg';
  $('setup-diag').innerHTML = '';
  $('setup-key').focus();
}

export function closeSetup() {
  $('setup').hidden = true;
}

function row(label, ok, detail) {
  return `<li class="${ok ? 'ok' : 'bad'}"><b>${ok ? '✓' : '✗'}</b> ${label}${detail ? `<span>${detail}</span>` : ''}</li>`;
}

/** 기대하는 컬럼이 실제 테이블에 있는지 대조 */
async function diagnoseTable(table, mapping) {
  try {
    const { columns, sample } = await describeTable(table);
    if (!columns.length) {
      return row(`${table}`, false, '행이 없어 컬럼을 확인할 수 없습니다');
    }
    const missing = Object.entries(mapping)
      .filter(([, col]) => !columns.includes(col))
      .map(([key, col]) => `${col} (${key})`);

    if (!missing.length) {
      return row(`${table}`, true, `컬럼 ${columns.length}개 일치`);
    }
    return row(`${table}`, false,
      `없는 컬럼: ${missing.join(', ')} · 실제 컬럼: ${columns.join(', ')}`);
  } catch (e) {
    return row(`${table}`, false, e.message);
  }
}

/** metadata.local_date 가 실제로 채워져 있는지 — 오늘 걸음수 조회가 여기에 의존한다 */
async function diagnoseLocalDate() {
  try {
    const { sample } = await describeTable(METRICS_TABLE);
    const meta = sample?.[METRICS_COL.metadata];
    if (meta && typeof meta === 'object' && 'local_date' in meta) {
      return row('metadata.local_date', true, `예: ${meta.local_date}`);
    }
    return row('metadata.local_date', false,
      '샘플 행에 local_date 가 없습니다. 오늘 걸음수 조회가 이 값에 의존합니다');
  } catch {
    return '';
  }
}

/**
 * RPC 를 먼저 본다. 테이블이 RLS 로 막혀 있어도 이쪽이 열려 있으면 앱은 정상 동작한다.
 * 그래서 테이블 실패만 보여주면 오해를 부른다.
 */
async function diagnoseRpc() {
  const rows = [];
  for (const fn of SYNC_PULL_FNS) {
    try {
      const { metrics, events, days } = unpackSyncPull(await callRpc(fn));
      const ok = metrics.length > 0 || days.length > 0;
      rows.push(row(`${fn}()`, ok,
        `측정 ${metrics.length}행 · 일정 ${events.length}행 · 기록 ${days.length}행` +
        (ok ? ' — 이 통로로 읽습니다' : ' — 응답은 왔지만 비어 있습니다')));
    } catch (e) {
      rows.push(row(`${fn}()`, false,
        `${e.message}${e.missingFunction ? ' (함수가 없습니다)' : ''}`));
    }
  }
  return rows.join('');
}

/** workouts / meds JSONB 의 실제 키 이름을 보여준다 (코드가 찾는 이름과 대조) */
async function diagnoseDayKeys() {
  try {
    const { columns, sample } = await describeTable(DAYS_TABLE);
    if (!columns.length) return row(DAYS_TABLE, false, '행이 없어 확인할 수 없습니다');

    const w = sample?.[DAYS_COL.workouts];
    const m = sample?.[DAYS_COL.meds];
    const wKeys = w && typeof w === 'object' ? Object.keys(w) : [];
    const mKeys = m && typeof m === 'object' ? Object.keys(m) : [];

    const known = new Set(EXERCISES.flatMap((e) => [e.id, ...(e.aliases ?? [])]));
    const unknown = wKeys.filter((k) => !known.has(k));
    const medKnown = new Set(MEDICATIONS.map((x) => x.id));
    const medUnknown = mKeys.filter((k) => !medKnown.has(k));

    const ok = !unknown.length && !medUnknown.length;
    return row(`${DAYS_TABLE} JSONB 키`, ok,
      `workouts: ${wKeys.join(', ') || '(없음)'} · meds: ${mKeys.join(', ') || '(없음)'}` +
      (ok ? '' : ` — 코드가 모르는 키: ${[...unknown, ...medUnknown].join(', ')}`));
  } catch (e) {
    return row(`${DAYS_TABLE} JSONB 키`, false, e.message);
  }
}

/** 키가 유효한지 먼저 본다. 이게 ✗ 면 아래 항목은 전부 ✗ 일 수밖에 없다. */
async function diagnoseKey() {
  const r = await checkKey();
  return {
    html: row('anon key 유효성', r.ok,
      r.ok ? '키는 정상입니다 — 아래가 ✗ 라면 권한 문제입니다' : r.reason),
    // 키 자체가 거부된 경우에만 나머지를 건너뛴다.
    // 권한 문제라면 아래 항목들이 어디가 막혔는지 알려 주므로 계속 봐야 한다.
    skipRest: !r.ok && r.badKey === true,
  };
}

async function runDiagnosis() {
  const diag = $('setup-diag');
  diag.innerHTML = '<li class="pending">확인 중…</li>';

  const key = await diagnoseKey();
  if (key.skipRest) {
    diag.innerHTML = key.html +
      '<li class="pending">키가 거부되어 나머지 검사는 건너뜁니다. ' +
      '키를 고친 뒤 다시 눌러 주세요.</li>';
    return;
  }

  const parts = await Promise.all([
    diagnoseRpc(),
    diagnoseTable(METRICS_TABLE, METRICS_COL),
    diagnoseLocalDate(),
    diagnoseTable(CALENDAR_TABLE, CALENDAR_COL),
    diagnoseTable(DAYS_TABLE, DAYS_COL),
    diagnoseDayKeys(),
  ]);
  diag.innerHTML = key.html + parts.filter(Boolean).join('')
    + '<li class="pending">RPC 가 ✓ 면 테이블이 ✗ 여도 앱은 정상 동작합니다.</li>';
}

/** 후보 주소를 하나씩 눌러 볼 수 있게 한다. 열리는 것이 정답이다. */
function renderSchemeTries() {
  const box = $('renpho-try');
  box.innerHTML = '';
  for (const scheme of RENPHO_SCHEME_CANDIDATES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'try';
    btn.textContent = scheme;
    btn.addEventListener('click', () => {
      // 눌러 본 주소를 입력칸에 넣어 둔다. 앱이 열렸다면 그대로 저장하면 된다.
      $('setup-renpho').value = scheme;
      window.location.href = scheme;
    });
    box.appendChild(btn);
  }
}

export function initSetup(onSaved) {
  $('setup-close').addEventListener('click', closeSetup);
  $('setup').addEventListener('click', (e) => {
    if (e.target.id === 'setup') closeSetup(); // 바깥 영역 클릭
  });

  $('setup-save').addEventListener('click', async () => {
    const key = $('setup-key').value.trim();
    const msg = $('setup-msg');

    const verdict = inspectKey(key);
    if (!verdict.ok) {
      msg.textContent = `⚠ ${verdict.reason}`;
      msg.className = 'setup-msg bad';
      return; // service_role 키는 저장 자체를 막는다
    }

    setDutaSchedule($('setup-duta-interval').value, $('setup-duta-anchor').value);
    setRenphoScheme($('setup-renpho').value);
    const stored = setAnonKey(key) && setProfileId($('setup-profile').value.trim());
    if (!stored) {
      msg.textContent = '⚠ 브라우저 저장소에 쓸 수 없습니다 (프라이빗 모드일 수 있습니다). js/config.js 에 직접 넣어주세요.';
      msg.className = 'setup-msg bad';
      return;
    }

    msg.textContent = '저장했습니다. 확인 중…';
    msg.className = 'setup-msg ok';

    // 키가 거부되면, 눈으로 옮기다 틀린 글자를 자동으로 찾아본다.
    // l/I/1, O/0 처럼 화면에서 구분이 안 되는 자리만 바꿔 가며 실제로 요청해 본다.
    const probe = await checkKey();
    if (!probe.ok) {
      msg.textContent = '키가 거부되었습니다. 비슷한 글자를 바꿔 가며 찾는 중…';
      msg.className = 'setup-msg';

      const result = await repairKey(key, (done, total) => {
        msg.textContent = `맞는 키를 찾는 중… ${done}/${total}`;
      });

      if (result.found) {
        setAnonKey(result.found);
        $('setup-key').value = result.found;
        msg.textContent = `맞는 키를 찾았습니다 (${result.tried}번째 시도). 저장했습니다.`;
        msg.className = 'setup-msg ok';
      } else if (result.tooMany) {
        msg.textContent = '키가 거부되었습니다. 이 키는 너무 길어 자동 교정을 할 수 없습니다.';
        msg.className = 'setup-msg bad';
      } else {
        msg.textContent = `키가 거부되었습니다. ${result.total}가지를 시도했지만 맞는 것이 없습니다. 키를 다시 확인해 주세요.`;
        msg.className = 'setup-msg bad';
      }
    }

    await runDiagnosis();
    onSaved?.();
  });

  $('setup-diagnose').addEventListener('click', runDiagnosis);
}
