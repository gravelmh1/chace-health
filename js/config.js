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
  // 실제 측정 시각 컬럼. 이 테이블에 measured_at / created_at 은 존재하지 않는다.
  // 모든 "최신값" 정렬의 기준.
  recordedAt: 'recorded_at',
  metadata: 'metadata', // jsonb. local_date, aggregation, complete_day 등
  updatedAt: 'updated_at',
};

export const CALENDAR_TABLE = 'health_calendar_events';

export const CALENDAR_COL = {
  profileId: 'profile_id',
  calendarId: 'calendar_id',
  eventId: 'event_id',
  title: 'title',
  category: 'category',   // 기본값 '운동'
  startAt: 'start_at',    // starts_at 아님
  endAt: 'end_at',        // ends_at 아님
  location: 'location',
  source: 'source',       // 기본값 'google_calendar'
};

/** 달력에서 운동 일정으로 취급할 category */
export const WORKOUT_CATEGORY = '운동';

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
// 원래 의도는 App Store 가 아니라 RENPHO 앱을 직접 여는 것이다.
// 이 스킴은 실기기에서 검증되지 않았지만, open-renpho.js 가 숨김 iframe 으로
// 던지기 때문에 스킴이 틀려도 Safari 오류 페이지가 뜨지 않는다.
// (location 을 직접 바꾸면 "address is invalid" 가 뜬다 — 그래서 안 그런다)
// 앱으로 전환되지 않으면 아래 https 주소로 폴백한다.
export const RENPHO_APP_SCHEME = 'renpho://';

// 항상 유효한 https 폴백. 앱이 설치돼 있으면 iOS 가 이 링크에서 앱으로 전환해 주고,
// 없으면 설치 페이지가 열린다. 어느 쪽이든 오류창은 없다.
export const RENPHO_FALLBACK_URL = 'https://apps.apple.com/us/search?term=RENPHO%20Health';

// ---------------------------------------------------------------------------
// 약 / 운동 기록
//
// 앱에서 직접 입력하는 값이라 Supabase 동기화 데이터와 별개로 저장한다.
// health_external_metrics 를 덮어쓰지 않는다.
// ---------------------------------------------------------------------------

export const MEDICATIONS = [
  { id: 'vitaminD', label: '비타민D', short: '비D', daily: true },
  // 두타는 "복용 예정일"에만 표시된다. 원본 앱의 주기를 확인할 수 없어
  // 기본값을 매일(1일)로 두었다. 설정에서 주기와 기준일을 바꿀 수 있다.
  { id: 'duta', label: '두타', short: '두타', daily: false },
];

// 원본 앱 화면에서 두타는 이틀에 한 번(7, 9, 11, 13, 15, 17, 19...) 표시된다.
export const DUTA_DEFAULT_INTERVAL_DAYS = 2;

// shape 은 색 없이도 계열을 구분하기 위한 보조 부호다.
// 색약(적록) 환경에서 삼두(초록) ↔ 덤벨(주황) 선이 거의 겹치기 때문에,
// 원본이 이미 타일에 쓰고 있는 도형을 차트 마커로도 그대로 쓴다.
export const EXERCISES = [
  { id: 'pushup',   label: '푸쉬업', shape: 'arrow',   color: '#2F7BEF' },
  { id: 'dumbbell', label: '덤벨',   shape: 'diamond', color: '#F5A623' },
  { id: 'triceps',  label: '삼두',   shape: 'circle',  color: '#34C759' },
  { id: 'shoulder', label: '어깨',   shape: 'triangle',color: '#9B59E8' },
];

/** 차트에 표시할 기간 (일) */
export const CHART_DAYS = 14;

/** 달력에 표시할 주 수 (지난주 · 이번주 · 다음주) */
export const CALENDAR_WEEKS = 3;
