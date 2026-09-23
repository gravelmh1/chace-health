# Chace, health

Apple Health / RENPHO 측정값을 Supabase 에서 읽어 보여주는 개인 건강 대시보드.
빌드 단계 없는 정적 웹앱(HTML + ES module)이라 어떤 정적 호스팅에도 그대로 올라갑니다.

## 시작하기

앱을 열고 **⚙ 설정**에서 Supabase **anon / public** 키를 붙여넣으면 끝입니다.
코드를 고칠 필요가 없고, 키는 브라우저에만 저장되어 저장소에 올라가지 않습니다.

```bash
npm install
npm run dev      # http://127.0.0.1:5173
```

키를 코드에 박아두고 싶으면 `js/config.js` 의 `SUPABASE_ANON_KEY` 에 넣어도 됩니다.
(우선순위: 앱에서 입력한 값 → `config.js` 기본값)

키를 옮기기 어려운 기기(아이폰에서 Supabase 복사 버튼이 막히는 경우)에서는
주소로 한 번에 넣을 수 있습니다:

```
https://gravelmh1.github.io/chace-health/#key=sb_publishable_xxxx
```

조각(`#`)에 담기 때문에 서버로 전송되지 않고, 저장한 즉시 주소에서 지워집니다.
앱이 이미 열려 있을 때 눌러도 동작합니다.

> **service_role 키는 넣을 수 없습니다.** 입력해도 저장이 거부됩니다.
> RLS 를 무시하는 전권 키라 브라우저에 두면 DB 전체가 열립니다.
> anon 키는 브라우저 노출을 전제로 만들어진 공개 키이고, 실제 접근 통제는 RLS 가 합니다.

## 스키마 확인

**⚙ 설정 → 스키마 진단** 을 누르면 실제 테이블을 읽어서
`js/config.js` 의 컬럼 매핑이 맞는지 그 자리에서 대조해 보여줍니다.
틀린 컬럼이 있으면 실제 컬럼 목록까지 같이 뜹니다.

매핑이 다르면 `js/config.js` 상단의 `METRICS_COL` / `CALENDAR_COL` **그것만 고치면**
앱 전체가 따라갑니다. 쿼리 코드에는 컬럼명을 흩뿌려두지 않았습니다.

원시 데이터까지 보려면 `tools/schema-probe.html` 을 여세요.

현재 코드가 가정하는 구조:

| 테이블 | 컬럼 |
|---|---|
| `health_external_metrics` | `profile_id`, `recorded_at`, `source`, `metric`, `value`, `unit`, `metadata`(jsonb), `updated_at` |
| `health_calendar_events` | `profile_id`, `calendar_id`, `event_id`, `title`, `category`, `start_at`, `end_at`, `location`, `source`, `updated_at` |
| `health_cloud_days` | `profile_id`, `day`, `meds`(jsonb), `workouts`(jsonb), `events`(jsonb), `updated_at` — PK `(profile_id, day)` |

약·운동 기록은 `health_cloud_days` 에 있습니다. 같은 구조의 `health_day_records` 는
비어 있는 예전 테이블이라 쓰지 않습니다.

- `meds` 키: `vitD`(비타민D), `duta`(두타)
- `workouts` 키: `pushup` / `dumbbell` / `triceps` / `shoulder` — **아직 확정 전**이라
  `js/config.js` 의 `EXERCISES[].aliases` 에 적힌 표기(camelCase, snake_case, 복수형)도
  함께 찾습니다. 실제 키가 확정되면 `aliases` 를 지우면 됩니다.

일정은 세 곳에서 모아 보여줍니다 — `health_cloud_days.events`,
`health_calendar_events`(Google Calendar), 그리고 앱에서 직접 넣은 것.

**쓰기는 하지 않습니다.** 앱에서 입력한 값은 브라우저에만 쌓이고, 화면에는
"클라우드 값 위에 로컬 수정본을 덮은" 결과를 보여줍니다. 기존 42일치 기록이
손상될 일이 없습니다. 반대로 이 앱에서 입력한 값은 원본 앱에 반영되지 않습니다.

**주의할 이름들** — 흔히 틀리는 지점입니다.

- 측정 시각 컬럼은 `recorded_at` 입니다. 이 테이블에 `measured_at` / `created_at` 은 **없습니다.**
- 달력은 `start_at` / `end_at` 입니다. `starts_at` / `ends_at` 이 **아닙니다.**

`source` 값: `Apple Health`, `RENPHO Health`

`metric` 값과 단위:

| metric | unit |
|---|---|
| `bodyMass` | kg |
| `bodyFatPercentage` | % |
| `bodyMassIndex` | unitless |
| `leanBodyMass` | kg |
| `heartRate` | count/min |
| `stepCount` | count |
| `distanceWalkingRunning` | m (화면에는 mi 로 환산) |

