// RLS 로 테이블 직접 조회가 막힌 환경을 재현한다.
//
//   - /rest/v1/health_*        → 401 (RLS 가 anon 읽기를 막는 상태)
//   - /rest/v1/rpc/health_sync_pull → 정상 응답
//
// 이 상태에서도 화면에 같은 값이 떠야 한다.
// 테이블 경로와 RPC 경로가 같은 규칙(최신 1건, 일일 집계 우선)으로 고른다는 확인이다.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROWS, CAL_ROWS, CLOUD_ROWS } from './fixture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const NOW = new Date('2026-09-17T19:30:00Z');

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) return void res.writeHead(404).end('nf');
  let body = fs.readFileSync(file, 'utf8');
  if (urlPath === '/js/config.js') body = body.replace('PASTE_YOUR_SUPABASE_ANON_KEY_HERE', 'sb_publishable_TESTKEY123456');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
  res.end(body);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const CHROME = process.env.CHROME_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
      ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  timezoneId: 'Asia/Seoul', locale: 'ko-KR',
});

let rpcCalls = 0;
let tableCalls = 0;
await ctx.route('**/rest/v1/**', (route) => {
  const url = new URL(route.request().url());

  // 새 이름만 응답하고, 옛 이름은 404 — 후보 순회가 동작하는지 함께 본다
  if (url.pathname.includes('/rpc/health_sync_pull')) {
    return route.fulfill({ status: 404, contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST202', message: 'function not found' }) });
  }
  if (url.pathname.includes('/rpc/chace_health_pull')) {
    rpcCalls++;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ metrics: ROWS, calendar_events: CAL_ROWS, days: CLOUD_ROWS }),
    });
  }

  // 테이블 직접 조회는 RLS 로 막혀 있다
  tableCalls++;
  return route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'permission denied', code: '42501' }),
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

await page.goto(`${base}/index.html`);
await page.waitForFunction(() => {
  const el = document.getElementById('status');
  return el.hidden || !el.textContent.includes('불러오는 중');
}, { timeout: 15000 });
await page.waitForTimeout(600);

const text = (id) => page.textContent(`#${id}`).then((t) => t.trim());
const got = {
  weight: await text('renpho-weight'),
  fat: await text('renpho-fat'),
  bmi: await text('renpho-bmi'),
  lean: await text('renpho-lean'),
  synced: await text('renpho-synced'),
  hr: await text('hr-value'),
  hrTime: await text('hr-time'),
  steps: await text('steps-value'),
  stepsNote: await text('steps-note'),
};

const evDays = await page.$$eval('.cal-cell:has(.dot.ev) .d', (els) => els.map((e) => e.textContent));
const calCounts = await page.$$eval('.cal-cell .cnt',
  (els) => els.map((e) => e.textContent.trim()).filter(Boolean));
const lgVals = await page.$$eval('.lg-item .lg-val', (els) => els.map((e) => e.textContent));

const checks = [
  ['RPC 를 호출함', rpcCalls > 0],
  ['테이블이 막혀도 화면이 뜸 (오류 배너 없음)', await page.isHidden('#errors')],
  ['RENPHO 체중 = 78.3', got.weight === '78.3'],
  ['RENPHO 체지방 = 13.2', got.fat === '13.2'],
  ['RENPHO BMI = 24.0', got.bmi === '24.0'],
  ['RENPHO 제지방 = 67.96', got.lean === '67.96'],
  ['RENPHO 동기화 = 9. 17. 오전 10:07', got.synced === '9. 17. 오전 10:07 동기화'],
  ['심박수 = 105', got.hr === '105'],
  ['심박수 시각 = 9. 17. 오후 12:17 측정', got.hrTime === '9. 17. 오후 12:17 측정'],
  ['걸음수 = 6,482 (일일 집계 우선)', got.steps === '6,482'],
  ['걸음수가 legacy snapshot(6,100)이 아님', got.steps !== '6,100'],
  ['거리 = 1.1 mi', got.stepsNote.startsWith('1.1 mi')],
  [`달력 일정 = 17/18 (${evDays.join(',') || '없음'})`, JSON.stringify(evDays) === JSON.stringify(['17', '18'])],
  [`약·운동 기록도 RPC 에서 (${calCounts.join(' ') || '없음'})`,
   calCounts.join(',') === '210회,260회,60회,60회,110회,110회,110회'],
  [`차트 범례 = 620·0·180·120 (${lgVals.join(' ')})`,
   lgVals.join(',') === '620회,0회,180회,120회'],
  ['JS 런타임 오류 없음', consoleErrors.length === 0],
];

await page.screenshot({ path: 'tests/screenshot-rpc.png', fullPage: true });

console.log('\n=== RLS 차단 + RPC 경로 검증 ===');
console.log(`  RPC 호출 ${rpcCalls}회 · 테이블 조회 ${tableCalls}회(전부 401)\n`);
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
