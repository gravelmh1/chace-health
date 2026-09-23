// 오늘 데이터가 아직 안 들어온 날을 재현한다.
//
// 실제로 겪은 문제: 어제 걸음이 3,269 인데 앱은 191 을 보여줬다.
// 오늘이 없어 지난 날로 물러날 때 마지막 "행" 을 집었기 때문이다.
// 그 행은 하루의 일부만 담은 snapshot 이었다.
// 마지막 "날의 합계" 를 집어야 한다.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NO_TODAY_ROWS, CLOUD_ROWS } from './fixture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const KEY = 'sb_publishable_TESTKEY1234567890';

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

await ctx.route('**/rest/v1/**', (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.includes('/rpc/chace_health_pull')) {
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ metrics: NO_TODAY_ROWS, calendar_events: [], days: CLOUD_ROWS }) });
  }
  route.fulfill({ status: 404, contentType: 'application/json',
    body: JSON.stringify({ code: 'PGRST202', message: 'function not found' }) });
});

const page = await ctx.newPage();
// 오늘은 2026-09-23 12:44 PDT
await page.addInitScript(`{
  const F = ${new Date('2026-09-23T19:44:00Z').getTime()};
  const R = Date;
  class M extends R { constructor(...a){ super(...(a.length?a:[F])); } static now(){ return F; } }
  Date = M;
}`);
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

await page.goto(`${base}/index.html#key=${encodeURIComponent(KEY)}`);
await page.waitForFunction(
  () => document.getElementById('steps-value').textContent.trim() !== '—',
  { timeout: 30000 },
).catch(() => {});
await page.waitForTimeout(600);

const steps = (await page.textContent('#steps-value')).trim();
const note = (await page.textContent('#steps-note')).trim();
const hr = (await page.textContent('#hr-value')).trim();
const hrTime = (await page.textContent('#hr-time')).trim();
const weight = (await page.textContent('#renpho-weight')).trim();

const checks = [
  [`걸음수 = 3,269 (어제 합계) — 받은 값 ${steps}`, steps === '3,269'],
  ['부분 기록 191 을 집지 않음', steps !== '191'],
  [`마지막 기록일을 밝힘 (${note})`, note.includes('2026-09-22')],
  [`심박수 = 108 (${hrTime})`, hr === '108' && hrTime.startsWith('9. 21. 오후 5:51')],
  [`RENPHO 체중 = 77.8 (${weight})`, weight === '77.8'],
  ['JS 런타임 오류 없음', errs.length === 0],
];

console.log('\n=== 오늘 데이터가 없는 날 검증 ===');
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
