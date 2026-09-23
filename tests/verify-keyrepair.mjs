// 눈으로 옮기다 틀린 키를 앱이 스스로 바로잡는지 검증한다.
//
// 재현: 사용자가 l 을 I 로, 0 을 O 로 잘못 읽어 넣었다.
//       Supabase 는 정확히 하나의 키에만 200 을 준다.
//       앱은 헷갈리는 자리를 바꿔 가며 맞는 키를 찾아내야 한다.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROWS, CAL_ROWS, CLOUD_ROWS } from './fixture.js';
import { query } from './postgrest-mock.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const REAL  = 'sb_publishable_T1fHc-nZldodEG1Vqi_ErQ_LLgX0_sA'; // 진짜 (l, 0)
const TYPED = 'sb_publishable_T1fHc-nZIdodEG1Vqi_ErQ_LLgXO_sA'; // 잘못 읽음 (I, O)

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

let attempts = 0;
await ctx.route('**/rest/v1/**', (route) => {
  const key = route.request().headers()['apikey'];
  const url = new URL(route.request().url());
  attempts++;

  // 진짜 키가 아니면 무엇이든 401
  if (key !== REAL) {
    return route.fulfill({ status: 401, contentType: 'application/json',
      body: JSON.stringify({ message: 'Invalid API key' }) });
  }
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

await page.goto(`${base}/index.html`);
await page.waitForTimeout(700);

// 잘못 읽은 키를 넣고 저장
await page.fill('#setup-key', TYPED);
await page.click('#setup-save');
await page.waitForFunction(
  () => /찾았습니다|맞는 것이 없습니다|없습니다\./.test(document.getElementById('setup-msg').textContent),
  { timeout: 60000 },
);
await page.waitForTimeout(600);

const msg = (await page.textContent('#setup-msg')).trim();
const stored = await page.evaluate(() => localStorage.getItem('chace:anonKey'));

const checks = [
  [`잘못된 키를 스스로 교정함 ("${msg.slice(0, 30)}…")`, msg.includes('찾았습니다')],
  ['교정된 키가 저장됨', stored === REAL],
  ['입력칸도 교정된 키로 갱신됨', (await page.inputValue('#setup-key')) === REAL],
  [`시도 횟수가 한도 안 (${attempts}회)`, attempts > 1 && attempts < 400],
  ['JS 런타임 오류 없음', errs.length === 0],
];

await page.click('#setup-close');
await page.waitForTimeout(700);
checks.push(['교정 후 데이터가 뜸', (await page.textContent('#renpho-weight')).trim() === '78.3']);

console.log('\n=== 키 자동 교정 검증 ===');
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