`metadata` jsonb 키: `aggregation`, `complete_day`, `day`, `incomplete_day`,
`local_date`, `local_time`, `local_timestamp`, `sample_end_local`, `source`,
`source_bundle`, `synced_local_time`, `timezone`

`health_calendar_events` 기본값: `category = '운동'`, `source = 'google_calendar'`

## 처음 한 번: 읽기 통로 만들기

건강 테이블들은 RLS 가 켜져 있어 anon 키로는 직접 읽을 수 없습니다 (맞는 설정입니다).
`supabase/chace_health_pull.sql` 을 Supabase SQL Editor 에 붙여넣고 실행하면
앱 전용 읽기 함수가 생깁니다.

기존 테이블·정책·함수는 건드리지 않고, 쓰기도 하지 않습니다.
해당 `profile_id` 한 사람의 최근 데이터만 돌려줍니다.

## 읽기 경로 — RPC 우선, 테이블 폴백

`health_external_metrics` 에 RLS 가 걸려 있으면 anon 키로는 직접 SELECT 가 막힙니다.
원본 앱이 쓰던 `health_sync_pull()` 은 그 제약을 넘어 정해진 데이터만 돌려주는 통로입니다.

1. **`rpc/chace_health_pull()` → `rpc/health_sync_pull()`** 순서로 호출합니다.
   (`js/config.js` 의 `SYNC_PULL_FNS`) 응답에서 metric 행과 캘린더 행을
   꺼내 클라이언트에서 추립니다. 반환 키 이름이 확정되지 않아
   `metrics` / `calendar_events` 등 여러 모양을 받아들입니다 (`js/select.js`).
2. 함수가 없거나 빈 응답이면 **테이블을 직접 조회**합니다.
   그쪽도 막혀 있으면 오류 메시지가 RLS 를 지목합니다.

어느 경로든 고르는 규칙은 같습니다 — 최신 1건, 일일 집계 우선.
`npm run test:rpc` 가 "테이블 전부 401 + RPC 정상" 상태에서 두 경로의 결과가
같은 값을 내는지 확인합니다.

## 데이터 흐름에서 지키는 규칙

옛날 값이 화면에 남는 사고를 구조적으로 막기 위한 규칙입니다. 고칠 때 이 전제를 깨지 마세요.

1. **metric 마다 독립적으로 최신 1건을 조회한다.**
   체중 기록 한 건을 통째로 읽어 거기 붙은 체지방/BMI/근육량을 같이 쓰면,
   그 측정 세션에 일부 metric 이 빠졌을 때 카드 전체가 과거 시점에 고정됩니다.
2. **정렬은 `recorded_at`(측정 시각) 기준.**
   이 테이블에 `measured_at` / `created_at` 은 존재하지 않습니다.
   `updated_at`(갱신 시각)으로 정렬하면 동기화가 몰아 들어올 때 순서가 뒤집힙니다.
3. **날짜 경계는 UTC timestamp 범위로 자르지 않는다.**
   `metadata->>local_date` 의 LA 날짜 문자열로 직접 매칭합니다.
   UTC 로 자르면 LA 오후 5시 이후 데이터가 "내일"로 넘어가 오늘 걸음수가 0 이 됩니다.
4. **데이터가 없으면 0 이 아니라 `null`.** "측정값 0" 과 "기록 없음" 은 다른 상태입니다.
4-1. **`stepCount` 는 날짜당 행이 1개가 아닙니다.**
   현재는 `metadata.aggregation = 'daily_sum'` 인 일일 집계 행이지만,
   과거에는 같은 `local_date` 에 시간별 누적 snapshot 행이 여러 개 쌓였습니다.
   그래서 그 날짜의 행을 모두 받아 **집계 행이 있으면 그것을**, 없으면
   가장 최근 snapshot 을 씁니다. "최신 1건"만 집으면 집계 행보다 나중에 들어온
   부분 snapshot 을 잡아 값이 작아집니다.
5. **날짜/시간 계산은 `js/time.js` 를 통해서만.**
   `toISOString().slice(0,10)` 과 `getDate()/getMonth()` 는 쓰지 않습니다.
6. **캐시를 신뢰하지 않는다.** 모든 요청에 `cache: 'no-store'`,
   최초 로드 / 탭 복귀(`visibilitychange`) / bfcache 복원(`pageshow`) / 새로고침 버튼에서 재조회합니다.

## 테스트

```bash
npm install
npm run test:all
```

