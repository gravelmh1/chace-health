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

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isConfigured =
  !!SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith('PASTE_');

/**
 * @param {string} table
 * @param {Record<string,string>} params PostgREST 쿼리 파라미터
 *        예: { select:'value', profile_id:`eq.${id}`, order:'measured_at.desc', limit:'1' }
 * @returns {Promise<object[]>}
 */
export async function selectRows(table, params) {
  if (!isConfigured) throw new Error('SUPABASE_ANON_KEY 미설정');

  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    },
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.message || body?.hint || '';
    } catch { /* 본문이 JSON 이 아니어도 상태코드는 전달한다 */ }
    throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
  }

  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

/** 0건이면 null, 1건 이상이면 첫 행 */
export async function selectOne(table, params) {
  const rows = await selectRows(table, { ...params, limit: '1' });
  return rows[0] ?? null;
}
