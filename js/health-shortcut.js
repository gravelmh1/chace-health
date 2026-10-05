// 앱을 열 때 아이폰 단축어("Chace 동기화")를 실행해 Apple 건강 → Supabase 를 채운다.
//
// 왜 앱에서 실행하나
//   아이폰은 잠겨 있으면 건강 데이터를 열어 주지 않아, 시간 지정 자동화가 조용히 실패한다.
//   앱을 열었다는 것은 잠금이 풀려 있다는 뜻이라 이때 실행하면 확실히 읽힌다.
//
// 동작
//   - 아이폰(아이패드)에서만. 다른 기기에는 단축어가 없다.
//   - 마지막 동기화가 2시간보다 오래됐을 때만. 최신이면 건드리지 않는다.
//   - 실패해도 30분 안에는 다시 실행하지 않는다 (열 때마다 단축어로 튕기지 않게).
//   - 단축어가 끝나고 앱으로 돌아오면 visibilitychange 에서 새 값을 다시 읽는다.

import { HEALTH_SHORTCUT_NAME, AUTO_SYNC_AFTER_MS, AUTO_SYNC_MIN_GAP_MS } from './config.js';
import { openExternalApp } from './open-app.js';

const LAST_RUN_KEY = 'chace:shortcutRunAt';

export function isAppleMobile() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/.test(ua)
    || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); // iPadOS
}

export function shortcutUrl(name = HEALTH_SHORTCUT_NAME) {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`;
}

function lastRunAt() {
  try { return Number(localStorage.getItem(LAST_RUN_KEY)) || 0; } catch { return 0; }
}

/** 단축어를 지금 실행한다 (단축어 앱은 모든 아이폰에 있으므로 바로 이동한다). */
export function runHealthShortcut() {
  try { localStorage.setItem(LAST_RUN_KEY, String(Date.now())); } catch { /* 저장 못 해도 실행은 한다 */ }
  openExternalApp(shortcutUrl(), null, true);
}

/** 필요할 때만 실행. 실행했으면 true. */
export function maybeAutoSync(sync, now = Date.now()) {
  if (!isAppleMobile() || document.visibilityState !== 'visible') return false;
  const last = sync?.lastSyncAt ? sync.lastSyncAt.getTime() : 0;
  if (last && now - last < AUTO_SYNC_AFTER_MS) return false;
  if (now - lastRunAt() < AUTO_SYNC_MIN_GAP_MS) return false;
  runHealthShortcut();
  return true;
}
