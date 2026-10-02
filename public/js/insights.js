// "Insights" tab: hand-written SVG charts (donut, cumulative timeline, paid vs. used bars).
import { state, enter, realExpenses } from './state.js';
import { CATEGORIES, catColor, esc, sum, money, short, niceDate, avatar } from './util.js';
import { showTip, hideTip } from './ui.js';

export function insightsHTML() {
  const exps = realExpenses();
  if (!exps.length) return `<div class="card empty"><span class="big-emoji">📊</span>No expenses yet. Add a few and the charts will appear here.</div>`;
  return `
    <div class="insights${state.anim ? ' anim' : ''}">
      <section class="card"${enter(0)}>
        <h2 style="margin-bottom:14px">Where the money went</h2>
        <div class="donut-wrap">${donut(exps)}</div>
      </section>
      <section class="card"${enter(1)}>
        <h2 style="margin-bottom:14px">Spending over time</h2>
        <div id="timeline">${timeline(exps)}</div>
      </section>
      <section class="card wide"${enter(2)}>
        <h2 style="margin-bottom:14px">Who paid vs. who used</h2>
        ${paidVsUsed(exps)}
      </section>
    </div>`;
}

let timelinePts = [];
export function bindInsights() {
  const svg = document.getElementById('timeline')?.querySelector('svg');
  if (!svg) return;
  const cross = svg.querySelector('.cross'), mark = svg.querySelector('.mark');
  svg.onpointermove = (e) => {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 520;
    const p = timelinePts.reduce((best, c) => (Math.abs(c.x - x) < Math.abs(best.x - x) ? c : best));
    cross.setAttribute('x1', p.x); cross.setAttribute('x2', p.x); cross.style.display = '';
    mark.setAttribute('cx', p.x); mark.setAttribute('cy', p.y); mark.style.display = '';
    showTip(`${niceDate(p.date)}\n${money(p.cum)} total · +${money(p.day)} that day`, e.clientX, e.clientY);
  };
  svg.onpointerleave = () => { cross.style.display = mark.style.display = 'none'; hideTip(); };
}

function donut(exps) {
  const byCat = {};
  exps.forEach((e) => (byCat[e.category] = (byCat[e.category] || 0) + e.amount_cents));
  const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const total = sum(rows.map((r) => r[1]));
  const r = 70, C = 2 * Math.PI * r, gap = rows.length > 1 ? 3 : 0;
  let offset = 0;
  const arcs = rows.map(([cat, v], i) => {
    const len = (v / total) * C;
    const el = `<circle class="arc" style="--i:${i};stroke:${catColor(cat)}" cx="100" cy="100" r="${r}" fill="none" stroke-width="26"
      stroke-dasharray="${Math.max(len - gap, 0.5)} ${C}" stroke-dashoffset="${-offset}" transform="rotate(-90 100 100)"
      data-tip="${CATEGORIES[cat]} ${cat}\n${money(v)} · ${Math.round((v / total) * 100)}%"/>`;
    offset += len;
    return el;
  }).join('');
  return `
    <svg viewBox="0 0 200 200" class="donut" role="img" aria-label="Spending by category">
      ${arcs}
      <text x="100" y="98" class="donut-total">${short(total)}</text>
      <text x="100" y="116" class="donut-sub">total spent</text>
    </svg>
    <ul class="legend">
      ${rows.map(([cat, v]) => `<li><i style="--k:${catColor(cat)}"></i><span>${CATEGORIES[cat]} ${cat}</span><b>${money(v)}</b><em>${Math.round((v / total) * 100)}%</em></li>`).join('')}
    </ul>`;
}

function timeline(exps) {
  const perDay = {};
  exps.forEach((e) => (perDay[e.spent_on] = (perDay[e.spent_on] || 0) + e.amount_cents));
  const days = Object.keys(perDay).sort();
  let cum = 0;
  const W = 520, H = 230, L = 52, R = 18, T = 14, B = 30;
  const t0 = Date.parse(days[0]), t1 = Date.parse(days[days.length - 1]);
  const total = sum(Object.values(perDay));
  const pts = days.map((d) => {
    cum += perDay[d];
    return { date: d, day: perDay[d], cum, x: days.length === 1 ? (L + W - R) / 2 : L + ((Date.parse(d) - t0) / (t1 - t0)) * (W - L - R), y: T + (1 - cum / total) * (H - T - B) };
  });
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const base = H - B;
  const area = `${line} L${pts[pts.length - 1].x} ${base} L${pts[0].x} ${base} Z`;
  const grid = [0, 0.5, 1].map((f) => {
    const y = T + (1 - f) * (H - T - B);
    return `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="grid"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" class="axis">${short(total * f)}</text>`;
  }).join('');
  const xl = days.length === 1 ? [pts[0]] : [pts[0], pts[pts.length - 1]];
  timelinePts = pts;
  return `<svg viewBox="0 0 ${W} ${H}" class="timeline" role="img" aria-label="Cumulative spending over time">
    <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--s1)" stop-opacity="0.32"/><stop offset="1" style="stop-color:var(--s1)" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <path class="tl-area" d="${area}" fill="url(#area)"/>
    <path class="tl-line" d="${line}" pathLength="1" fill="none" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${pts.map((p) => `<circle class="tl-dot" cx="${p.x}" cy="${p.y}" r="3.5"/>`).join('')}
    ${xl.map((p) => `<text x="${p.x}" y="${H - 8}" text-anchor="middle" class="axis">${niceDate(p.date)}</text>`).join('')}
    <line class="cross" y1="${T}" y2="${base}" style="display:none"/>
    <circle class="mark" r="6" style="display:none"/>
    <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
  </svg>`;
}

function paidVsUsed(exps) {
  const stats = state.g.members.map((m) => ({
    m,
    paid: sum(exps.filter((e) => e.paid_by === m.id).map((e) => e.amount_cents)),
    used: sum(exps.flatMap((e) => e.splits.filter((s) => s.member_id === m.id).map((s) => s.share_cents))),
  }));
  const max = Math.max(...stats.flatMap((s) => [s.paid, s.used]), 1);
  return `
    <div class="legend inline"><span><i style="--k:var(--s1)"></i>Paid</span><span><i style="--k:var(--s2)"></i>Their share of costs</span></div>
    <div class="bars">
      ${stats.map((s, i) => `<div class="bar-row"><div class="bar-name">${avatar(s.m, 'sm')}<span>${esc(s.m.name)}</span></div><div class="bar-tracks">
        <div class="bar-line" data-tip="${esc(s.m.name)} paid ${money(s.paid)}"><div class="bar" style="--i:${i};--k:var(--s1);width:${(s.paid / max) * 100}%"></div><span>${money(s.paid)}</span></div>
        <div class="bar-line" data-tip="${esc(s.m.name)}'s share of costs: ${money(s.used)}"><div class="bar" style="--i:${i};--k:var(--s2);width:${(s.used / max) * 100}%"></div><span>${money(s.used)}</span></div>
      </div></div>`).join('')}
    </div>`;
}
