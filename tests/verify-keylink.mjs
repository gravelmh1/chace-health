// 링크(#key=...)로 키가 들어가는지, 그리고 주소에서 곧바로 지워지는지 검증한다.
//
// 아이폰에서 복사가 막히는 경우가 있어 만든 경로다. 키가 주소에 남으면
// 화면과 방문 기록에 노출되므로, 저장 즉시 지우는 것이 이 기능의 핵심이다.

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
  res.end(fs.readFileSync(file, 'utf8')); // config 의 키는 placeholder 그대로 둔다
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const CHROME = process.env.CHROME_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
      ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });

const sentKeys = [];
await ctx.route('**/rest/v1/**', (route) => {
  const url = new URL(route.request().url());
  sentKeys.push(route.request().headers()['apikey']);
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

const checks = [];

// 링크로 열기
await page.goto(`${base}/index.html#key=${encodeURIComponent(KEY)}`);
await page.waitForTimeout(1200);

checks.push(['링크의 키가 저장됨',
  await page.evaluate(() => localStorage.getItem('chace:anonKey')) === KEY]);
checks.push([`주소에서 키가 지워짐 (${page.url().replace(base, '')})`,
  !page.url().includes('key=')]);
checks.push(['저장된 키로 요청함', sentKeys.includes(KEY)]);
checks.push(['데이터가 바로 뜸', (await page.textContent('#renpho-weight')).trim() === '78.3']);
checks.push(['설정 시트가 뜨지 않음 (키가 있으므로)', await page.isHidden('#setup')]);

// 새로고침해도 유지되고, 주소에 키가 다시 생기지 않는다
await page.reload();
await page.waitForTimeout(900);
checks.push(['새로고침 후 유지', (await page.textContent('#renpho-weight')).trim() === '78.3']);
checks.push(['새로고침 주소에도 키 없음', !page.url().includes('key=')]);

// 앱을 이미 열어 둔 상태에서 링크를 눌러도 받아야 한다.
// 해시만 바뀌는 이동은 스크립트를 다시 실행하지 않으므로 별도 처리가 필요하다.
await page.evaluate(() => localStorage.clear());
await page.evaluate((k) => { window.location.hash = `key=${encodeURIComponent(k)}`; }, KEY);
await page.waitForTimeout(900);
checks.push(['앱이 열린 상태에서 링크를 눌러도 저장됨',
  await page.evaluate(() => localStorage.getItem('chace:anonKey')) === KEY]);
checks.push(['그때도 주소에서 키가 지워짐', !page.url().includes('key=')]);

// 링크로 secret 키를 보내면 저장하지 않는다
await page.evaluate(() => localStorage.clear());
await page.goto(`${base}/index.html`);
await page.waitForTimeout(300);
await page.evaluate(() => { window.location.hash = 'key=sb_secret_DANGEROUS123456'; });
await page.waitForTimeout(900);
checks.push(['링크로 온 secret 키는 저장 거부',
  await page.evaluate(() => !localStorage.getItem('chace:anonKey'))]);
checks.push(['거부된 경우에도 주소에서 지워짐', !page.url().includes('key=')]);

checks.push(['JS 런타임 오류 없음', errs.length === 0]);

console.log('\n=== 링크로 키 넣기 검증 ===');
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
