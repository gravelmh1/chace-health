// 설정 화면 검증 — 키가 없을 때, service_role 키를 넣었을 때, 정상 키를 넣었을 때.
//
// 이 앱에서 가장 위험한 실수는 service_role 키를 브라우저에 넣는 것이다.
// (RLS 를 무시하는 전권 키라 유출되면 DB 전체가 열린다)
// 그래서 "저장이 실제로 거부되는지" 를 테스트로 고정해 둔다.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROWS, CAL_ROWS } from './fixture.js';
import { query } from './postgrest-mock.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) return void res.writeHead(404).end('nf');
  // config.js 의 키는 placeholder 그대로 둔다 → "키 미설정" 상태에서 시작
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file, 'utf8'));
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
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  timezoneId: 'America/Los_Angeles', locale: 'ko-KR',
});

const sentKeys = [];
await ctx.route('**/rest/v1/**', (route) => {
  const url = new URL(route.request().url());
  sentKeys.push(route.request().headers()['apikey']);
  const table = url.pathname.split('/').pop();
  route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(query(table === 'health_calendar_events' ? CAL_ROWS : ROWS, url.searchParams)),
  });
});

const page = await ctx.newPage();
await page.addInitScript(`{
  const FIXED = ${new Date('2026-09-17T19:30:00Z').getTime()};
  const RealDate = Date;
  class MockDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [FIXED])); }
    static now() { return FIXED; }
  }
  Date = MockDate;
}`);

const checks = [];
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

await page.goto(`${base}/index.html`);
await page.waitForTimeout(600);

// 1) 키가 없으면 설정 시트가 자동으로 뜬다
checks.push(['키 미설정 → 설정 시트 자동 표시', await page.isVisible('#setup')]);
checks.push(['키 미설정 → REST 호출 안 함', sentKeys.length === 0]);

// 2) service_role 키는 저장이 거부된다
await page.fill('#setup-key', `x.${b64url({ role: 'service_role' })}.y`);
await page.click('#setup-save');
await page.waitForTimeout(300);
const msg = (await page.textContent('#setup-msg')).trim();
checks.push([`service_role 키 저장 거부 ("${msg.slice(0, 40)}…")`, msg.includes('service_role')]);
checks.push([
  'service_role 키가 localStorage 에 저장되지 않음',
  await page.evaluate(() => !localStorage.getItem('chace:anonKey')),
]);
checks.push(['service_role 키로 REST 호출 안 함', sentKeys.length === 0]);

// 3) sb_secret_ 형식도 거부된다
await page.fill('#setup-key', 'sb_secret_abcdef123456');
await page.click('#setup-save');
await page.waitForTimeout(300);
checks.push([
  'sb_secret_ 키 저장 거부',
  (await page.textContent('#setup-msg')).includes('secret'),
]);

// 3-1) 새 형식 publishable 키(sb_publishable_...)도 받아들인다.
//      최근 Supabase 대시보드는 JWT 대신 이 형식을 준다.
await page.fill('#setup-key', 'sb_publishable_TESTKEY123456');
await page.click('#setup-save');
await page.waitForTimeout(700);
checks.push([
  'sb_publishable_ 키 저장 허용',
  await page.evaluate(() => localStorage.getItem('chace:anonKey') === 'sb_publishable_TESTKEY123456'),
]);
checks.push(['sb_publishable_ 키로 REST 호출함', sentKeys.includes('sb_publishable_TESTKEY123456')]);
await page.waitForTimeout(300);
checks.push([
  'sb_publishable_ 키로 데이터 표시',
  (await page.textContent('#renpho-weight')).trim() === '78.3',
]);

// 4) 정상 anon 키는 저장되고 데이터가 바로 뜬다
const anonKey = `x.${b64url({ role: 'anon' })}.y`;
await page.fill('#setup-key', anonKey);
await page.click('#setup-save');
await page.waitForTimeout(900);

checks.push(['anon 키 저장됨', await page.evaluate(() => !!localStorage.getItem('chace:anonKey'))]);
checks.push(['저장한 키로 REST 호출함', sentKeys.includes(anonKey)]);

const diag = await page.textContent('#setup-diag');
checks.push([`스키마 진단 = 컬럼 일치 확인`, diag.includes('일치')]);
checks.push(['스키마 진단 = local_date 확인', diag.includes('local_date')]);

await page.click('#setup-close');
await page.waitForTimeout(500);
checks.push(['설정 닫으면 최신 데이터 표시', (await page.textContent('#renpho-weight')).trim() === '78.3']);
checks.push(['걸음수도 표시', (await page.textContent('#steps-value')).trim() === '6,482']);

// 5) 새로고침해도 키가 유지된다 (재입력 필요 없음)
await page.reload();
await page.waitForTimeout(800);
checks.push(['새로고침 후 설정 시트 안 뜸', await page.isHidden('#setup')]);
checks.push(['새로고침 후 값 유지', (await page.textContent('#renpho-weight')).trim() === '78.3']);

await page.screenshot({ path: 'tests/screenshot-setup.png', fullPage: true });

console.log('\n=== 설정 화면 검증 ===');
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  if (!ok) failed++;
}
console.log(`\n${failed === 0 ? '전부 통과' : failed + '건 실패'}\n`);

await browser.close();
server.close();
process.exit(failed === 0 ? 0 : 1);
