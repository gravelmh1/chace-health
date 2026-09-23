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

키를 눈으로 읽어 옮기다 `l`/`I`/`1`, `O`/`0` 에서 틀리면, 저장할 때 앱이
그 자리들을 바꿔 가며 실제로 요청해 맞는 키를 찾아냅니다.
형식이 정해진 앞부분(`sb_publishable_`)은 건드리지 않고, 조합이 너무 많으면
포기합니다 — 긴 JWT 는 자동 교정 대상이 아닙니다.

**키 확인 방법**: 앱이 실제로 쓰는 경로(RPC → 테이블)로 확인합니다.
PostgREST 루트(`/rest/v1/`)는 anon 에게 열려 있지 않을 수 있어, 그 주소로 판정하면
키가 정확해도 401 이 나고 그 하나 때문에 모든 검사와 조회가 막힙니다.

**인증 헤더**: `apikey` 는 항상 보내고, `Authorization: Bearer` 는 키가 JWT 일 때만
보냅니다. 새 형식(`sb_publishable_…`)은 JWT 가 아니라서 Bearer 로 함께 보내면
서버가 그것을 토큰으로 파싱하려다 실패해 401 을 돌려줍니다 —
키는 멀쩡한데 "키가 거부되었습니다" 가 뜨는 원인이 이것이었습니다.

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

## 앱을 열 때마다 최신값 — iOS 단축어

앱은 DB 의 최신값을 보여 줍니다. DB 로 넣어 주는 동기화(`ChatGPT Health sync`)가 가끔만
돌면, 앱 숫자가 Apple 건강·RENPHO 앱과 어긋납니다. 웹앱은 Apple 건강을 직접 읽을 수 없습니다.

iOS 단축어는 읽을 수 있으므로, **단축어가 읽어서 DB 에 넣고 앱을 여는** 흐름을 만듭니다.
RENPHO 는 체중·체지방을 Apple 건강에 써 넣으므로 단축어 하나로 둘 다 됩니다.
단축어를 홈 화면에 두면, 누를 때마다 방금 값으로 앱이 열립니다.

- DB 쪽: `supabase/chace_health_push.sql` 을 SQL Editor 에서 한 번 실행
- 폰 쪽: 단축어 한 번 만들기 (건강 샘플 찾기 6개 → URL 콘텐츠 가져오기 → URL 열기)

`chace_health_push()` 는 **추가만** 합니다. 지우거나 고치지 않고, 같은 측정은 다시 넣지
않습니다. 입력은 전부 text 로 받아 숫자를 뽑아냅니다 — 단축어가 `"78.2 kg"`, `"3,269"`,
체지방 `0.132` 처럼 보내도 됩니다. 시간대 표시가 없는 시각(`Sep 23, 2026 at 1:10 PM`,
`2026. 9. 23. 오후 1:10`)은 LA 기준으로 읽습니다 — 그냥 캐스팅하면 UTC 로 읽혀 7시간이
어긋납니다.

검증은 로컬 Postgres 에서 했습니다. 실제와 같은 스키마(RLS 켜짐, anon 역할)를 만들고,
anon 으로 넣고 anon 으로 꺼낸 결과를 `tests/pulled-sample.json` 에 저장해
`npm run test:push` 가 그 JSON 으로 화면을 확인합니다.

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
RPC 를 쓸 수 있는지에 대한 판정은 **어떤 키로 판정했는지와 함께** 기억합니다.
키가 없을 때의 실패는 판정으로 삼지 않습니다 — 그러면 키를 넣은 뒤에도 계속
테이블로만 가서, RLS 에 막혀 "권한이 없습니다" 가 뜹니다.

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
4-0. **오늘 데이터가 없으면 마지막 "날의 합계" 로 물러납니다.** 마지막 "행" 이 아닙니다.
   그 행은 하루의 일부만 담은 snapshot 일 수 있어, 3,269 걸음인 날에 191 이 찍힙니다.

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

| 카드 | 여는 것 | 방식 |
|---|---|---|
| Apple 건강 | `x-apple-health://` | 최상위 문서를 스킴으로 이동 |
| RENPHO | `renpho://` | 최상위 문서를 스킴으로 이동 |

**폴백은 두지 않습니다.** 앱이 열리지 않았을 때 App Store 검색이나 애플 홈페이지로
보내면 엉뚱한 곳이 열립니다. 안 열리면 아무 일도 일어나지 않는 편이 낫습니다.

처음에는 RENPHO 를 숨김 iframe 으로 던졌습니다. 앱이 없어도 오류창이 뜨지 않기
때문인데, **최신 iOS Safari 가 iframe 으로 던진 스킴을 무시해서 아예 열리지
않았습니다.** 직접 이동인 Apple 건강만 열린 것이 그 증거였습니다. 그래서 둘 다
직접 이동으로 맞췄습니다.

대신 스킴이 틀리면 "주소가 유효하지 않습니다" 가 뜹니다. `renpho://` 는 실기기에서
확인되지 않은 값이라, 이 시도 자체가 확인 절차입니다. 오류가 뜨면 그 스킴이
아니라는 뜻이므로 값을 바꾸거나 `null` 로 끄면 됩니다.

`openExternalApp` 의 iframe 경로는 그대로 남아 있습니다 (`direct: false`).
iframe 이 통하는 환경에서는 그쪽이 더 안전합니다.

**RENPHO 주소는 앱 설정(⚙)에서 바꿉니다.** 어느 주소가 RENPHO 앱을 여는지는
그 기기에서만 알 수 있기 때문입니다. 설정에 후보 목록이 있어 하나씩 눌러 볼 수 있고,
앱이 열리는 것이 정답입니다. 저장한 값이 `js/config.js` 기본값보다 우선합니다.
비워 두면 카드 탭이 꺼집니다.

Apple 건강 스킴은 `js/config.js` 의 `APPLE_HEALTH_SCHEME` 에서 바꿉니다.

무엇을 열려고 했는지는 `chace:open-app` 이벤트로 나갑니다 — 커스텀 스킴 이동은
브라우저 계층에서 관측되지 않아, 동작을 확인할 수 있는 유일한 지점입니다.

> 화면의 건강 수치는 Supabase 에서 읽습니다. 이 경로는 정상 동작합니다.
> 앱이 HealthKit 에서 **직접** 가져오지 못할 뿐입니다 — HealthKit 은 네이티브 iOS 앱
> 전용이라 웹앱에는 애초에 열려 있지 않습니다. Supabase 에는 `ChatGPT Health sync` 가
> 넣어 줍니다.

## 아이폰 홈 화면에 추가

`manifest.webmanifest` 와 `apple-touch-icon` 이 들어있어,
Safari 에서 공유 → **홈 화면에 추가** 하면 주소창 없는 앱처럼 실행됩니다.

## CI

`.github/workflows/test.yml` 이 push 마다 세 스위트를 모두 돌리고
검증 스크린샷을 아티팩트로 올립니다.
