// '최근 2주 운동' 누적 막대 차트 (인라인 SVG).
//
// 하루에 막대 하나. 막대 높이 = 그 날 운동 합계, 칸 = 운동별 횟수.
//
// 쌓는 순서는 설정 순서가 아니라 색 구분이 잘 되는 순서다 (아래→위 파랑·초록·보라·주황).
// 원본 팔레트에서 초록과 주황은 적록 색약에게 거의 같은 색이라, 둘이 맞닿지 않게 한다.
// 칸 사이에는 2px 틈을 두고, 막대를 누르면 그 날의 운동별 숫자를 글자로 보여 준다.

import { EXERCISES } from './config.js';
import { shortLabel } from './time.js';

const W = 460;          // viewBox 기준 폭 (실제 크기는 CSS 가 정한다)
const H = 300;
const PAD = { top: 22, right: 6, bottom: 30, left: 34 };
const GAP = 2;          // 칸 사이 틈
const RADIUS = 4;       // 막대 윗끝 둥글게

const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

/** 아래에서 위로 쌓는 순서 */
export const STACK_ORDER = ['pushup', 'triceps', 'shoulder', 'dumbbell'];
const STACK = STACK_ORDER.map((id) => EXERCISES.find((e) => e.id === id)).filter(Boolean)
  .concat(EXERCISES.filter((e) => !STACK_ORDER.includes(e.id)));

/** 0 부터 보기 좋은 간격(1·2·2.5·5 × 10ⁿ)으로, 눈금 5개 이하 */
function yTicks(max) {
  if (!(max > 0)) return [0, 1, 2, 3, 4];
  const mag = 10 ** Math.floor(Math.log10(max / 4));
  const step = [1, 2, 2.5, 5, 10, 20].map((m) => m * mag).find((v) => Math.ceil(max / v) <= 4);
  const n = Math.ceil(max / step);
  return Array.from({ length: n + 1 }, (_, i) => Math.round(i * step * 100) / 100);
}

function marker(shape, cx, cy, color) {
  const r = 3.6;
  switch (shape) {
    case 'diamond':
      return `<path d="M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z" fill="${color}"/>`;
    case 'triangle':
      return `<path d="M${cx} ${cy - r} L${cx + r} ${cy + r * 0.8} L${cx - r} ${cy + r * 0.8} Z" fill="${color}"/>`;
    case 'arrow':
      return `<path d="M${cx - r} ${cy + r} L${cx + r} ${cy - r} M${cx + r} ${cy - r} L${cx + r} ${cy + 0.2} M${cx + r} ${cy - r} L${cx - 0.2} ${cy - r}"
                    stroke="${color}" stroke-width="1.8" stroke-linecap="round" fill="none"/>`;
    default:
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`;
  }
}

/** 윗모서리만 둥근 사각형 */
function topRounded(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  return `M${x} ${y + h} V${y + r} Q${x} ${y} ${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h} Z`;
}

/** 그 날의 운동별 숫자를 글자로 (막대를 눌렀을 때 차트 아래에 보인다) */
export function dayDetail(date, series, i) {
  const parts = STACK.map((ex) => `${ex.label} ${series[ex.id]?.[i] ?? 0}`);
  const total = STACK.reduce((a, ex) => a + (series[ex.id]?.[i] ?? 0), 0);
  return `${shortLabel(date)} · 합계 ${total} — ${parts.join(' · ')}`;
}

/**
 * @param {string[]} dates   'YYYY-MM-DD' 오름차순
 * @param {Record<string, number[]>} series  운동 id → 날짜별 값
 */
export function renderChart(dates, series) {
  if (!dates.length) return '';

  const totals = dates.map((_, i) => STACK.reduce((a, ex) => a + (series[ex.id]?.[i] || 0), 0));
  const ticks = yTicks(Math.max(0, ...totals));
  const max = ticks[ticks.length - 1] || 1;

  const slot = plotW / dates.length;
  const barW = Math.min(22, slot * 0.62);
  const cx = (i) => PAD.left + slot * (i + 0.5);
  const y = (v) => PAD.top + plotH - (plotH * v) / max;

  // 가로 눈금선 + y 라벨
  let grid = '';
  for (const t of ticks) {
    const yy = y(t);
    grid += `<line x1="${PAD.left}" y1="${yy}" x2="${W - PAD.right}" y2="${yy}" class="grid"/>`;
    grid += `<text x="${PAD.left - 7}" y="${yy + 3.2}" class="ytick">${t}</text>`;
  }

  // x 라벨: 이틀 간격 + 마지막 날은 항상
  let xlabels = '';
  dates.forEach((d, i) => {
    const isLast = i === dates.length - 1;
    if (i % 2 === 0 || isLast) {
      xlabels += `<text x="${cx(i)}" y="${H - 8}" class="xtick${isLast ? ' today' : ''}">${shortLabel(d)}</text>`;
    }
  });

  // 막대
  let bars = '';
  dates.forEach((d, i) => {
    const x0 = cx(i) - barW / 2;
    const segs = STACK
      .map((ex) => ({ ex, v: series[ex.id]?.[i] || 0 }))
      .filter((sg) => sg.v > 0);

    // 아래부터 쌓는다. 맨 위 칸이 아니면 위쪽에 2px 틈을 남긴다.
    let marks = '';
    let below = 0;
    segs.forEach((sg, k) => {
      const isTop = k === segs.length - 1;
      const bottom = y(below);
      const top = y(below + sg.v) + (isTop ? 0 : GAP);
      below += sg.v;
      const h = bottom - top;
      if (h <= 0.5) return;
      marks += isTop
        ? `<path d="${topRounded(x0, top, barW, h, RADIUS)}" fill="${sg.ex.color}"/>`
        : `<rect x="${x0}" y="${top}" width="${barW}" height="${h}" fill="${sg.ex.color}"/>`;
    });

    // 합계는 막대 위에 작게. 0 인 날은 적지 않는다.
    const label = totals[i] > 0
      ? `<text x="${cx(i)}" y="${y(totals[i]) - 5}" class="btot">${totals[i]}</text>` : '';

    // 누르기 쉬운 투명 영역 (막대보다 넓게)
    bars += `<g class="bar" data-i="${i}" tabindex="0" role="button"
               aria-label="${dayDetail(d, series, i)}">
      <rect x="${PAD.left + slot * i}" y="${PAD.top}" width="${slot}" height="${plotH}" class="hit"/>
      ${marks}${label}
    </g>`;
  });

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img"
               aria-label="최근 ${dates.length}일 하루 운동 횟수 (운동별 누적)">
    ${grid}${xlabels}${bars}
  </svg>`;
}

/** 범례: 색 점 + 도형 + 이름 + 기간 합계 (값을 직접 표기해 색에만 의존하지 않는다) */
export function renderLegend(series) {
  return EXERCISES.map((ex) => {
    const total = (series[ex.id] ?? []).reduce((a, b) => a + (b || 0), 0);
    return `<div class="lg-item">
      <svg class="lg-mark" viewBox="0 0 12 12" aria-hidden="true">
        ${marker(ex.shape, 6, 6, ex.color)}
      </svg>
      <span class="lg-name">${ex.label}</span>
      <span class="lg-val">${total.toLocaleString('en-US')}회</span>
    </div>`;
  }).join('');
}
