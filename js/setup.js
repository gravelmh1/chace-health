// 설정 시트 — anon key 입력 + 실제 스키마 진단.
//
// 코드를 고치지 않고 앱에서 바로 키를 넣을 수 있게 한다.
// 키를 저장한 직후 실제 테이블을 읽어서, config.js 의 컬럼 매핑이
// 실제 스키마와 맞는지 그 자리에서 보여준다.

import { describeTable } from './supabase.js';
import { getAnonKey, setAnonKey, inspectKey, getProfileId, setProfileId } from './settings.js';
import {
  METRICS_TABLE, METRICS_COL, CALENDAR_TABLE, CALENDAR_COL,
} from './config.js';

const $ = (id) => document.getElementById(id);

export function openSetup() {
  $('setup').hidden = false;
  $('setup-key').value = getAnonKey();
  $('setup-profile').value = getProfileId();
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

async function runDiagnosis() {
  const diag = $('setup-diag');
  diag.innerHTML = '<li class="pending">스키마 확인 중…</li>';

  const parts = await Promise.all([
    diagnoseTable(METRICS_TABLE, METRICS_COL),
    diagnoseLocalDate(),
    diagnoseTable(CALENDAR_TABLE, CALENDAR_COL),
  ]);
  diag.innerHTML = parts.filter(Boolean).join('');
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

    const stored = setAnonKey(key) && setProfileId($('setup-profile').value.trim());
    if (!stored) {
      msg.textContent = '⚠ 브라우저 저장소에 쓸 수 없습니다 (프라이빗 모드일 수 있습니다). js/config.js 에 직접 넣어주세요.';
      msg.className = 'setup-msg bad';
      return;
    }

    msg.textContent = '저장했습니다.';
    msg.className = 'setup-msg ok';

    await runDiagnosis();
    onSaved?.();
  });

  $('setup-diagnose').addEventListener('click', runDiagnosis);
}
