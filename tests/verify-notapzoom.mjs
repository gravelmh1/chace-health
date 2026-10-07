// 아이폰처럼 터치로 + 버튼을 빠르게 여러 번 누를 때:
//   - 누른 횟수만큼 그대로 올라가야 한다 (탭이 사라지면 안 된다)
//   - 빠른 연속 탭은 브라우저 기본 동작(두 번 탭 확대)이 막혀야 한다
//   - 입력칸은 막지 않는다
import { chromium, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROWS, CLOUD_ROWS } from './fixture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
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
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ko-KR' });
await ctx.route('**/rest/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ metrics: ROWS, calendar_events: [], days: CLOUD_ROWS }) }));
const page = await ctx.newPage();
await page.addInitScript(() => {
  // 데이터가 오래돼 보여도 단축어 앱으로 넘어가지 않게 (방금 실행한 것으로 둔다)
  try { localStorage.setItem('chace:shortcutRunAt', String(Date.now())); } catch {}
  window.__prevented = 0;
  // 앱의 처리(document)가 끝난 뒤에 본다 (window 는 버블링 마지막)
  window.addEventListener('touchend', (e) => { if (e.defaultPrevented) window.__prevented++; });
});
await page.goto(`${base}/index.html#key=sb_publishable_TESTKEY1234567890`);
await page.waitForFunction(() => document.getElementById('status').hidden, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(400);

const val = async (name) => Number((await page.locator('.ex-tile', { hasText: name }).locator('.ex-val').textContent()).replace(/\D/g, ''));
const tapPlus = async (name, times, gapMs) => {
  for (let i = 0; i < times; i++) {
    const btn = page.locator('.ex-tile', { hasText: name }).locator('.plus');
    await btn.scrollIntoViewIfNeeded();
    const b = await btn.boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(gapMs);
  }
};

const checks = [];
const before = await val('어깨');
await tapPlus('어깨', 5, 120);           // 빠르게 5번
await page.waitForTimeout(300);
const after = await val('어깨');
const prevented = await page.evaluate(() => window.__prevented);
checks.push([`빠르게 5번 → +50 (${before} → ${after})`, after - before === 50]);
checks.push([`빠른 연속 탭의 확대 동작을 막음 (${prevented}회)`, prevented >= 4]);

await page.evaluate(() => { window.__prevented = 0; });
const b2 = await val('삼두');
await tapPlus('삼두', 2, 700);           // 천천히 2번
const a2 = await val('삼두');
checks.push([`천천히 누르면 그대로 동작 (+20: ${b2} → ${a2})`, a2 - b2 === 20]);
checks.push(['천천히 누를 때는 막지 않음', (await page.evaluate(() => window.__prevented)) === 0]);

await page.locator('#evt-title').scrollIntoViewIfNeeded();
const box = await page.locator('#evt-title').boundingBox();
await page.evaluate(() => { window.__prevented = 0; });
await page.touchscreen.tap(box.x + 20, box.y + 10);
await page.waitForTimeout(100);
await page.touchscreen.tap(box.x + 30, box.y + 10);
checks.push(['입력칸 빠른 탭은 막지 않음', (await page.evaluate(() => window.__prevented)) === 0]);
checks.push(['viewport maximum-scale=1', (await page.getAttribute('meta[name=viewport]', 'content')).includes('maximum-scale=1')]);

console.log('\n=== 연속 탭 확대 방지 ===');
let failed = 0;
for (const [n, ok] of checks) { console.log(`  ${ok ? '✅' : '❌'} ${n}`); if (!ok) failed++; }
console.log(`\n${failed === 0 ? '전부 통과' : failed + '건 실패'}\n`);
await browser.close(); server.close();
process.exit(failed === 0 ? 0 : 1);
