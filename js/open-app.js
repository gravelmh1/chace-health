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
 * @param {string|null} scheme    커스텀 스킴 (검증되지 않았어도 안전하게 시도한다)
 * @param {string} fallbackUrl    항상 유효해야 하는 https 주소
 */
export function openExternalApp(scheme, fallbackUrl) {
  const fallback = isValidUrl(fallbackUrl) ? fallbackUrl : null;

  if (!isValidUrl(scheme)) {
    if (fallback) window.location.href = fallback;
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
