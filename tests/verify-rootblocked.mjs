// PostgREST 루트(/rest/v1/)가 anon 에게 막혀 있는 프로젝트를 재현한다.
//
// 실제로 겪은 문제: 메일로 복사해 붙여넣은 정확한 키인데도 "키가 거부되었습니다" 가
// 떴다. 키 유효성을 루트 주소로 확인하고 있었는데, 그 주소가 anon 에게 열려 있지
// 않아 키와 무관하게 401 이 났기 때문이다. 그 하나 때문에 모든 검사가 막혔다.
//
// 이 서버는 루트만 401 이고, 앱이 실제로 쓰는 RPC 와 테이블은 정상 응답한다.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROWS, CAL_ROWS, CLOUD_ROWS } from './fixture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const KEY = 'sb_publishable_T1fHc-nZldodEG1Vqi_ErQ_LLgX0_sA';

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) return void res.writeHead(404).end('nf');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file, 'utf8'));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const CHROME = process.env.CHROME_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
      ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });

let rootHits = 0;
let totalRequests = 0;
await ctx.route('**/rest/v1/**', (route) => {
  const url = new URL(route.request().url());
  totalRequests++;

  // 루트는 anon 에게 막혀 있다 — 키가 맞아도 401
  if (/\/rest\/v1\/?$/.test(url.pathname)) {
    rootHits++;
    return route.fulfill({ status: 401, contentType: 'application/json',
      body: JSON.stringify({ message: 'Invalid authentication credentials' }) });
  }
  if (route.request().headers()['apikey'] !== KEY) {
    return route.fulfill({ status: 401, contentType: 'application/json',
      body: JSON.stringify({ message: 'Invalid API key' }) });
  }
  // 앱이 실제로 쓰는 통로는 정상
  if (url.pathname.includes('/rpc/chace_health_pull')) {
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ metrics: ROWS, calendar_events: CAL_ROWS, days: CLOUD_ROWS }) });
  }
  route.fulfill({ status: 404, contentType: 'application/json',
    body: JSON.stringify({ code: 'PGRST202', message: 'function not found' }) });
});

const page = await ctx.newPage();
await page.addInitScript(`{
  const F = ${new Date('2026-09-17T19:30:00Z').getTime()};
  const R = Date;
  class M extends R { constructor(...a){ super(...(a.length?a:[F])); } static now(){ return F; } }
  Date = M;
}`);
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

await page.goto(`${base}/index.html#key=${encodeURIComponent(KEY)}`);
await page.waitForFunction(
  () => document.getElementById('renpho-weight').textContent.trim() !== '—',
  { timeout: 30000 },
).catch(() => {});
await page.waitForTimeout(600);

const checks = [
  ['루트가 막혀 있어도 데이터가 뜸', (await page.textContent('#renpho-weight')).trim() === '78.3'],
  ['심박수도 뜸', (await page.textContent('#hr-value')).trim() === '105'],
  ['오류 배너 없음', await page.isHidden('#errors')],
  [`쓸데없는 키 교정을 돌리지 않음 (요청 ${totalRequests}회)`, totalRequests < 40],
  ['JS 런타임 오류 없음', errs.length === 0],
];

// 진단도 키를 정상으로 봐야 한다
await page.evaluate(() => document.getElementById('setup-btn').click());
await page.waitForTimeout(300);
await page.click('#setup-diagnose');
await page.waitForFunction(
  () => !document.getElementById('setup-diag').textContent.includes('확인 중'),
  { timeout: 30000 },
);
const diag = await page.textContent('#setup-diag');
checks.push(['진단이 키를 정상으로 판정', diag.includes('키는 정상입니다')]);
checks.push(['진단이 나머지 항목도 검사함', diag.includes('chace_health_pull()')]);

console.log('\n=== 루트 차단 프로젝트 검증 ===');
console.log(`  루트 요청 ${rootHits}회 (전부 401) · 총 요청 ${totalRequests}회\n`);
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  if (!ok) failed++;
}
if (errs.length) console.log('\nJS 오류:', errs);
console.log(`\n${failed === 0 ? '전부 통과' : failed + '건 실패'}\n`);

await browser.close();
server.close();
process.exit(failed === 0 ? 0 : 1);
