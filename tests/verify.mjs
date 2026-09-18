// 실제 브라우저(Chromium)에서 앱을 띄우고, Supabase REST 응답을 픽스처로
// 가로채서 화면에 찍힌 값을 검증한다.
//
// 시스템 시각을 2026-09-17 12:30 PDT 로 고정한다 ("오늘"의 정의를 고정하기 위함).

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROWS, CAL_ROWS } from './fixture.js';
import { query } from './postgrest-mock.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 기본: 2026-09-17 12:30 PM PDT.
// NOW 를 바꿔 "LA 날짜와 UTC 날짜가 갈라지는 시각"도 검증한다.
//   NOW=2026-09-18T03:00:00Z  →  LA 는 아직 9/17 저녁 8시, UTC 는 이미 9/18.
//   이 구간에서 UTC 날짜로 조회하면 오늘 걸음수가 0/없음 으로 떨어진다.
const NOW = new Date(process.env.NOW || '2026-09-17T19:30:00Z');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

// --- 정적 서버 (config.js 의 anon key 만 테스트용으로 치환해서 서빙) ---
const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  let body = fs.readFileSync(file, 'utf8');
  if (urlPath === '/js/config.js') {
    body = body.replace('PASTE_YOUR_SUPABASE_ANON_KEY_HERE', 'test-anon-key');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
  res.end(body);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// 이 컨테이너에는 chromium 이 고정 경로에 있고, CI 에서는 playwright 가 직접 받는다.
const CHROME = process.env.CHROME_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
      ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
      : undefined);
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },       // iPhone 크기
  deviceScaleFactor: 2,
  timezoneId: 'Asia/Seoul',                    // ⬅ 일부러 한국 시간대. LA 기준 표시가
                                               //    브라우저 시간대에 흔들리지 않는지 확인.
  locale: 'ko-KR',
});

const requests = [];
await ctx.route('**/rest/v1/**', (route) => {
  const url = new URL(route.request().url());
  requests.push(url.pathname + url.search);
  const table = url.pathname.split('/').pop();
  const rows = table === 'health_calendar_events' ? CAL_ROWS : ROWS;
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(query(rows, url.searchParams)),
  });
});

const page = await ctx.newPage();
await page.addInitScript(`{
  const FIXED = ${NOW.getTime()};
  const RealDate = Date;
  class MockDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [FIXED])); }
    static now() { return FIXED; }
  }
  Date = MockDate;
}`);

// 운동/약 기록을 원본 화면과 같은 값으로 심는다.
// (localStorage 에 저장되는 사용자 입력값 — Supabase 데이터와는 무관)
const PROFILE = '6eb29763-315a-46b7-bcf7-da24b8f1503e';
const SEED = {
  '2026-09-10': { meds: { vitaminD: true },              ex: { pushup: 60,  triceps: 90, shoulder: 60 } },
  '2026-09-11': { meds: { vitaminD: true, duta: true },  ex: { pushup: 110, triceps: 90, shoulder: 60 } },
  '2026-09-12': { meds: { vitaminD: true },              ex: { pushup: 60 } },
  '2026-09-14': { meds: { vitaminD: true },              ex: { pushup: 60 } },
  '2026-09-15': { meds: { vitaminD: true, duta: true },  ex: { pushup: 110 } },
  '2026-09-16': { meds: { vitaminD: true },              ex: { pushup: 110 } },
  '2026-09-17': { meds: { vitaminD: true, duta: true },  ex: { pushup: 110 } },
};
await page.addInitScript(([profile, seed]) => {
  try { localStorage.setItem(`chace:log:${profile}`, JSON.stringify(seed)); } catch {}
}, [PROFILE, SEED]);

const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await page.goto(`${base}/index.html`);
await page.waitForFunction(
  () => {
    const el = document.getElementById('status');
    return el.hidden || !el.textContent.includes('불러오는 중');
  },
  { timeout: 15000 },
);
await page.waitForTimeout(400);

