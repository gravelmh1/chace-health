// 카드에서 외부 앱 열기.
//
// 문제: 커스텀 스킴으로 최상위 문서를 이동시키면, 그 앱이 없거나 스킴이 틀렸을 때
//       iOS Safari 가 "Safari cannot open the page because the address is invalid" 를 띄운다.
//
// 대응:
//   - 스킴은 숨김 iframe 으로 던진다. 실패해도 오류 페이지가 뜨지 않는다.
//   - 일정 시간 안에 앱으로 전환되지 않으면 항상 유효한 https 주소로 폴백한다.
//   - 열기 전에 URL 을 실제로 파싱해 유효성을 확인한다.

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

/**
 * @param {string|null} scheme    커스텀 스킴
 * @param {string|null} fallbackUrl  없으면 폴백하지 않는다 (엉뚱한 곳으로 보내지 않기 위함)
 * @param {boolean} direct        true 면 최상위 문서를 스킴으로 이동시킨다.
 *                                기기에 반드시 있는 앱에만 쓴다 — 없으면 Safari 오류창이 뜬다.
 */
export function openExternalApp(scheme, fallbackUrl, direct = false) {
  const fallback = isValidUrl(fallbackUrl) ? fallbackUrl : null;

  // 무엇을 열려고 했는지 알린다. 커스텀 스킴 이동은 브라우저 계층에서
  // 관측되지 않아, 이 이벤트가 동작을 확인할 수 있는 유일한 지점이다.
  document.dispatchEvent(new CustomEvent('chace:open-app', {
    detail: { scheme, fallback, direct },
  }));

  if (!isValidUrl(scheme)) {
    if (fallback) window.location.href = fallback;
    return;
  }

  // 반드시 설치돼 있는 앱은 곧바로 이동한다. iOS 최신 Safari 에서는 iframe 으로
  // 던진 스킴이 무시되는 경우가 있어, 이쪽이 실제로 열릴 확률이 높다.
  if (direct) {
    window.location.href = scheme;
    return;
  }

  let switched = false;
  const onHide = () => { if (document.hidden) switched = true; };
  document.addEventListener('visibilitychange', onHide);

  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = scheme;
  document.body.appendChild(iframe);

  setTimeout(() => {
    document.removeEventListener('visibilitychange', onHide);
    iframe.remove();
    // 앱으로 전환됐으면(=페이지가 숨겨졌으면) 아무것도 하지 않는다.
    if (!switched && !document.hidden && fallback) window.location.href = fallback;
  }, SCHEME_TIMEOUT_MS);
}
