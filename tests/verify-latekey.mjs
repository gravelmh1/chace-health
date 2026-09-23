// 키 없이 앱을 먼저 연 뒤, 나중에 키를 넣는 순서를 재현한다.
//
// 실제로 겪은 문제: 키 없이 열렸을 때 RPC 시도가 실패했고, 그 실패를
// "이 프로젝트는 RPC 를 못 쓴다" 는 판정으로 못박았다. 그래서 키를 제대로
// 넣은 뒤에도 계속 테이블로만 조회했고, RLS 에 막혀 "권한이 없습니다" 가 떴다.
//
// 이 서버는 RPC 만 열려 있고 테이블은 전부 막혀 있다 — 실제 환경과 같다.

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
  res.end(fs.readFileSync(file, 'utf8')); // 키는 비어 있는 상태로 시작
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const CHROME = process.env.CHROME_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
      ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });

let rpcOk = 0;
let tableBlocked = 0;
await ctx.route('**/rest/v1/**', (route) => {
  const url = new URL(route.request().url());
  const key = route.request().headers()['apikey'];

  if (key !== KEY) {
    return route.fulfill({ status: 401, contentType: 'application/json',
      body: JSON.stringify({ message: 'Invalid API key' }) });
  }
  if (url.pathname.includes('/rpc/chace_health_pull')) {
    rpcOk++;
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ metrics: ROWS, calendar_events: CAL_ROWS, days: CLOUD_ROWS }) });
  }
  if (url.pathname.includes('/rpc/')) {
    return route.fulfill({ status: 404, contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST202', message: 'function not found' }) });
  }
  // 테이블은 RLS 로 전부 막혀 있다
  tableBlocked++;
  return route.fulfill({ status: 401, contentType: 'application/json',
    body: JSON.stringify({ code: '42501', message: 'permission denied for table' }) });
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

const checks = [];

// 1) 키 없이 먼저 연다 — 설정 시트가 뜨고, RPC 시도가 실패한다
await page.goto(`${base}/index.html`);
await page.waitForTimeout(900);
checks.push(['키 없이 열면 설정이 뜸', await page.isVisible('#setup')]);

// 2) 이제 키를 넣는다
await page.fill('#setup-key', KEY);
await page.click('#setup-save');
await page.waitForTimeout(1500);
await page.click('#setup-close');
await page.waitForTimeout(1200);

checks.push([`키 입력 후 RPC 를 씀 (RPC ${rpcOk}회)`, rpcOk > 0]);
checks.push(['RENPHO 값이 뜸', (await page.textContent('#renpho-weight')).trim() === '78.3']);
checks.push(['심박수가 뜸', (await page.textContent('#hr-value')).trim() === '105']);
checks.push(['걸음수가 뜸', (await page.textContent('#steps-value')).trim() === '6,482']);
checks.push(['오류 배너 없음', await page.isHidden('#errors')]);

const calCounts = await page.$$eval('.cal-cell .cnt',
  (els) => els.map((e) => e.textContent.trim()).filter(Boolean));
checks.push([`달력 기록도 뜸 (${calCounts.join(' ') || '없음'})`, calCounts.length > 0]);
checks.push(['JS 런타임 오류 없음', errs.length === 0]);

console.log('\n=== 키를 나중에 넣는 순서 검증 ===');
console.log(`  RPC 성공 ${rpcOk}회 · 테이블 차단 ${tableBlocked}회\n`);
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
