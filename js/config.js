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
// 카드 클릭 → 외부 앱 열기
//
// 기본은 "아무것도 하지 않음" 이다.
//
// renpho:// 와 x-apple-health:// 를 추측으로 넣어 봤지만, 실기기에서 앱이 열리지
// 않고 엉뚱한 곳으로 가는 결과만 나왔다. 검증되지 않은 스킴을 던지는 것보다
// 아무 일도 일어나지 않는 편이 낫다. App Store 검색 페이지로 보내는 폴백도
// 원하는 동작이 아니라서 없앴다.
//
// 실기기에서 확실히 동작하는 스킴이 확인되면 그때 여기에 넣으면 된다.
// 값이 있을 때만 카드가 눌리는 상태가 되고, 스킴은 숨김 iframe 으로만 시도한다.
// ---------------------------------------------------------------------------
export const RENPHO_APP_SCHEME = null;
export const RENPHO_FALLBACK_URL = null;

export const APPLE_HEALTH_SCHEME = null;
export const APPLE_HEALTH_FALLBACK_URL = null;

// ---------------------------------------------------------------------------
// 약 / 운동 기록
//
// 앱에서 직접 입력하는 값이라 Supabase 동기화 데이터와 별개로 저장한다.
// health_external_metrics 를 덮어쓰지 않는다.
// ---------------------------------------------------------------------------

// id 는 health_cloud_days.meds JSONB 의 키와 같아야 한다.
export const MEDICATIONS = [
  { id: 'vitD', label: '비타민D', short: '비D', daily: true },
  // 두타는 "복용 예정일"에만 표시된다. 원본 앱의 주기를 확인할 수 없어
  // 기본값을 매일(1일)로 두었다. 설정에서 주기와 기준일을 바꿀 수 있다.
  { id: 'duta', label: '두타', short: '두타', daily: false },
];

// 원본 앱 화면에서 두타는 이틀에 한 번(7, 9, 11, 13, 15, 17, 19...) 표시된다.
export const DUTA_DEFAULT_INTERVAL_DAYS = 2;

// ---------------------------------------------------------------------------
// 약 / 운동 기록이 실제로 저장되는 테이블.
//
// meds, workouts 는 JSONB 이고 키는 각각 MEDICATIONS[].id, EXERCISES[].id 를 쓴다.
// (health_day_records 는 같은 구조의 예전 테이블이지만 비어 있어 쓰지 않는다)
// ---------------------------------------------------------------------------
export const DAYS_TABLE = 'health_cloud_days';

/**
 * 읽기 통로로 시도할 RPC 이름들 (앞에서부터 순서대로).
 *
 * 테이블에 RLS 가 걸려 있어 anon 으로는 직접 SELECT 가 막힌다.
 * SECURITY DEFINER 함수만이 정해진 데이터를 돌려주는 통로다.
 *
 * health_sync_pull 은 원본 앱이 쓰던 이름이고, chace_health_pull 은
 * 이 앱을 위해 새로 만드는 이름이다. 기존 함수를 바꾸지 않기 위해 이름을 나눴다.
 */
export const SYNC_PULL_FNS = ['chace_health_pull', 'health_sync_pull'];

export const DAYS_COL = {
  profileId: 'profile_id',
  day: 'day',
  meds: 'meds',
  workouts: 'workouts',
  events: 'events',
  updatedAt: 'updated_at',
};

// shape 은 색 없이도 계열을 구분하기 위한 보조 부호다.
// 색약(적록) 환경에서 삼두(초록) ↔ 덤벨(주황) 선이 거의 겹치기 때문에,
// 원본이 이미 타일에 쓰고 있는 도형을 차트 마커로도 그대로 쓴다.
//
// workouts JSONB 의 실제 키 이름은 아직 확정되지 않았다. 그래서 id 하나만 보지 않고
// aliases 에 적힌 이름도 함께 찾는다. 확정되면 aliases 를 지우면 된다.
export const EXERCISES = [
  { id: 'pushup',   label: '푸쉬업', shape: 'arrow',    color: '#2F7BEF',
    aliases: ['pushUp', 'push_up', 'pushups', 'pushUps'] },
  { id: 'dumbbell', label: '덤벨',   shape: 'diamond',  color: '#F5A623',
    aliases: ['dumbBell', 'dumb_bell', 'dumbbells'] },
  { id: 'triceps',  label: '삼두',   shape: 'circle',   color: '#34C759',
    aliases: ['tricep', 'tri', 'triceps_ext'] },
  { id: 'shoulder', label: '어깨',   shape: 'triangle', color: '#9B59E8',
    aliases: ['shoulders', 'shoulderPress', 'shoulder_press'] },
];

/** 차트에 표시할 기간 (일) */
export const CHART_DAYS = 14;

/** 달력에 표시할 주 수 (지난주 · 이번주 · 다음주) */
export const CALENDAR_WEEKS = 3;
