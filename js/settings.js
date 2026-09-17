// 런타임 설정 저장소.
//
// anon key 를 코드에 넣지 않고 앱에서 직접 입력할 수 있게 한다.
// 이렇게 하면:
//   - 저장소에 키가 커밋될 일이 없다 (실수로도).
//   - 키가 바뀌어도 재배포 없이 앱에서 교체할 수 있다.
//   - 배포 환경마다 다른 키를 쓸 수 있다.
//
// 우선순위: localStorage → config.js 기본값
// (config.js 에 넣는 방식도 그대로 동작한다. 정적 호스팅에 키를 박아두고 싶으면 그쪽을 쓰면 된다.)

import { SUPABASE_ANON_KEY as CONFIG_KEY, PROFILE_ID as CONFIG_PROFILE } from './config.js';

const KEY_ANON = 'chace:anonKey';
const KEY_PROFILE = 'chace:profileId';

function read(k) {
  try {
    return localStorage.getItem(k) || '';
  } catch {
    return ''; // 프라이빗 모드 등에서 접근이 막혀도 앱은 계속 동작해야 한다
  }
}

function write(k, v) {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

const isPlaceholder = (v) => !v || v.startsWith('PASTE_');

export function getAnonKey() {
  const stored = read(KEY_ANON);
  if (stored) return stored;
  return isPlaceholder(CONFIG_KEY) ? '' : CONFIG_KEY;
}

export function setAnonKey(value) {
  return write(KEY_ANON, (value || '').trim());
}

export function getProfileId() {
  return read(KEY_PROFILE) || CONFIG_PROFILE;
}

export function setProfileId(value) {
  return write(KEY_PROFILE, (value || '').trim());
}

export function isConfigured() {
  return !!getAnonKey();
}

/**
 * anon key 인지 최소한으로 검사한다.
 * Supabase 키는 JWT(헤더.페이로드.서명) 형태이고, payload 의 role 로 종류를 알 수 있다.
 * service_role 키가 들어오면 막는다 — 브라우저에 두면 DB 전체가 열리는 키다.
 */
export function inspectKey(value) {
  const key = (value || '').trim();
  if (!key) return { ok: false, reason: '키가 비어 있습니다.' };

  const parts = key.split('.');
  if (parts.length !== 3) {
    // 새 형식(sb_publishable_...)도 허용한다. JWT 가 아니라고 무조건 거절하지 않는다.
    if (/^sb_publishable_/.test(key)) return { ok: true, role: 'anon' };
    if (/^sb_secret_/.test(key)) {
      return { ok: false, reason: 'secret 키입니다. 브라우저에 넣으면 안 됩니다.' };
    }
    return { ok: true, role: null }; // 형식을 모르면 통과시키고 실제 요청으로 판정
  }

  try {
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')),
    );
    if (payload.role === 'service_role') {
      return {
        ok: false,
        reason: 'service_role 키입니다. RLS 를 무시하는 전권 키라 브라우저에 넣으면 안 됩니다. anon / public 키를 쓰세요.',
      };
    }
    return { ok: true, role: payload.role ?? null };
  } catch {
    return { ok: true, role: null };
  }
}
