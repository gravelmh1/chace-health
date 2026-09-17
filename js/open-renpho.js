// RENPHO 카드 클릭 처리.
//
// 문제: 검증되지 않은 커스텀 스킴으로 location 을 바꾸면 iOS Safari 가
//       "Safari cannot open the page because the address is invalid" 를 띄운다.
//       URL 문자열이 undefined/빈값/오타여도 같은 오류가 난다.
//
// 대응:
//   - 스킴은 config 에서 명시적으로 검증된 값이 들어있을 때만 시도한다 (기본 null).
//   - 시도하더라도 location 직접 변경이 아니라 숨김 iframe 으로 던진다.
//     iframe 은 실패해도 Safari 오류 페이지를 띄우지 않는다.
//   - 일정 시간 안에 앱으로 전환되지 않으면 항상 유효한 https 링크로 폴백한다.
//   - 열기 전에 URL 을 실제로 파싱해서 유효성을 확인한다.

import { RENPHO_APP_SCHEME, RENPHO_FALLBACK_URL } from './config.js';

const SCHEME_TIMEOUT_MS = 1200;

/** 문자열이 실제로 열 수 있는 URL 인지 확인 */
export function isValidUrl(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (!s) return false;
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

export function openRenpho() {
  const fallback = isValidUrl(RENPHO_FALLBACK_URL)
    ? RENPHO_FALLBACK_URL
    : 'https://apps.apple.com/us/search?term=RENPHO%20Health';

  // 검증된 스킴이 없으면 곧바로 https 로. 오류창이 뜰 여지가 없다.
  if (!isValidUrl(RENPHO_APP_SCHEME)) {
    window.location.href = fallback;
    return;
  }

  let switched = false;
  const onHide = () => { if (document.hidden) switched = true; };
  document.addEventListener('visibilitychange', onHide);

  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = RENPHO_APP_SCHEME;
  document.body.appendChild(iframe);

  setTimeout(() => {
    document.removeEventListener('visibilitychange', onHide);
    iframe.remove();
    // 앱으로 전환됐으면(=페이지가 숨겨졌으면) 아무것도 하지 않는다.
    if (!switched && !document.hidden) window.location.href = fallback;
  }, SCHEME_TIMEOUT_MS);
}