const text = (id) => page.textContent(`#${id}`);
const got = {
  weight: (await text('renpho-weight')).trim(),
  fat: (await text('renpho-fat')).trim(),
  bmi: (await text('renpho-bmi')).trim(),
  lean: (await text('renpho-lean')).trim(),
  synced: (await text('renpho-synced')).trim(),
  appleSynced: (await text('apple-synced')).trim(),
  hr: (await text('hr-value')).trim(),
  hrTime: (await text('hr-time')).trim(),
  steps: (await text('steps-value')).trim(),
  stepsNote: (await text('steps-note')).trim(),
  today: (await text('today-label')).trim(),
  errors: await page.isHidden('#errors'),
};

const checks = [
  ['RENPHO 체중 = 78.3',            got.weight === '78.3'],
  ['RENPHO 체지방률 = 13.2',        got.fat === '13.2'],
  ['RENPHO BMI = 24.0',             got.bmi === '24.0'],
  ['RENPHO 근육량 = 67.96',         got.lean === '67.96'],
  ['RENPHO 동기화 = 9. 17. 오전 10:07', got.synced === '9. 17. 오전 10:07 동기화'],
  ['심박수 = 105',                  got.hr === '105'],
  ['심박수 시각 = 9. 17. 오후 12:17 측정', got.hrTime === '9. 17. 오후 12:17 측정'],
  ['걸음수 = 6,482 (일일 집계 행 선택)', got.steps === '6,482'],
  ['걸음수가 더 최신 legacy snapshot(6,100)을 집지 않음', got.steps !== '6,100'],
  ['거리 = 1.1 mi (1770.3 m 환산)', got.stepsNote.startsWith('1.1 mi')],
  ['Apple 동기화 시각 표시',        /^\d+\. \d+\. (오전|오후) /.test(got.appleSynced)],
  ['상단 날짜 = 9월 17일 (목)',      got.today === '9월 17일 (목)'],
  ['걸음수가 "기록 없음" 이 아님',   !got.stepsNote.includes('기록 없음')],
  ['걸음수가 0 이 아님',            got.steps !== '0'],

  ['오류 배너 없음',                got.errors === true],
  ['정상 로드 시 상태줄 숨김',       await page.isHidden('#status')],
  ['JS 런타임 오류 없음',            consoleErrors.length === 0],
];

// 달력: LA 9/16(=UTC 9/17 14:00) 과 9/30 야간 일정이 제자리에 찍히는지
// 3주 달력: 9/6~9/26, 오늘 17일
const calDays = await page.$$eval('.cal-cell .d', (els) => els.map((e) => e.textContent));
checks.push(['달력 = 3주 21칸', calDays.length === 21]);
checks.push(['달력 범위 = 6일~26일', calDays[0] === '6' && calDays[20] === '26']);

const todayCell = await page.$$eval('.cal-cell.today .d', (els) => els.map((e) => e.textContent));
checks.push(['달력 오늘 = 17일', todayCell.length === 1 && todayCell[0] === '17']);

// 픽스처 일정: LA 기준 9/17(아침 러닝), 9/18(헬스장). 9/30 은 3주 범위 밖.
const evDays = await page.$$eval('.cal-cell:has(.dot.ev) .d', (els) => els.map((e) => e.textContent));
checks.push([
  `달력 일정 = LA 기준 17/18 일 (받은 값: ${evDays.join(',') || '없음'})`,
  JSON.stringify(evDays) === JSON.stringify(['17', '18']),
]);

// 두타는 이틀에 한 번 — 원본 화면과 같은 배치(7,9,11,...)인지
const dutaDays = await page.$$eval('.cal-cell:has(.tag.dt) .d', (els) => els.map((e) => Number(e.textContent)));
checks.push([
  `두타 = 격일 (${dutaDays.join(',')})`,
  dutaDays.length === 10 && dutaDays.every((d) => d % 2 === 1),
]);
const vdDays = await page.$$eval('.cal-cell:has(.tag.vd) .d', (els) => els.length);
checks.push(['비D = 매일 21칸', vdDays === 21]);