| 명령 | 내용 |
|---|---|
| `npm test` | 실제 Chromium 에서 앱을 띄우고 화면에 찍힌 값을 검증 (31개) |
| `NOW=2026-09-18T03:00:00Z npm test` | LA 는 9/17 저녁, UTC 는 이미 9/18 인 시간대 경계 |
| `npm run test:rpc` | RLS 로 테이블이 막힌 상태에서 RPC 경로가 같은 값을 내는지 (14개) |
| `npm run test:setup` | 설정 화면 · service_role 키 차단 · URL 오입력 차단 · 키 유지 |
| `npm run test:update` | 캐시된 옛 빌드가 새 배포를 스스로 잡아 새로 뜨는지 |

Supabase REST 응답을 픽스처로 가로채되, 앱이 만든 쿼리 문자열을 실제로 해석해서
결과를 돌려줍니다 — **쿼리가 틀리면 틀린 값이 화면에 뜨고 테스트가 실패합니다.**

픽스처에는 옛날 행(9/15)과 최신 행(9/17)이 **둘 다** 들어있고,
`measured_at` 과 `created_at` 의 순서를 일부러 뒤집어 놨습니다.
저장시각으로 정렬하는 코드는 이 픽스처에서 반드시 실패합니다.

브라우저 시간대는 일부러 `Asia/Seoul` 로 두고 LA 기준 표시가 흔들리지 않는지 확인합니다.

## 카드 클릭 → 앱 열기

- **Apple 건강** 카드 → `x-apple-health://` — **폴백 없음**.
  건강 앱은 아이폰에 항상 있으므로 설치 페이지가 필요 없고, 안 열렸다고
  애플 홈페이지 같은 곳으로 보내면 더 나쁩니다. 열리지 않으면 아무 일도 없습니다.
- **RENPHO** 카드 → `renpho://` — 앱이 없을 수 있으므로 App Store 검색으로 폴백합니다.

둘 다 앱을 직접 여는 것이 목적입니다. 스킴은 실기기에서 검증되지 않았지만, **숨김 iframe 으로 던지기 때문에
스킴이 틀려도 Safari 오류 페이지가 뜨지 않습니다.** 최상위 문서를 커스텀 스킴으로
이동시키면 "Safari cannot open the page because the address is invalid" 가 뜨는데,
그 경로를 쓰지 않는 것이 핵심입니다.

1.2초 안에 앱으로 전환되지 않으면 항상 유효한 https 주소로 폴백합니다.
테스트가 **최상위 문서는 https 로만 이동한다**는 것을 고정하고 있습니다.

스킴을 바꾸려면 `js/config.js` 의 `RENPHO_APP_SCHEME` / `APPLE_HEALTH_SCHEME` 만 고치면 됩니다.

> 화면의 건강 수치는 Supabase 에서 읽습니다. 이 경로는 정상 동작합니다.
> 앱이 HealthKit 에서 **직접** 가져오지 못할 뿐입니다 — HealthKit 은 네이티브 iOS 앱
> 전용이라 웹앱에는 애초에 열려 있지 않습니다. Supabase 에는 `ChatGPT Health sync` 가
> 넣어 줍니다.

## 배포하면 앱이 알아서 새 버전을 받는다

GitHub Pages 는 응답 헤더를 바꿀 수 없어 파일이 최대 10분 캐시되고,
홈 화면에 추가한 웹앱은 HTML 을 더 오래 붙잡습니다. 그래서 두 겹으로 막습니다.

1. **파일 주소에 커밋 해시를 붙입니다** (배포 단계에서). 같은 이름이라도
   주소가 달라지므로 캐시가 살아 있어도 새로 받습니다.
2. **`version.json` 으로 HTML 자체의 낡음을 잡습니다.** 1번만으로는 부족합니다 —
   그 주소들을 가리키는 `index.html` 이 캐시되면 옛 주소를 계속 가리키기 때문입니다.
   페이지는 열릴 때와 탭에 돌아올 때마다 `version.json?t=<현재시각>` 을 읽고,
   자기 버전과 다르면 `?v=<새버전>` 으로 스스로 이동합니다.
   그 주소는 브라우저가 처음 보는 주소라 HTML 을 새로 받습니다.

같은 버전으로는 다시 이동하지 않으므로 새로고침이 반복되지 않습니다.
현재 실행 중인 버전은 **⚙ 설정 아래쪽**에 표시됩니다.

## 배포

빌드 단계가 없으므로 저장소를 그대로 정적 호스팅에 연결하면 됩니다.
push 할 때마다 자동 배포되고, 그때부터 "코드 → 배포 → 아이폰 화면"이 한 줄로 이어집니다.

