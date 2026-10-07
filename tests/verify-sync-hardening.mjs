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
    () => document.getElementById('status').hidden
      && document.getElementById('renpho-weight').textContent.trim() !== '—', { timeout: 30000 }).catch(() => {});
  await ready();
  if (reload) { await page.reload(); await ready(); }
  await page.waitForTimeout(300);
  if (shot) await page.screenshot({ path: path.join(HERE, shot) });
  const t = async (id) => (await page.textContent(`#${id}`)).trim();
  const out = {
    // 걸음·심박수는 화면에서 뺐지만(Apple 건강은 바로가기만) 앱이 계산하는 값은 그대로 검증한다.
    ...(await page.evaluate(async () => {
      const q = await import('/js/health-queries.js');
      const t = await import('/js/time.js');
      const d = await q.fetchDashboard();
      const steps = d.steps;
      const mi = Number.isFinite(d.distance?.value) ? (d.distance.value / 1609.344).toFixed(1) : null;
      return {
        steps: steps ? Math.round(steps.value).toLocaleString('en-US') : '—',
        note: !steps ? '기록 없음' : steps.isToday ? (mi ? `${mi} mi 걷기·달리기` : '오늘 현재까지') : `마지막 기록 ${steps.localDate ?? ''}`,
        hr: d.heartRate ? String(Math.round(d.heartRate.value)) : '—',
        hrTime: d.heartRate ? `${t.metricTime(d.heartRate)} 측정` : '기록 없음',
      };
    })),
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
check(`RENPHO 측정 시각 9/23 오전 7:10 (LA 날짜 밀림 없음) — ${a.renphoSynced}`, a.renphoSynced === '9. 23. 오전 7:10 측정');
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

// E) 9/30 밤 실제 DB 와 같은 모양 (숫자는 지어낸 값)
//   - 심박수가 source='Chace’s Apple Watch' 로 들어온다 → 그것도 Apple 로 읽어야 한다
//   - 9/29 오전 7시 동기화가 그 날을 0 (complete_day=false) 으로 써 두고 멈췄다 → 9/28 을 보여야 한다
const P = '6eb29763-315a-46b7-bcf7-da24b8f1503e';
const daily = (metric, d, value, complete, synced) => ({ profile_id: P, source: 'Apple Health', metric, value,
  unit: metric === 'stepCount' ? 'count' : 'm', recorded_at: `${d}T07:00:00+00:00`, updated_at: synced,
  metadata: { local_date: d, aggregation: 'daily_sum', complete_day: complete, synced_local_time: synced } });
const E_ROWS = [
  { profile_id: P, source: 'Apple Health', metric: 'heartRate', value: 90, unit: 'count/min',
    recorded_at: '2026-09-24T21:50:00+00:00', updated_at: '2026-09-27T15:59:00+00:00',
    metadata: { sample_time_local: '2026-09-24T14:50:00-07:00' } },
  { profile_id: P, source: 'Chace’s Apple Watch', metric: 'heartRate', value: 101, unit: 'count/min',
    recorded_at: '2026-09-28T02:47:00+00:00', updated_at: '2026-09-29T14:06:00+00:00',
    metadata: { sample_time_local: '2026-09-27T19:47:00-07:00' } },
  daily('stepCount', '2026-09-28', 4000, true, '2026-09-29T07:04:45-07:00'),
  daily('distanceWalkingRunning', '2026-09-28', 3000, true, '2026-09-29T07:04:45-07:00'),
  daily('stepCount', '2026-09-29', 0, false, '2026-09-29T07:04:45-07:00'),
  daily('distanceWalkingRunning', '2026-09-29', 0, false, '2026-09-29T07:04:45-07:00'),
];
const e = await open(E_ROWS, '2026-10-01T03:27:00Z');
check(`Apple Watch 심박수도 읽음 — ${e.hr} (${e.hrTime})`, e.hr === '101' && e.hrTime.startsWith('9. 27. 오후 7:47'));
check(`덜 들어온 9/29 의 0 대신 9/28 합계 — ${e.steps} (${e.note})`, e.steps === '4,000' && e.note.includes('2026-09-28'));
check(`동기화 멈춤 경고 — "${e.warn}"`, !e.warnHidden && e.warn.includes('9. 29. 오전 7:'));

check('JS 런타임 오류 없음', [a, b, c, d, e].every((x) => x.errs.length === 0));

console.log('\n=== 동기화 안정화 검증 ===');
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  if (!ok) failed++;
}
for (const x of [a, b, c, d, e]) if (x.errs.length) console.log('JS 오류:', x.errs);
console.log(`\n${failed === 0 ? '전부 통과' : failed + '건 실패'}\n`);

await browser.close();
server.close();
process.exit(failed === 0 ? 0 : 1);
