// 새 형식 키(sb_publishable_...)를 Bearer 로도 보내면 서버가 거부하는 상황을 재현한다.
//
// 실제로 겪은 문제: 키는 정확한데 모든 요청이 401 이었다.
// PostgREST 가 Authorization 을 JWT 로 파싱하려다 실패했기 때문이다.
// apikey 만 보내면 통과한다.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROWS, CAL_ROWS, CLOUD_ROWS } from './fixture.js';
import { query } from './postgrest-mock.js';

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

let bearerSeen = 0;
let ok = 0;
await ctx.route('**/rest/v1/**', (route) => {
  const h = route.request().headers();
  const url = new URL(route.request().url());

  // 새 형식 키를 Bearer 로 보내면 서버가 거부한다 (실제 동작 재현)
  if (h.authorization) {
    bearerSeen++;
    return route.fulfill({ status: 401, contentType: 'application/json',
      body: JSON.stringify({ message: 'Invalid JWT' }) });
  }
  if (h.apikey !== KEY) {
    return route.fulfill({ status: 401, contentType: 'application/json',
      body: JSON.stringify({ message: 'Invalid API key' }) });
  }

  ok++;
  if (url.pathname.endsWith('/rest/v1/')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  }
  const table = url.pathname.split('/').pop();
  const rows = table === 'health_calendar_events' ? CAL_ROWS
    : table === 'health_cloud_days' ? CLOUD_ROWS : ROWS;
  route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(query(rows, url.searchParams)) });
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
  ['publishable 키를 Bearer 로 보내지 않음', bearerSeen === 0],
  ['apikey 만으로 통과함', ok > 0],
  ['데이터가 뜸', (await page.textContent('#renpho-weight')).trim() === '78.3'],
  ['오류 배너 없음', await page.isHidden('#errors')],
  ['불필요한 키 교정을 돌리지 않음 (요청 폭주 없음)', ok < 40],
  ['JS 런타임 오류 없음', errs.length === 0],
];

console.log('\n=== 인증 헤더 검증 ===');
console.log(`  Bearer 로 보낸 요청 ${bearerSeen}회 · 통과한 요청 ${ok}회\n`);
let failed = 0;
for (const [name, okk] of checks) {
  console.log(`  ${okk ? '✅' : '❌'} ${name}`);
  if (!okk) failed++;
}
if (errs.length) console.log('\nJS 오류:', errs);
console.log(`\n${failed === 0 ? '전부 통과' : failed + '건 실패'}\n`);

await browser.close();
server.close();
process.exit(failed === 0 ? 0 : 1);
