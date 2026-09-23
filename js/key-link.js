// 링크로 키 넣기.
//
// 아이폰에서 Supabase 대시보드의 복사 버튼이 막히는 경우가 있어, 키를 옮기는 것
// 자체가 큰 장벽이 된다. 링크 한 번으로 끝나게 한다.
//
//   https://.../chace-health/#key=sb_publishable_xxxx
//
// 조각(#)에 담는 이유: 조각은 서버로 전송되지 않는다. 물음표(?)로 보내면
// 호스팅 로그에 키가 남는다.
// 저장한 즉시 주소에서 지워서 화면과 방문 기록에 남지 않게 한다.

import { setAnonKey, inspectKey } from './settings.js';

/**
 * 주소에 키가 실려 있으면 저장하고 주소를 정리한다.
 * @returns {{applied:boolean, reason?:string}}
 */
export function consumeKeyFromUrl() {
  const hash = window.location.hash || '';
  const m = hash.match(/[#&]key=([^&]+)/);
  if (!m) return { applied: false };

  const key = decodeURIComponent(m[1]).trim();

  // 주소는 무조건 먼저 지운다. 키가 틀렸더라도 화면에 남으면 안 된다.
  const cleanHash = hash.replace(/[#&]key=[^&]*/, '').replace(/^#?&/, '#');
  const url = new URL(window.location.href);
  url.hash = cleanHash === '#' ? '' : cleanHash;
  try {
    window.history.replaceState(null, '', url.toString());
  } catch { /* 무시 — 저장은 계속 진행한다 */ }

  const verdict = inspectKey(key);
  if (!verdict.ok) return { applied: false, reason: verdict.reason };

  if (!setAnonKey(key)) {
    return { applied: false, reason: '브라우저 저장소에 쓸 수 없습니다 (프라이빗 모드일 수 있습니다).' };
  }
  return { applied: true };
}
