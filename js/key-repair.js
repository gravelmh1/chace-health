// 눈으로 읽어 옮긴 키의 헷갈리는 글자를 자동으로 바로잡는다.
//
// 배경: 아이폰에서 대시보드의 복사 버튼이 막히면 키를 화면에서 읽어 옮기게 되는데,
//       l/I/1 이나 O/0 처럼 생김새가 같은 글자에서 반드시 틀린다. 사람이 몇 번을
//       다시 읽어도 같은 자리에서 같은 실수를 한다.
//
// 방법: 헷갈리는 자리마다 후보 글자를 갈아 끼운 변형들을 만들고, 실제로 요청을
//       보내 어느 것이 통과하는지 본다. 맞는 하나만 남는다.

import { SUPABASE_URL, SYNC_PULL_FNS } from './config.js';
import { authHeaders } from './supabase.js';

// 1단계: 가장 자주 틀리는 것들. 이것만 모든 조합을 만든다.
const CORE = [
  ['l', 'I', '1'],
  ['O', '0'],
  ['S', '5'],
  ['Z', '2'],
  ['B', '8'],
  ['G', '6'],
];

// 2단계: 여기까지 넣어 모든 조합을 만들면 수천 가지가 되어 실용적이지 않다.
// 그래서 2단계는 "한 글자만 바꾼" 후보로 제한한다.
const EXTRA = [
  ['-', '_'],
  ['q', 'g'],
  ['c', 'e'],
  ['n', 'h'],
  ['r', 'v'],
  ['m', 'rn'],
];

const coreOptions = (ch) => CORE.find((g) => g.includes(ch)) ?? [ch];

/** 대소문자가 헷갈리는 글자 — 모양이 같고 크기만 다르다 */
const CASE_AMBIGUOUS = 'cosuvwxzpkjy';

function extraOptions(ch) {
  const out = new Set();
  for (const g of EXTRA) if (g.includes(ch)) g.forEach((x) => { if (x !== ch) out.add(x); });
  if (CASE_AMBIGUOUS.includes(ch.toLowerCase())) {
    out.add(ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase());
  }
  return [...out];
}

// 형식이 정해진 앞부분은 손대지 않는다. 여기까지 틀릴 일이 없고,
// 포함시키면 조합만 몇 배로 불어난다.
const FIXED_PREFIXES = ['sb_publishable_', 'sb_secret_'];

function fixedHead(key) {
  return FIXED_PREFIXES.find((p) => key.startsWith(p))?.length ?? 0;
}

/** 조합이 너무 많아지면 포기한다. 무한정 요청을 보내지 않기 위함이다. */
const MAX_VARIANTS = 400;

/**
 * 헷갈리는 자리를 갈아 끼운 변형들. 원본이 항상 첫 번째다.
 * @returns {string[]|null} 조합이 한도를 넘으면 null
 */
export function keyVariants(key) {
  const head = fixedHead(key);
  const slots = [];
  for (let i = head; i < key.length; i++) {
    const opts = coreOptions(key[i]);
    if (opts.length > 1) slots.push({ i, opts });
  }
  if (!slots.length) return [key];

  const count = slots.reduce((n, s) => n * s.opts.length, 1);
  if (count > MAX_VARIANTS) return null;

  let out = [key];
  for (const slot of slots) {
    const next = [];
    for (const base of out) {
      for (const ch of slot.opts) {
        next.push(base.slice(0, slot.i) + ch + base.slice(slot.i + 1));
      }
    }
    out = next;
  }
  // 원본을 맨 앞으로 (맞다면 한 번에 끝난다)
  return [key, ...out.filter((v) => v !== key)];
}

/**
 * 2단계 후보: 원본에서 한 글자만 바꾼 것들.
 * 조합을 만들지 않으므로 개수가 글자 수에 비례해 늘어난다 (수십 개 수준).
 */
export function singleEditVariants(key) {
  const head = fixedHead(key);
  const out = [];
  for (let i = head; i < key.length; i++) {
    for (const ch of extraOptions(key[i])) {
      out.push(key.slice(0, i) + ch + key.slice(i + 1));
    }
  }
  return [...new Set(out)].filter((v) => v !== key);
}

/**
 * 이 키로 실제 읽기 통로가 열리는지 확인한다.
 *
 * PostgREST 루트(/rest/v1/)는 anon 에게 열려 있지 않을 수 있어, 키가 맞아도
 * 401 이 난다. 그 주소로 판정하면 어떤 키도 통과하지 못한다.
 */
async function keyWorks(key, signal) {
  for (const fn of SYNC_PULL_FNS) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        body: '{}',
        cache: 'no-store',
        signal,
        headers: { ...authHeaders(key), 'Content-Type': 'application/json' },
      });
      if (res.ok) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * 맞는 키를 찾는다.
 * @param {string} key 사용자가 입력한 키
 * @param {(done:number,total:number)=>void} [onProgress]
 * @returns {Promise<{found:string|null, tried:number, total:number, tooMany?:boolean}>}
 */
export async function repairKey(key, onProgress) {
  const trimmed = key.trim();
  const core = keyVariants(trimmed);
  if (!core) return { found: null, tried: 0, total: 0, tooMany: true };

  // 1단계에서 못 찾으면, 한 글자만 다른 후보까지 본다.
  const variants = [...core, ...singleEditVariants(trimmed).filter((v) => !core.includes(v))];

  const BATCH = 6; // 한 번에 보내는 요청 수
  let tried = 0;

  for (let i = 0; i < variants.length; i += BATCH) {
    const batch = variants.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((v) => keyWorks(v)));
    tried += batch.length;
    onProgress?.(Math.min(tried, variants.length), variants.length);

    const hit = batch[results.indexOf(true)];
    if (results.includes(true)) return { found: hit, tried, total: variants.length };
  }
  return { found: null, tried, total: variants.length };
}
