// Chace, health — 앱 설정
//
// 보안 규칙 (중요):
//   - SUPABASE_ANON_KEY 만 이 파일에 넣습니다. anon key 는 브라우저에 노출되는 것을
//     전제로 설계된 공개 키이며, RLS(Row Level Security) 가 실제 접근을 통제합니다.
//   - service_role key 는 절대 이 파일에도, 저장소 어디에도 넣지 않습니다.
//     service_role 은 RLS 를 무시하는 전권 키라 유출 시 DB 전체가 열립니다.

export const SUPABASE_URL = 'https://whawmtbksquervliksqv.supabase.co';

// 👇 Supabase 대시보드 → Project Settings → API → "anon / public" 키를 붙여넣으세요.
export const SUPABASE_ANON_KEY = 'PASTE_YOUR_SUPABASE_ANON_KEY_HERE';

export const PROFILE_ID = '6eb29763-315a-46b7-bcf7-da24b8f1503e';

// 앱 전체에서 쓰는 단일 기준 시간대. 날짜 경계(오늘/어제)도 전부 이 값을 씁니다.
export const TIME_ZONE = 'America/Los_Angeles';

// ---------------------------------------------------------------------------
// 테이블 / 컬럼 매핑
//
// 실제 Supabase 스키마와 이름이 다르면 여기만 고치면 앱 전체가 따라갑니다.
// (쿼리 코드에 컬럼명을 흩뿌려 놓지 않는 이유 = 스키마 확인 후 한 곳만 수정하기 위함)
// ---------------------------------------------------------------------------
export const METRICS_TABLE = 'health_external_metrics';

export const METRICS_COL = {
  profileId: 'profile_id',
  source: 'source',
  metric: 'metric',
  value: 'value',
  unit: 'unit',
  measuredAt: 'measured_at', // 실제 "측정 시각". 저장 시각(created_at)이 아님 — 정렬 기준.
  metadata: 'metadata',      // jsonb. metadata->>local_date = 'YYYY-MM-DD' (LA 기준 날짜)
};

export const CALENDAR_TABLE = 'health_calendar_events';

export const CALENDAR_COL = {
  profileId: 'profile_id',
  title: 'title',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  source: 'source',
};

// 데이터 소스 이름 (DB 의 source 컬럼 값과 정확히 일치해야 함)
export const SOURCE = {
  renpho: 'RENPHO Health',
  apple: 'Apple Health',
};

// ---------------------------------------------------------------------------
// RENPHO 카드 클릭 동작
//
// 검증되지 않은 커스텀 스킴(renpho:// 등)을 그대로 실행하면 iOS Safari 가
// "Safari cannot open the page because the address is invalid" 를 띄웁니다.
// 그래서 기본값은 "스킴 시도 안 함" 입니다. 반드시 동작하는 https 링크만 엽니다.
//
// 실기기에서 동작이 검증된 스킴이 있다면 그때 아래 값을 채우세요.
// 값이 있을 때만 "스킴 먼저 시도 → 실패하면 https 폴백" 경로가 켜집니다.
// ---------------------------------------------------------------------------
export const RENPHO_APP_SCHEME = null; // 예: 'renpho://' (검증된 경우에만)

// 항상 유효한 https 폴백. 앱이 설치돼 있으면 iOS 가 App Store 링크에서
// 앱으로 전환해 주고, 없으면 설치 페이지가 열립니다. 어느 쪽이든 오류창은 없습니다.
export const RENPHO_FALLBACK_URL = 'https://apps.apple.com/us/search?term=RENPHO%20Health';
