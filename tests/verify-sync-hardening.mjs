// 동기화 안정화 검증.
//
// hardening-pull.json 은 로컬 Postgres 에서 supabase/sync_hardening.sql 트리거를 설치한 뒤,
// ChatGPT 동기화처럼 최근 3일(9/22~9/24)을 두 번 다시 읽어 upsert 하고(체중은 lb 로),
// 단축어 push 도 한 번 돌린 결과를 chace_health_pull() 로 뽑은 그대로다.
// 9/22 에는 트리거 설치 전의 legacy 합계 행(120, 191)이 남아 있다.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PULL = JSON.parse(fs.readFileSync(path.join(HERE, 'hardening-pull.json'), 'utf8'));
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

async function open(metrics, nowIso, { reload = false, shot = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  await ctx.route('**/rest/v1/**', (route) => {
    if (new URL(route.request().url()).pathname.includes('/rpc/chace_health_pull')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ metrics, calendar_events: [], days: [] }) });
    }
    route.fulfill({ status: 404, contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST202', message: 'function not found' }) });
  });
  const page = await ctx.newPage();
  await page.addInitScript(`{
    const F = ${new Date(nowIso).getTime()};
    const R = Date;
    class M extends R { constructor(...a){ super(...(a.length?a:[F])); } static now(){ return F; } }
    Date = M;
  }`);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${base}/index.html#key=${encodeURIComponent(KEY)}`);
  const ready = () => page.waitForFunction(
    () => document.getElementById('steps-value').textContent.trim() !== '—'
      && document.getElementById('status').hidden, { timeout: 30000 }).catch(() => {});
  await ready();
  if (reload) { await page.reload(); await ready(); }
  await page.waitForTimeout(300);
  if (shot) await page.screenshot({ path: path.join(HERE, shot) });
  const t = async (id) => (await page.textContent(`#${id}`)).trim();
  const out = {
    steps: await t('steps-value'), note: await t('steps-note'),
    hr: await t('hr-value'), hrTime: await t('hr-time'),
    weight: await t('renpho-weight'), fat: await t('renpho-fat'),
    renphoSynced: await t('renpho-synced'),
    warnHidden: await page.$eval('#sync-warn', (e) => e.hidden),
    warn: await t('sync-warn'),
    setupSync: await t('setup-sync'),
    dialogs: 0, errs,
  };
  await ctx.close();
  return out;
}

const checks = [];
const check = (name, ok) => checks.push([name, !!ok]);

// A) 9/24 저녁 7:40 (LA). 마지막 동기화 7:36 → 지연 아님. 새로고침 후에도 같은 값.
const a = await open(PULL.metrics, '2026-09-25T02:40:00Z', { reload: true });
check(`오늘(9/24) 걸음 = 7,120 (합계 1행) — ${a.steps}`, a.steps === '7,120');
check(`거리 4,500 m = 2.8 mi — ${a.note}`, a.note.startsWith('2.8 mi'));
check(`심박수 = 가장 최근 실제 샘플 70 — ${a.hr} (${a.hrTime})`, a.hr === '70' && a.hrTime.startsWith('9. 24. 오후 7:36'));
check(`9/23 RENPHO 체중 172.4 lb → 78.2 kg — ${a.weight}`, a.weight === '78.2');
check(`체지방 13.1 — ${a.fat}`, a.fat === '13.1');
check(`RENPHO 측정 시각 9/23 오전 7:10 (LA 날짜 밀림 없음) — ${a.renphoSynced}`, a.renphoSynced.startsWith('9. 23. 오전 7:10'));
check('동기화 지연 표시 없음 (4분 전 동기화)', a.warnHidden);
check(`설정에 상태 표시 — ${a.setupSync}`, a.setupSync.includes('9. 24. 오후 7:36')
  && a.setupSync.includes('Apple 9/24') && a.setupSync.includes('RENPHO 9/23'));

// B) 다음 날 새벽 3:00 — 오늘(9/25) 행 없음, 마지막 동기화 7시간 24분 전.
const b = await open(PULL.metrics, '2026-09-25T10:00:00Z');
check(`오늘 행 없으면 마지막 날(9/24) 합계 7,120 — ${b.steps}`, b.steps === '7,120');
check(`마지막 기록일 표시 — ${b.note}`, b.note.includes('2026-09-24'));
check(`6시간 넘으면 작은 경고 — "${b.warn}"`, !b.warnHidden && b.warn.startsWith('Health sync delayed'));

// C) 지금 실제 DB 와 같은 상태 — 자동화가 9/22 오전 9:02 에 멈췄다 (그 뒤에 써진 행 없음).
const stopped = PULL.metrics.filter((r) => Date.parse(r.updated_at) <= Date.parse('2026-09-22T16:10:00Z'));
const c = await open(stopped, '2026-09-23T19:00:00Z', { shot: 'screenshot-sync-delayed.png' });
check(`9/22 마지막 합계 행 191 — ${c.steps} (${c.note})`, c.steps === '191' && c.note.includes('2026-09-22'));
check(`동기화 멈춤 → 작은 경고 — "${c.warn}"`, !c.warnHidden
  && c.warn.includes('9. 22. 오전 9:02') && c.warn.includes('Apple 9/22') && c.warn.includes('RENPHO 9/21'));

// D) 자동화가 다시 돌아 9/22 를 다시 읽은 뒤 — 같은 날 합계 행 3개(120, 191, 3269) 중 가장 나중 것.
const upTo22 = PULL.metrics.filter((r) => (r.metadata?.local_date ?? '') <= '2026-09-22');
const d = await open(upTo22, '2026-09-25T10:00:00Z');
check(`9/22 합계 = 3,269 (legacy 120·191 무시, 더하지 않음) — ${d.steps}`, d.steps === '3,269');

check('JS 런타임 오류 없음', [a, b, c, d].every((x) => x.errs.length === 0));

console.log('\n=== 동기화 안정화 검증 ===');
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  if (!ok) failed++;
}
for (const x of [a, b, c, d]) if (x.errs.length) console.log('JS 오류:', x.errs);
console.log(`\n${failed === 0 ? '전부 통과' : failed + '건 실패'}\n`);

await browser.close();
server.close();
process.exit(failed === 0 ? 0 : 1);
