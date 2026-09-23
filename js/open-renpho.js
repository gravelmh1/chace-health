// 카드 클릭 → 해당 앱 열기. 실제 동작은 open-app.js 에 있다.
//
// 설정에 열 대상이 없으면 카드는 눌리지 않는 상태로 둔다.
// 눌러도 아무 일이 없는 카드를 눌리는 것처럼 보이게 하지 않기 위해서다.

import {
  RENPHO_APP_SCHEME, RENPHO_FALLBACK_URL,
  APPLE_HEALTH_SCHEME, APPLE_HEALTH_FALLBACK_URL,
} from './config.js';
import { openExternalApp, isValidUrl } from './open-app.js';

export { isValidUrl } from './open-app.js';

/** 열 수 있는 대상이 하나라도 설정돼 있는지 */
export function canOpenRenpho() {
  return isValidUrl(RENPHO_APP_SCHEME) || isValidUrl(RENPHO_FALLBACK_URL);
}

export function canOpenAppleHealth() {
  return isValidUrl(APPLE_HEALTH_SCHEME) || isValidUrl(APPLE_HEALTH_FALLBACK_URL);
}

export function openRenpho() {
  if (canOpenRenpho()) openExternalApp(RENPHO_APP_SCHEME, RENPHO_FALLBACK_URL);
}

export function openAppleHealth() {
  if (canOpenAppleHealth()) openExternalApp(APPLE_HEALTH_SCHEME, APPLE_HEALTH_FALLBACK_URL);
}