- **GitHub Pages** — `.github/workflows/pages.yml` 포함.
  **Settings → Pages → Source 를 "GitHub Actions" 로 한 번 바꿔야** 동작합니다.
  (워크플로가 자동으로 켜도록 `enablement: true` 를 넣어봤지만, Actions 토큰에는
  Pages 사이트 *생성* 권한이 없어 `Resource not accessible by integration` 으로 막힙니다.
  `pages: write` 는 배포만 허용합니다. 사람이 한 번 눌러야 하는 단계입니다.)
  private 저장소의 Pages 는 GitHub Pro 이상이 필요합니다.
- **Vercel** — `vercel.json` 포함. import 할 때 프레임워크는 `Other`, 빌드 명령은 비워둡니다.
- **Netlify** — `netlify.toml` 포함. 추가 설정 없이 그대로 연결하면 됩니다.
- **Cloudflare Pages** — 빌드 명령 비움, 출력 디렉터리 `/`.

두 설정 파일 모두 `index.html` 과 `js/*` 에 `Cache-Control: no-store` 를 겁니다.
호스팅이 예전 파일을 계속 내려주면 코드를 고쳐 배포해도 아이폰에는 옛날 앱이 뜨는데,
이번에 고친 문제와 정확히 같은 종류의 사고입니다.

## 화면

원본 앱(ChatGPT Sites) 스크린샷을 기준으로 맞췄습니다. 구성은 위에서부터:

1. 헤더 — `9월 17일 (목)` / `Chace, health` / `↻ 최신`
2. **Apple 건강** (빨강 카드) — 걸음 · 걷기·달리기 거리 · 심박수 + 측정 시각
3. **RENPHO** (차콜 카드) — 체중 / 체지방 / BMI / 제지방 + 동기화 시각
4. **3주 기록** — 지난주·이번주·다음주, 일요일 시작.
   칸마다 `비D` · `두타`(격일) · 운동 총횟수 · 일정 제목 · 점(초록=운동, 보라=일정)
5. **기록하기** — 운동 4종(푸쉬업·덤벨·삼두·어깨) 증감, 약 복용 체크.
   오른쪽 **+** 는 그 날짜의 **운동 일정**(골프, 운동쉰날 같은)을 넣는 버튼입니다.
6. **최근 2주 운동** — 계열별 합계 범례 + 일자별 선 차트

숫자 표기는 원본을 따릅니다. 체중·제지방은 불필요한 0 을 없애고(`78`, `78.3`, `67.96`),
BMI 는 소수점 한 자리를 고정합니다(`23.9`, `24.0`).
시각은 `9. 17. 오전 10:07` 형식이며, 오전/오후는 직접 만듭니다
(런타임 ICU 에 따라 `ko-KR` 이 `AM` 을 돌려주는 경우가 있습니다).

**표시 시각은 `metadata` 의 현지 시각을 우선합니다.**
`recorded_at` 을 시간대 변환해 쓰면 일일 집계 행에서 어긋납니다 —
그 행의 `recorded_at` 은 동기화 시각이 아니라 집계 기준 시각이기 때문입니다.

| 표시 | 쓰는 값 |
|---|---|
| Apple 동기화 | `metadata.synced_local_time` |
| 측정 시각 | `metadata.local_timestamp` → `sample_end_local` → `local_date`+`local_time` |
| 그래도 없으면 | `recorded_at` 을 LA 로 변환 |

이 값들은 이미 현지 벽시계 값이므로 **시간대 변환을 하지 않고 그대로** 표시합니다.

### 차트 색에 대해

원본 팔레트(푸쉬업 `#2F7BEF` · 덤벨 `#F5A623` · 삼두 `#34C759` · 어깨 `#9B59E8`)는
**적록색약 환경에서 삼두(초록)와 덤벨(주황)의 분리도가 낮습니다** (ΔE 4.4, protan).
색을 바꾸지 않기로 했으므로, 원본이 이미 타일에 쓰고 있는 도형
(↗ 푸쉬업 · ◆ 덤벨 · ● 삼두 · ▲ 어깨)을 차트 마커와 범례에 함께 그려
색 없이도 계열이 구분되게 했습니다. 범례에는 계열별 합계를 직접 표기합니다.

색까지 고치고 싶다면 `js/config.js` 의 덤벨 색을 `#E85D04` 로 바꾸면
분리도 검사를 통과합니다 (ΔE 8.1). 눈에 보이는 색감은 거의 그대로입니다.

## 아이폰 홈 화면에 추가

`manifest.webmanifest` 와 `apple-touch-icon` 이 들어있어,
Safari 에서 공유 → **홈 화면에 추가** 하면 주소창 없는 앱처럼 실행됩니다.

## CI

`.github/workflows/test.yml` 이 push 마다 세 스위트를 모두 돌리고
검증 스크린샷을 아티팩트로 올립니다.
