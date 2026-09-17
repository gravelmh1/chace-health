// PostgREST 흉내 — 앱이 만든 쿼리 문자열을 실제로 해석해서 결과를 돌려준다.
// 쿼리가 틀리면 틀린 결과가 나오므로, 화면 검증이 곧 쿼리 검증이 된다.

// 타임스탬프끼리는 문자열이 아니라 시각으로 비교해야 한다.
// ('...T04:30:00Z' < '...T00:00:00-07:00' 은 문자열로는 false, 시각으로는 true)
const TS = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/;

function coerce(a, b) {
  if (TS.test(String(a)) && TS.test(String(b))) {
    return [Date.parse(a), Date.parse(b)];
  }
  return [a, b];
}

const cmp = (fn) => (a, b) => { const [x, y] = coerce(a, b); return fn(x, y); };

const OPS = {
  eq: (a, b) => String(a) === b,
  gte: cmp((a, b) => a >= b),
  gt: cmp((a, b) => a > b),
  lte: cmp((a, b) => a <= b),
  lt: cmp((a, b) => a < b),
};

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'and', 'or']);

/** 'metadata->>local_date' 같은 jsonb 경로 포함 값 읽기 */
function readField(row, field) {
  const jsonb = field.match(/^(\w+)->>(.+)$/);
  if (jsonb) return row[jsonb[1]]?.[jsonb[2]];
  return row[field];
}

function applyFilter(rows, field, expr) {
  const i = expr.indexOf('.');
  const op = expr.slice(0, i);
  const val = expr.slice(i + 1);
  const fn = OPS[op];
  if (!fn) throw new Error(`지원하지 않는 연산자: ${op}`);
  return rows.filter((r) => {
    const v = readField(r, field);
    return v !== undefined && v !== null && fn(v, val);
  });
}

export function query(rows, searchParams) {
  let out = [...rows];

  for (const [key, value] of searchParams.entries()) {
    if (RESERVED.has(key)) continue;
    out = applyFilter(out, key, value);
  }

  // and=(col.op.val,...)
  const and = searchParams.get('and');
  if (and) {
    for (const part of and.replace(/^\(|\)$/g, '').split(',')) {
      const m = part.match(/^([\w>-]+?)\.(\w+)\.(.+)$/);
      if (m) out = applyFilter(out, m[1], `${m[2]}.${m[3]}`);
    }
  }

  const order = searchParams.get('order');
  if (order) {
    const [col, dir = 'asc'] = order.split('.');
    out.sort((a, b) => {
      const [x, y] = coerce(readField(a, col), readField(b, col));
      if (x === y) return 0;
      const c = x < y ? -1 : 1;
      return dir.startsWith('desc') ? -c : c;
    });
  }

  const limit = searchParams.get('limit');
  if (limit) out = out.slice(0, Number(limit));

  const select = searchParams.get('select');
  if (select && select !== '*') {
    const cols = select.split(',').map((c) => c.trim());
    out = out.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
  }

  return out;
}
