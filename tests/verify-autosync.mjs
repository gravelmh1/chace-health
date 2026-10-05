// 앱을 열 때 아이폰 단축어를 실행하는지 검증.
//   - 아이폰 + 데이터가 오래됨 → shortcuts://run-shortcut?name=Chace 동기화 실행
//   - 아이폰 + 데이터가 최신  → 실행 안 함
//   - 30분 안에 다시 열면    → 실행 안 함 (실패해도 계속 튕기지 않게)
//   - 컴퓨터                 → 실행 안 함
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const KEY = 'sb_publishable_TESTKEY1234567890';
const P = '6eb29763-315a-46b7-bcf7-da24b8f1503e';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

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

const rows = (syncedIso) => [{
  profile_id: P, source: 'Apple Health', metric: 'stepCount', value: 3000, unit: 'count',
  recorded_at: '2026-10-04T07:00:00+00:00', updated_at: syncedIso,
  metadata: { local_date: '2026-10-04', aggregation: 'daily_sum', complete_day: false },
}];

const NOW = '2026-10-05T06:47:00Z'; // LA 10/4 23:47
async function run({ ua, synced, reopenAfterMs = null }) {
  const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  await ctx.route('**/rest/v1/**', (route) => {
    if (new URL(route.request().url()).pathname.includes('/rpc/chace_health_pull')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ metrics: rows(synced), calendar_events: [], days: [] }) });
    }
    route.fulfill({ status: 404, contentType: 'application/json', body: '{"code":"PGRST202"}' });
  });
  const page = await ctx.newPage();
  await page.addInitScript(`{
    const F = ${new Date(NOW).getTime()} + Number(sessionStorage.getItem('shift') || 0);
    const R = Date;
    class M extends R { constructor(...a){ super(...(a.length?a:[F])); } static now(){ return F; } }
    Date = M;
    window.__opened = [];
    document.addEventListener('chace:open-app', (e) => window.__opened.push(e.detail.scheme));
  }`);
  const load = async (again = false) => {
    if (again) await page.reload();
    else await page.goto(`${base}/index.html#key=${encodeURIComponent(KEY)}`);
    await page.waitForFunction(() => document.getElementById('status').hidden, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(300);
    return page.evaluate(() => window.__opened);
  };
  const first = await load();
  let second = null;
  if (reopenAfterMs !== null) {
    await page.evaluate((ms) => sessionStorage.setItem('shift', String(ms)), reopenAfterMs);
    second = await load(true);
  }
  await ctx.close();
  return { first, second };
}

const SC = 'shortcuts://run-shortcut?name=Chace%20%EB%8F%99%EA%B8%B0%ED%99%94';
const checks = [];
const stale = await run({ ua: IPHONE, synced: '2026-10-02T15:16:00Z', reopenAfterMs: 5 * 60 * 1000 });
checks.push([`아이폰 + 2일 묵은 데이터 → 단축어 실행 (${stale.first.join(' ')})`, stale.first.length === 1 && stale.first[0] === SC]);
checks.push([`5분 뒤 다시 열어도 또 실행 안 함 (${stale.second.length}회)`, stale.second.length === 0]);
const later = await run({ ua: IPHONE, synced: '2026-10-02T15:16:00Z', reopenAfterMs: 31 * 60 * 1000 });
checks.push([`31분 뒤에는 다시 시도 (${later.second.length}회)`, later.second.length === 1]);
const fresh = await run({ ua: IPHONE, synced: '2026-10-05T06:00:00Z' });
checks.push([`아이폰 + 47분 전 동기화 → 실행 안 함 (${fresh.first.length}회)`, fresh.first.length === 0]);
const desktop = await run({ ua: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120', synced: '2026-10-02T15:16:00Z' });
checks.push([`컴퓨터 → 실행 안 함 (${desktop.first.length}회)`, desktop.first.length === 0]);

console.log('\n=== 앱 열 때 단축어 자동 실행 ===');
let failed = 0;
for (const [name, ok] of checks) { console.log(`  ${ok ? '✅' : '❌'} ${name}`); if (!ok) failed++; }
console.log(`\n${failed === 0 ? '전부 통과' : failed + '건 실패'}\n`);
await browser.close(); server.close();
process.exit(failed === 0 ? 0 : 1);
