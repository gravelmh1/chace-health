// '최근 2주 운동' 선 차트 (인라인 SVG).
//
// 계열이 4개인데 원본 팔레트는 색약(적록) 환경에서 삼두(초록)와 덤벨(주황)의
// 분리도가 낮다. 색을 바꾸지 않는 대신, 원본이 이미 타일에 쓰고 있는 도형을
// 마커로 함께 그려서 색 없이도 계열이 구분되게 한다.
// 범례에는 계열별 합계를 직접 표기해 값 자체도 색에 의존하지 않는다.

import { EXERCISES } from './config.js';
import { shortLabel } from './time.js';

const W = 460;          // viewBox 기준 폭 (실제 크기는 CSS 가 정한다)
const H = 300;
const PAD = { top: 16, right: 10, bottom: 30, left: 34 };

const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

/** 0 / 1/4 / 2/4 / 3/4 / 최대 다섯 눈금 */
function yTicks(max) {
  if (!(max > 0)) return [0, 1];
  return [0, 1, 2, 3, 4].map((i) => Math.round((max * i) / 4));
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

/**
 * @param {string[]} dates   'YYYY-MM-DD' 오름차순
 * @param {Record<string, number[]>} series  운동 id → 날짜별 값
 */
export function renderChart(dates, series) {
  if (!dates.length) return '';

  const allValues = EXERCISES.flatMap((ex) => series[ex.id] ?? []);
  const rawMax = Math.max(0, ...allValues);
  const ticks = yTicks(rawMax);
  const max = ticks[ticks.length - 1] || 1;

  const x = (i) => PAD.left + (dates.length === 1 ? plotW / 2 : (plotW * i) / (dates.length - 1));
  const y = (v) => PAD.top + plotH - (plotH * (v || 0)) / max;

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
      xlabels += `<text x="${x(i)}" y="${H - 8}" class="xtick">${shortLabel(d)}</text>`;
    }
  });

  // 계열
  let lines = '';
  for (const ex of EXERCISES) {
    const vals = series[ex.id] ?? [];
    if (!vals.length) continue;
    const pts = vals.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    lines += `<polyline points="${pts}" fill="none" stroke="${ex.color}"
                        stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    lines += vals.map((v, i) => marker(ex.shape, x(i), y(v), ex.color)).join('');
  }

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img"
               aria-label="최근 ${dates.length}일 운동 횟수 추이">
    ${grid}${xlabels}${lines}
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