// 차트
const yTicks = await page.$$eval('.chart .ytick', (els) => els.map((e) => e.textContent));
checks.push([
  `차트 y눈금 = 0,28,55,83,110 (받은 값: ${yTicks.join(',')})`,
  JSON.stringify(yTicks) === JSON.stringify(['0', '28', '55', '83', '110']),
]);
const xTicks = await page.$$eval('.chart .xtick', (els) => els.map((e) => e.textContent));
checks.push([
  `차트 x라벨 = 9/4…9/17 (${xTicks.join(' ')})`,
  xTicks[0] === '9/4' && xTicks[xTicks.length - 1] === '9/17',
]);
const lgVals = await page.$$eval('.lg-item .lg-val', (els) => els.map((e) => e.textContent));
checks.push([`차트 범례 합계 = 620·0·180·120 (${lgVals.join(' ')})`, lgVals.join(',') === '620회,0회,180회,120회']);
const calCounts = await page.$$eval('.cal-cell .cnt', (els) => els.map((e) => e.textContent));
checks.push([
  `달력 운동 횟수 (${calCounts.join(' ')})`,
  calCounts.join(',') === '210회,260회,60회,60회,110회,110회,110회',
]);
const lgItems = await page.$$eval('.lg-item .lg-name', (els) => els.map((e) => e.textContent));
checks.push([
  '차트 범례 = 푸쉬업/덤벨/삼두/어깨',
  JSON.stringify(lgItems) === JSON.stringify(['푸쉬업', '덤벨', '삼두', '어깨']),
]);
const marks = await page.$$eval('.lg-mark', (els) => els.length);
checks.push(['범례 도형 마커 4개 (색약 대비 보조부호)', marks === 4]);

// 운동 타일
const tiles = await page.$$eval('.ex-tile .ex-name', (els) => els.map((e) => e.textContent));
checks.push([
  '기록하기 타일 = 푸쉬업/덤벨/삼두/어깨',
  JSON.stringify(tiles) === JSON.stringify(['푸쉬업', '덤벨', '삼두', '어깨']),
]);

await page.screenshot({
  path: process.env.SHOT || 'tests/screenshot-verified.png',
  fullPage: true,
});

console.log(`\n=== 기준 시각: ${NOW.toISOString()} (LA ${new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',dateStyle:'short',timeStyle:'short'}).format(NOW)}) ===`);
console.log('=== 화면에 실제로 찍힌 값 ===');
for (const [k, v] of Object.entries(got)) console.log(`  ${k.padEnd(11)}: ${v}`);
// --- RENPHO 카드 클릭 ---
// 의도: RENPHO 앱을 직접 연다. 앱이 없으면 https 로 폴백한다.
// 안전 조건: 커스텀 스킴은 숨김 iframe 으로만 던진다. 최상위 문서를
// renpho:// 로 이동시키면 iOS Safari 가 "address is invalid" 를 띄우기 때문이다.
let topNav = null;        // 최상위 프레임이 이동한 곳
let frameNav = [];        // 하위 프레임(iframe)이 이동한 곳
await page.route('**/*', (route) => {
  const req = route.request();
  const u = req.url();
  if (req.isNavigationRequest() && !u.startsWith(base)) {
    if (req.frame() === page.mainFrame()) topNav = u;
    else frameNav.push(u);
    return route.abort();
  }
  return route.continue();
});
await page.click('#renpho-card');
// 스킴 시도(1.2s) 후 폴백까지 기다린다
await page.waitForTimeout(2200);

let navOk = false;
try { navOk = !!topNav && !!new URL(topNav) && topNav.startsWith('https://'); } catch { navOk = false; }
checks.push([`RENPHO 클릭 → 최상위는 https 로만 (${topNav ?? '이동 없음'})`, navOk]);
checks.push([
  '최상위 문서가 커스텀 스킴으로 이동하지 않음 (Safari 오류 방지)',
  !topNav || !/^[a-z][a-z0-9+.-]*:/i.test(topNav) || topNav.startsWith('http'),
]);

console.log('\n=== 앱이 보낸 쿼리 ===');
for (const r of requests) console.log('  ' + decodeURIComponent(r));
console.log('\n=== 검증 ===');
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  if (!ok) failed++;
}
if (consoleErrors.length) console.log('\nJS 오류:', consoleErrors);
console.log(`\n${failed === 0 ? '전부 통과' : failed + '건 실패'}\n`);

await browser.close();
server.close();
process.exit(failed === 0 ? 0 : 1);
