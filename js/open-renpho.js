// 카드 클릭 → 해당 앱 열기. 실제 동작은 open-app.js 에 있다.
//
// 폴백을 두지 않으므로, 앱이 열리지 않으면 아무 일도 일어나지 않는다.
// 설정에 스킴이 없으면 카드는 눌리지 않는 상태로 둔다.

import {
  RENPHO_APP_SCHEME, RENPHO_FALLBACK_URL, RENPHO_DIRECT,
  APPLE_HEALTH_SCHEME, APPLE_HEALTH_FALLBACK_URL, APPLE_HEALTH_DIRECT,
} from './config.js';
import { openExternalApp, isValidUrl } from './open-app.js';

export { isValidUrl } from './open-app.js';

export function canOpenRenpho() {
  return isValidUrl(RENPHO_APP_SCHEME) || isValidUrl(RENPHO_FALLBACK_URL);
}

export function canOpenAppleHealth() {
  return isValidUrl(APPLE_HEALTH_SCHEME) || isValidUrl(APPLE_HEALTH_FALLBACK_URL);
}

export function openRenpho() {
  if (canOpenRenpho()) {
    openExternalApp(RENPHO_APP_SCHEME, RENPHO_FALLBACK_URL, RENPHO_DIRECT);
  }
}

export function openAppleHealth() {
  if (canOpenAppleHealth()) {
    openExternalApp(APPLE_HEALTH_SCHEME, APPLE_HEALTH_FALLBACK_URL, APPLE_HEALTH_DIRECT);
  }
}
