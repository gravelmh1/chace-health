// Supabase REST(PostgREST) 얇은 클라이언트.
//
// supabase-js SDK 를 CDN 에서 import 하지 않는다. 이유:
//   - 외부 CDN 이 막히거나 느려지면 앱 전체가 뜨지 않는다 (단일 장애점).
//   - 이 앱이 하는 일은 "읽기 전용 SELECT" 뿐이라 SDK 가 필요 없다.
//   - 쿼리가 URL 에 그대로 드러나서 디버깅이 쉽다.
//
// 캐시: 모든 요청에 cache:'no-store' 를 건다.
// 이게 없으면 iOS Safari 가 이전 응답을 재사용해서, DB 에 새 데이터가 들어와도
// 앱은 계속 옛날 숫자를 보여준다.

import { SUPABASE_URL } from './config.js';
import { getAnonKey } from './settings.js';

/** PostgREST 오류를 사람이 읽고 바로 고칠 수 있는 문장으로 바꾼다. */
export class QueryError extends Error {
  constructor(message, { status, code, hint, table, column } = {}) {
    super(message);
    this.name = 'QueryError';
    this.status = status;
    this.code = code;
    this.hint = hint;
    this.table = table;
    this.column = column;
  }
}

function explain(status, body, table) {
  const code = body?.code;
  const msg = body?.message || '';

  // 42703: undefined_column — config.js 의 컬럼 매핑이 실제 스키마와 다르다
  if (code === '42703' || /column .* does not exist/i.test(msg)) {
    const col = msg.match(/column ["']?([\w.>-]+)["']?/i)?.[1];
    return new QueryError(
      `'${table}' 에 컬럼 ${col ? `'${col}' ` : ''}이(가) 없습니다. js/config.js 의 컬럼 매핑을 실제 스키마에 맞추세요. (tools/schema-probe.html 로 확인 가능)`,
      { status, code, table, column: col },
    );
  }

  // 42P01: undefined_table
  if (code === '42P01' || /relation .* does not exist/i.test(msg)) {
    return new QueryError(
      `테이블 '${table}' 을(를) 찾을 수 없습니다. js/config.js 의 테이블 이름을 확인하세요.`,
      { status, code, table },
    );
  }

  if (status === 401 || status === 403) {
    return new QueryError(
      `'${table}' 을(를) anon 키로 읽을 수 없습니다. RLS 정책이 막고 있을 가능성이 큽니다. ` +
      '테이블에 anon SELECT 정책을 추가하거나, health_sync_pull() 같은 SECURITY DEFINER 함수를 통해 읽도록 하세요.',
      { status, code, table },
    );
  }

  if (status === 404) {
    return new QueryError(`테이블 '${table}' 에 접근할 수 없습니다 (404).`, { status, table });
  }

  return new QueryError(
    `HTTP ${status}${msg ? ` — ${msg}` : ''}`,
    { status, code, hint: body?.hint, table },
  );
}

export function isConfigured() {
  return !!getAnonKey();
}

/**
 * @param {string} table
 * @param {Record<string,string>} params PostgREST 쿼리 파라미터
 *        예: { select:'value', profile_id:`eq.${id}`, order:'measured_at.desc', limit:'1' }
 * @returns {Promise<object[]>}
 */
export async function selectRows(table, params) {
  const anonKey = getAnonKey();
  if (!anonKey) throw new QueryError('Supabase anon key 가 설정되지 않았습니다.', { status: 0 });

  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }

  let res;
  try {
    res = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (e) {
    throw new QueryError(`네트워크 오류: ${e.message}`, { status: 0, table });
  }

  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch { /* JSON 이 아니어도 상태코드로 판정한다 */ }
    throw explain(res.status, body, table);
  }

  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

/** 0건이면 null, 1건 이상이면 첫 행 */
export async function selectOne(table, params) {
  const rows = await selectRows(table, { ...params, limit: '1' });
  return rows[0] ?? null;
}

/**
 * RPC 호출 (POST /rest/v1/rpc/<fn>).
 *
 * 테이블에 RLS 가 걸려 있으면 anon 으로는 직접 SELECT 가 막힌다.
 * 원본 앱이 쓰던 health_sync_pull() 같은 SECURITY DEFINER 함수는
 * 그 제약을 넘어 정해진 데이터만 돌려주도록 만들어진 통로다.
 */
export async function callRpc(fn, args = {}) {
  const anonKey = getAnonKey();
  if (!anonKey) throw new QueryError('Supabase anon key 가 설정되지 않았습니다.', { status: 0 });

  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify(args),
    });
  } catch (e) {
    throw new QueryError(`네트워크 오류: ${e.message}`, { status: 0, table: fn });
  }

  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch { /* 상태코드로 판정 */ }
    // 42883 / PGRST202: 그런 함수가 없다 — 폴백해야 한다는 신호
    const missing = res.status === 404 || body?.code === '42883' || body?.code === 'PGRST202';
    const err = explain(res.status, body, fn);
    err.missingFunction = missing;
    throw err;
  }

  return res.json();
}

/**
 * 실제 스키마 확인용 — 테이블의 아무 행이나 1건 읽어 컬럼 이름을 돌려준다.
 * 설정 화면에서 매핑이 맞는지 즉시 보여주는 데 쓴다.
 */
export async function describeTable(table) {
  const rows = await selectRows(table, { select: '*', limit: '1' });
  return { table, columns: rows[0] ? Object.keys(rows[0]) : [], sample: rows[0] ?? null };
}
