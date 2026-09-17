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

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
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

const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await page.goto(`${base}/index.html`);
await page.waitForFunction(
  () => !document.getElementById('status').textContent.includes('불러오는 중'),
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
  hr: (await text('hr-value')).trim(),
  hrTime: (await text('hr-time')).trim(),
  steps: (await text('steps-value')).trim(),
  stepsNote: (await text('steps-note')).trim(),
  errors: await page.isHidden('#errors'),
};

const checks = [
  ['RENPHO 체중 = 78.3',            got.weight === '78.3'],
  ['RENPHO 체지방률 = 13.2',        got.fat === '13.2'],
  ['RENPHO BMI = 24.0',             got.bmi === '24.0'],
  ['RENPHO 근육량 = 67.96',         got.lean === '67.96'],
  ['RENPHO 측정시각 = 9/17 10:07 AM', got.synced.startsWith('9/17, 10:07 AM')],
  ['심박수 = 105',                  got.hr === '105'],
  ['심박수 시각 = 9/17 12:17 PM',   got.hrTime.startsWith('9/17, 12:17 PM')],
  ['걸음수 = 6,482 (오늘 최신 누적)', got.steps === '6,482'],
  ['걸음수가 "기록 없음" 이 아님',   !got.stepsNote.includes('집계 없음') && !got.stepsNote.includes('기록 없음')],
  ['걸음수가 0 이 아님',            got.steps !== '0'],
  ['걸음수 = 오늘 진행중 표시',      got.stepsNote.includes('오늘')],
  ['오류 배너 없음',                got.errors === true],
  ['JS 런타임 오류 없음',            consoleErrors.length === 0],
];

// 달력: LA 9/16(=UTC 9/17 14:00) 과 9/30 야간 일정이 제자리에 찍히는지
const evDays = await page.$$eval('.cal-cell.has-event .d', (els) => els.map((e) => e.textContent));
checks.push(['달력 일정 표시됨', evDays.length > 0]);
// 픽스처의 일정 3건은 LA 기준 9/17, 9/18, 9/30 에 찍혀야 한다.
// 9/30 건은 UTC 로는 10/1 이라, 월 경계를 UTC 로 자르면 사라진다.
checks.push([
  '달력 일정 = LA 기준 17/18/30 일',
  JSON.stringify(evDays.sort((a, b) => a - b)) === JSON.stringify(['17', '18', '30']),
]);

const todayCell = await page.$$eval('.cal-cell.today .d', (els) => els.map((e) => e.textContent));
checks.push(['달력 오늘 = 17일', todayCell.length === 1 && todayCell[0] === '17']);

await page.screenshot({
  path: process.env.SHOT || 'tests/screenshot-verified.png',
  fullPage: true,
});

console.log(`\n=== 기준 시각: ${NOW.toISOString()} (LA ${new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',dateStyle:'short',timeStyle:'short'}).format(NOW)}) ===`);
console.log('=== 화면에 실제로 찍힌 값 ===');
for (const [k, v] of Object.entries(got)) console.log(`  ${k.padEnd(11)}: ${v}`);
// --- RENPHO 카드 클릭: 항상 "열 수 있는" URL 로만 이동하는지 ---
// Safari 의 "address is invalid" 는 결국 파싱 불가능한 URL 로 이동할 때 난다.
let navigatedTo = null;
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (route.request().isNavigationRequest() && !u.startsWith(base)) {
    navigatedTo = u;
    return route.abort();
  }
  return route.continue();
});
await page.click('#renpho-card');
await page.waitForTimeout(600);

let navOk = false;
try { navOk = !!navigatedTo && !!new URL(navigatedTo) && navigatedTo.startsWith('https://'); } catch { navOk = false; }
checks.push([`RENPHO 클릭 → 유효한 https URL (${navigatedTo ?? '이동 없음'})`, navOk]);

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
