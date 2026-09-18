// 카드 클릭 → 해당 앱 열기. 실제 동작은 open-app.js 에 있다.

import {
  RENPHO_APP_SCHEME, RENPHO_FALLBACK_URL,
  APPLE_HEALTH_SCHEME, APPLE_HEALTH_FALLBACK_URL,
} from './config.js';
import { openExternalApp } from './open-app.js';

export { isValidUrl } from './open-app.js';

export function openRenpho() {
  openExternalApp(RENPHO_APP_SCHEME, RENPHO_FALLBACK_URL);
}

export function openAppleHealth() {
  openExternalApp(APPLE_HEALTH_SCHEME, APPLE_HEALTH_FALLBACK_URL);
}
