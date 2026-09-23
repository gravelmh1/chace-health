// 단축어 → Supabase → 앱 화면까지 끝에서 끝으로 확인한다.
//
// tests/pulled-sample.json 은 로컬 Postgres 에서 실제로 만든 것이다:
//   1) 어제까지의 오래된 값(체중 77.8, 부분 걸음 191)이 들어 있는 상태에서
//   2) anon 으로 chace_health_push() 를 불러 오늘 값을 넣고
//   3) anon 으로 chace_health_pull() 을 불러 나온 JSON 을 그대로 저장했다.
// 그 JSON 을 RPC 응답으로 돌려주고, 화면이 단축어가 넣은 값을 보여 주는지 본다.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const PULLED = fs.readFileSync(path.join(ROOT, 'tests/pulled-sample.json'), 'utf8');
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
    return route.fulfill({ status: 200, contentType: 'application/json', body: PULLED });
  }
  route.fulfill({ status: 404, contentType: 'application/json',
    body: JSON.stringify({ code: 'PGRST202', message: 'function not found' }) });
});

const page = await ctx.newPage();
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
  () => document.getElementById('renpho-weight').textContent.trim() !== '—',
  { timeout: 30000 },
).catch(() => {});
await page.waitForTimeout(600);

const t = (id) => page.textContent(`#${id}`).then((x) => x.trim());
const got = {
  weight: await t('renpho-weight'), fat: await t('renpho-fat'), bmi: await t('renpho-bmi'),
  lean: await t('renpho-lean'), renphoSync: await t('renpho-synced'),
  steps: await t('steps-value'), stepsNote: await t('steps-note'),
  hr: await t('hr-value'), hrTime: await t('hr-time'),
};

const checks = [
  [`체중 = 78.2 (RENPHO 앱 78.20) — 받은 값 ${got.weight}`, got.weight === '78.2'],
  [`체지방 = 13.2 (단축어가 0.132 로 보내도) — ${got.fat}`, got.fat === '13.2'],
  [`BMI = 24.0 — ${got.bmi}`, got.bmi === '24.0'],
  [`제지방 = 67.9 — ${got.lean}`, got.lean === '67.9'],
  [`RENPHO 측정 시각 = 9. 22. 오후 11:45 — ${got.renphoSync}`, got.renphoSync.startsWith('9. 22. 오후 11:45')],
  [`걸음 = 3,269 (Apple 건강 값) — ${got.steps}`, got.steps === '3,269'],
  ['예전 부분 기록 191 이 아님', got.steps !== '191'],
  [`오늘 값으로 표시 — ${got.stepsNote}`, !got.stepsNote.includes('마지막 기록')],
  [`심박수 = 108 — ${got.hr}`, got.hr === '108'],
  [`심박수 시각 = 9. 21. 오후 5:51 — ${got.hrTime}`, got.hrTime.startsWith('9. 21. 오후 5:51')],
  ['오류 배너 없음', await page.isHidden('#errors')],
  ['JS 런타임 오류 없음', errs.length === 0],
];

console.log('\n=== 단축어 → DB → 앱 끝에서 끝 검증 ===');
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
