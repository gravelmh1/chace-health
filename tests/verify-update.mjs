// 캐시된 옛 index.html 이 새 배포를 스스로 잡아내는지 검증한다.
//
// 재현하는 상황:
//   1. 사용자가 구버전(v=old) HTML 을 캐시로 들고 있다.
//   2. 서버에는 새 배포(v=new)가 올라가 있다 — version.json 이 new 를 가리킨다.
//   3. 페이지가 열리면 version.json 을 읽고 ?v=new 로 스스로 이동해야 한다.
//   4. 그 주소는 브라우저가 처음 보는 주소라 HTML 을 새로 받는다.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const OLD = 'oldbuild0001';
const NEW = 'newbuild0002';

// 서버가 내려주는 버전. 테스트 도중 바뀐다.
let serverVersion = OLD;
const htmlRequests = [];

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  if (urlPath === '/version.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return void res.end(JSON.stringify({ v: serverVersion }));
  }

  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) return void res.writeHead(404).end('nf');

  let body = fs.readFileSync(file, 'utf8');
  if (urlPath === '/index.html' || urlPath === '/') {
    htmlRequests.push(req.url);
    // 배포 파이프라인이 하는 치환을 흉내 낸다
    body = body.replace('window.__APP_VERSION__ = "dev"', `window.__APP_VERSION__ = "${serverVersion}"`);
  }
  if (urlPath === '/js/config.js') {
    body = body.replace('PASTE_YOUR_SUPABASE_ANON_KEY_HERE', 'test-anon-key');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
  res.end(body);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const CHROME = process.env.CHROME_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
      ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
// Supabase 호출은 막아 둔다 (이 테스트의 관심사가 아니다)
await ctx.route('**/rest/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

const checks = [];

// 1) 구버전으로 연다
await page.goto(`${base}/index.html`);
await page.waitForTimeout(800);
const loadedOld = await page.evaluate(() => window.__APP_VERSION__);
checks.push([`구버전으로 로드됨 (${loadedOld})`, loadedOld === OLD]);
checks.push(['같은 버전이면 재로드하지 않음', !page.url().includes('v=')]);

// 2) 서버에 새 배포가 올라간다
serverVersion = NEW;

// 3) 탭 복귀를 흉내 낸다 — 이때 새 버전을 잡아야 한다
htmlRequests.length = 0;
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.waitForTimeout(1500);

checks.push([`새 주소로 이동함 (${page.url().replace(base, '') || '이동 없음'})`, page.url().includes(`v=${NEW}`)]);
checks.push([`HTML 을 다시 받아옴 (${htmlRequests.length}회)`, htmlRequests.length > 0]);

const loadedNew = await page.evaluate(() => window.__APP_VERSION__);
checks.push([`새 버전이 실행 중 (${loadedNew})`, loadedNew === NEW]);

// 4) 같은 버전에서 무한 새로고침이 일어나지 않아야 한다
const urlAfter = page.url();
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.waitForTimeout(1200);
checks.push(['새 버전에서는 더 이상 재로드하지 않음 (무한루프 없음)', page.url() === urlAfter]);

checks.push(['JS 런타임 오류 없음', errs.length === 0]);

console.log('\n=== 자동 업데이트 검증 ===');
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
