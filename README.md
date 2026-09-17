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
| `health_external_metrics` | `profile_id`, `source`, `metric`, `value`, `unit`, `measured_at`, `metadata`(jsonb, `local_date` 키 포함) |
| `health_calendar_events` | `profile_id`, `title`, `starts_at`, `ends_at`, `source` |

## 데이터 흐름에서 지키는 규칙

옛날 값이 화면에 남는 사고를 구조적으로 막기 위한 규칙입니다. 고칠 때 이 전제를 깨지 마세요.

1. **metric 마다 독립적으로 최신 1건을 조회한다.**
   체중 기록 한 건을 통째로 읽어 거기 붙은 체지방/BMI/근육량을 같이 쓰면,
   그 측정 세션에 일부 metric 이 빠졌을 때 카드 전체가 과거 시점에 고정됩니다.
2. **정렬은 `measured_at`(측정 시각) 기준.** `created_at`(저장 시각)이 아닙니다.
   동기화가 몰아서 들어오면 저장 순서와 측정 순서가 뒤집힙니다.
3. **날짜 경계는 UTC timestamp 범위로 자르지 않는다.**
   `metadata->>local_date` 의 LA 날짜 문자열로 직접 매칭합니다.
   UTC 로 자르면 LA 오후 5시 이후 데이터가 "내일"로 넘어가 오늘 걸음수가 0 이 됩니다.
4. **데이터가 없으면 0 이 아니라 `null`.** "측정값 0" 과 "기록 없음" 은 다른 상태입니다.
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
| `npm test` | 실제 Chromium 에서 앱을 띄우고 화면에 찍힌 값을 검증 (17개) |
| `NOW=2026-09-18T03:00:00Z npm test` | LA 는 9/17 저녁, UTC 는 이미 9/18 인 시간대 경계 |
| `npm run test:setup` | 설정 화면 · service_role 키 차단 · 키 유지 (14개) |

Supabase REST 응답을 픽스처로 가로채되, 앱이 만든 쿼리 문자열을 실제로 해석해서
결과를 돌려줍니다 — **쿼리가 틀리면 틀린 값이 화면에 뜨고 테스트가 실패합니다.**

픽스처에는 옛날 행(9/15)과 최신 행(9/17)이 **둘 다** 들어있고,
`measured_at` 과 `created_at` 의 순서를 일부러 뒤집어 놨습니다.
저장시각으로 정렬하는 코드는 이 픽스처에서 반드시 실패합니다.

브라우저 시간대는 일부러 `Asia/Seoul` 로 두고 LA 기준 표시가 흔들리지 않는지 확인합니다.

## RENPHO 카드 클릭

검증되지 않은 커스텀 스킴으로 이동하면 iOS Safari 가
"Safari cannot open the page because the address is invalid" 를 띄웁니다.
그래서 기본값(`RENPHO_APP_SCHEME = null`)은 **스킴을 시도하지 않고** https 링크만 엽니다.

실기기에서 동작이 검증된 스킴이 생기면 `js/config.js` 의 `RENPHO_APP_SCHEME` 에 넣으세요.
값이 있을 때만 "숨김 iframe 으로 스킴 시도 → 실패 시 https 폴백" 경로가 켜집니다.
iframe 을 쓰는 이유는 실패해도 Safari 오류 페이지가 뜨지 않기 때문입니다.

## 배포

빌드 단계가 없으므로 저장소를 그대로 정적 호스팅에 연결하면 됩니다.
push 할 때마다 자동 배포되고, 그때부터 "코드 → 배포 → 아이폰 화면"이 한 줄로 이어집니다.

- **Vercel** — `vercel.json` 포함. import 할 때 프레임워크는 `Other`, 빌드 명령은 비워둡니다.
- **Netlify** — `netlify.toml` 포함. 추가 설정 없이 그대로 연결하면 됩니다.
- **Cloudflare Pages** — 빌드 명령 비움, 출력 디렉터리 `/`.

두 설정 파일 모두 `index.html` 과 `js/*` 에 `Cache-Control: no-store` 를 겁니다.
호스팅이 예전 파일을 계속 내려주면 코드를 고쳐 배포해도 아이폰에는 옛날 앱이 뜨는데,
이번에 고친 문제와 정확히 같은 종류의 사고입니다.

## 아이폰 홈 화면에 추가

`manifest.webmanifest` 와 `apple-touch-icon` 이 들어있어,
Safari 에서 공유 → **홈 화면에 추가** 하면 주소창 없는 앱처럼 실행됩니다.

## CI

`.github/workflows/test.yml` 이 push 마다 세 스위트를 모두 돌리고
검증 스크린샷을 아티팩트로 올립니다.
