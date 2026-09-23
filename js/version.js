// 새 버전 감지 후 자동 갱신.
//
// 왜 필요한가
//   배포할 때 js/css 주소에 커밋 해시를 붙여 캐시를 피하고 있지만, 그 주소를
//   가리키는 index.html 자체가 캐시되면 소용이 없다. 옛 HTML 이 옛 주소를 계속
//   가리키기 때문이다. GitHub Pages 는 헤더를 바꿀 수 없고, 홈 화면에 추가한
//   웹앱은 HTML 을 더 오래 붙잡는다.
//
// 어떻게 푸는가
//   배포가 version.json 을 남긴다. 페이지는 그 파일을 매번 새 주소(?t=현재시각)로
//   읽어 캐시를 우회하고, 자기 버전과 다르면 ?v=<새버전> 으로 이동한다.
//   그 주소는 브라우저가 처음 보는 주소라 HTML 을 새로 받는다.

/** 배포 시 이 값이 커밋 해시로 치환된다. 로컬에서는 'dev'. */
export const APP_VERSION =
  (typeof window !== 'undefined' && window.__APP_VERSION__) || 'dev';

const RELOAD_GUARD = 'chace:reloadedFor';

function alreadyReloadedFor(v) {
  try {
    return sessionStorage.getItem(RELOAD_GUARD) === v;
  } catch {
    return false; // 저장소가 막혀 있으면 한 번 더 시도하는 편이 낫다
  }
}

function markReloaded(v) {
  try { sessionStorage.setItem(RELOAD_GUARD, v); } catch { /* 무시 */ }
}

/**
 * 서버의 최신 버전을 확인하고, 다르면 새 주소로 이동한다.
 * @returns {Promise<{current:string, latest:string|null, reloading:boolean}>}
 */
export async function checkForUpdate() {
  const current = APP_VERSION;
  if (current === 'dev') return { current, latest: null, reloading: false };

  let latest = null;
  try {
    // 매번 다른 주소로 요청해 캐시를 확실히 피한다.
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) latest = (await res.json())?.v ?? null;
  } catch {
    return { current, latest: null, reloading: false }; // 오프라인 등 — 조용히 넘어간다
  }

  if (!latest || latest === current || alreadyReloadedFor(latest)) {
    return { current, latest, reloading: false };
  }

  // 새 버전이 있다. 처음 보는 주소로 이동해 HTML 을 새로 받는다.
  markReloaded(latest);
  const url = new URL(window.location.href);
  url.searchParams.set('v', latest);
  window.location.replace(url.toString());
  return { current, latest, reloading: true };
}
