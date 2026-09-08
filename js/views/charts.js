/* views/charts.js — four small charts, drawn as SVG, no library.
 *
 * The dashboard is the only screen that plots anything, and it only
 * ever needs four shapes: a trend over time, a split of a whole, a
 * comparison of a handful of bars, and a meter. Each is a function
 * that takes numbers and returns a string; none of them knows what
 * the numbers mean.
 *
 * They are deliberately plain: one accent line, a soft fill under
 * it, values printed at the points rather than hidden behind a
 * hover, because this is read on a phone at a workbench as often as
 * on a desk.
 */

import { esc } from '../ui.js';
import { num } from '../format.js';

const TONES = ['quote', 'prod', 'sub', 'qc', 'ship', 'done'];
export function chartTone(i) { return TONES[i % TONES.length]; }

/** A trend: points is [{ label, value }]. */
export function lineChart(points, { height = 190, money = false } = {}) {
  if (!points.length) return '<div class="chart-none">Nothing to plot yet</div>';
  const w = 640;
  const h = height;
  const padL = 44; const padR = 14; const padT = 22; const padB = 26;
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = points.length > 1 ? (w - padL - padR) / (points.length - 1) : 0;
  const x = (i) => padL + step * i;
  const y = (v) => padT + (1 - v / max) * (h - padT - padB);

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${h - padB} L${padL},${h - padB} Z`;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const gy = padT + f * (h - padT - padB);
    return `<line class="ch-grid" x1="${padL}" x2="${w - padR}" y1="${gy}" y2="${gy}"/>
            <text class="ch-ax" x="${padL - 8}" y="${gy + 4}" text-anchor="end">${esc(shortNum(max * (1 - f)))}</text>`;
  }).join('');

  return `
    <svg class="chart chart-line" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img"
         aria-label="Trend chart">
      <defs>
        <linearGradient id="chfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="currentColor" stop-opacity=".22"/>
          <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grid}
      <path class="ch-area" d="${area}" fill="url(#chfill)"/>
      <path class="ch-line" d="${line}"/>
      ${points.map((p, i) => `
        <circle class="ch-dot" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.6"/>
        <text class="ch-val" x="${x(i).toFixed(1)}" y="${(y(p.value) - 10).toFixed(1)}" text-anchor="middle">${esc(money ? shortNum(p.value) : String(p.value))}</text>
        <text class="ch-ax" x="${x(i).toFixed(1)}" y="${h - 8}" text-anchor="middle">${esc(p.label)}</text>`).join('')}
    </svg>`;
}

/** A split of a whole: slices is [{ label, value }]. */
export function donutChart(slices, { total = '', caption = '' } = {}) {
  const sum = slices.reduce((n, s) => n + s.value, 0);
  if (!sum) return '<div class="chart-none">Nothing to split yet</div>';
  const r = 54; const c = 2 * Math.PI * r;
  let at = 0;
  const rings = slices.map((s, i) => {
    const frac = s.value / sum;
    const seg = `<circle class="ch-seg t-${chartTone(i)}" cx="70" cy="70" r="${r}"
      stroke-dasharray="${(frac * c).toFixed(2)} ${(c - frac * c).toFixed(2)}"
      stroke-dashoffset="${(-at * c).toFixed(2)}"/>`;
    at += frac;
    return seg;
  }).join('');

  return `
    <div class="donut">
      <svg viewBox="0 0 140 140" class="chart chart-donut" role="img" aria-label="Share chart">
        <circle class="ch-track" cx="70" cy="70" r="${r}"/>
        <g transform="rotate(-90 70 70)">${rings}</g>
        <text class="ch-cap" x="70" y="66" text-anchor="middle">${esc(caption)}</text>
        <text class="ch-tot num" x="70" y="86" text-anchor="middle">${esc(String(total || sum))}</text>
      </svg>
      <ul class="legend">
        ${slices.map((s, i) => `
          <li class="t-${chartTone(i)}">
            <i></i><span>${esc(s.label)}</span>
            <b class="num">${esc(String(s.value))}</b>
            <em>${Math.round((s.value / sum) * 100)}%</em>
          </li>`).join('')}
      </ul>
    </div>`;
}

/** A handful of bars: bars is [{ label, value, tone }]. */
export function barChart(bars, { height = 170 } = {}) {
  if (!bars.length) return '<div class="chart-none">Nothing to compare yet</div>';
  const max = Math.max(1, ...bars.map((b) => b.value));
  return `
    <div class="barchart" style="height:${height}px">
      ${bars.map((b, i) => `
        <div class="barcol" title="${esc(`${b.label}: ${b.value}`)}">
          <span class="barval num">${esc(String(b.value))}</span>
          <span class="bar t-${esc(b.tone || chartTone(i))}" style="height:${Math.max(3, (b.value / max) * 100)}%"></span>
          <span class="barlbl">${esc(b.label)}</span>
        </div>`).join('')}
    </div>`;
}

/** Ranked meters: rows is [{ label, value, note }]. */
export function meterList(rows, { max = 0, money = false } = {}) {
  if (!rows.length) return '<div class="chart-none">Nothing here yet</div>';
  const top = max || Math.max(1, ...rows.map((r) => r.value));
  return `
    <ul class="meters">
      ${rows.map((r, i) => `
        <li class="t-${chartTone(i)}">
          <div class="meter-h">
            <span class="meter-l">${esc(r.label)}</span>
            <span class="meter-v num">${esc(money ? `₹${num(r.value)}` : String(r.value))}</span>
          </div>
          <div class="meter-track"><i style="width:${Math.max(2, (r.value / top) * 100)}%"></i></div>
          ${r.note ? `<span class="meter-n">${esc(r.note)}</span>` : ''}
        </li>`).join('')}
    </ul>`;
}

function shortNum(v) {
  const n = Math.round(v);
  if (n >= 10000000) return `${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}
