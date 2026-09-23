// 눈으로 읽어 옮긴 키의 헷갈리는 글자를 자동으로 바로잡는다.
//
// 배경: 아이폰에서 대시보드의 복사 버튼이 막히면 키를 화면에서 읽어 옮기게 되는데,
//       l/I/1 이나 O/0 처럼 생김새가 같은 글자에서 반드시 틀린다. 사람이 몇 번을
//       다시 읽어도 같은 자리에서 같은 실수를 한다.
//
// 방법: 헷갈리는 자리마다 후보 글자를 갈아 끼운 변형들을 만들고, 실제로 요청을
//       보내 어느 것이 통과하는지 본다. 맞는 하나만 남는다.

import { SUPABASE_URL } from './config.js';
import { authHeaders } from './supabase.js';

// 실제로 눈으로 구분이 안 되는 것만 넣는다. 넓힐수록 조합이 폭증해서
// 정작 흔한 실수를 못 잡고 한도에 걸린다.
const LOOKALIKES = [
  ['l', 'I', '1'],
  ['O', '0'],
  ['S', '5'],
  ['Z', '2'],
  ['B', '8'],
  ['G', '6'],
];

const optionsFor = (ch) => LOOKALIKES.find((g) => g.includes(ch)) ?? [ch];

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
    const opts = optionsFor(key[i]);
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

/** 이 키로 Supabase 가 응답하는지 확인한다. */
async function keyWorks(key, signal) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'GET',
      cache: 'no-store',
      signal,
      headers: authHeaders(key),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 맞는 키를 찾는다.
 * @param {string} key 사용자가 입력한 키
 * @param {(done:number,total:number)=>void} [onProgress]
 * @returns {Promise<{found:string|null, tried:number, total:number, tooMany?:boolean}>}
 */
export async function repairKey(key, onProgress) {
  const variants = keyVariants(key.trim());
  if (!variants) return { found: null, tried: 0, total: 0, tooMany: true };

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
