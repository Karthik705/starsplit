// The debt constellation: an SVG of stars (people) and glowing debts between them.
import { state, memberOf } from './state.js';
import { esc, money, store, initial } from './util.js';

export const layoutKey = () => 'starsplit:layout:' + state.g.group.code;
const VIEW = { x0: 0, y0: 20, w: 420, h: 380, cx: 210, cy: 210, R: 140 };

function positions() {
  const saved = store(layoutKey()) || {};
  const pos = {};
  const n = state.g.members.length;
  state.g.members.forEach((m, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const p = saved[m.id] || { x: VIEW.cx + VIEW.R * Math.cos(a), y: VIEW.cy + VIEW.R * Math.sin(a) };
    pos[m.id] = { x: p.x, y: p.y, a: Math.atan2(p.y - VIEW.cy, p.x - VIEW.cx) };
  });
  return pos;
}

const overlap = (a, b) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Place each amount label somewhere along its line where it collides least
 * with labels already placed and with the stars themselves.
 */
function placeLabels(edges, pos, radius) {
  const starBoxes = Object.entries(pos).map(([id, p]) => {
    const r = radius[id] + 6;
    return { x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r };
  });
  const placed = [];
  const tries = [0.5, 0.4, 0.6, 0.32, 0.68, 0.45, 0.55, 0.27, 0.73];
  return edges.map((e) => {
    const p = pos[e.from], t = pos[e.to];
    const text = money(e.amount_cents);
    const w = text.length * 6.3 + 14, h = 18;
    let best = null;
    for (const f of tries) {
      const cx = p.x + (t.x - p.x) * f, cy = p.y + (t.y - p.y) * f;
      const box = { x: cx - w / 2, y: cy - h / 2, w, h };
      const score = [...placed, ...starBoxes].reduce((s, b) => s + overlap(box, b), 0);
      if (!best || score < best.score) best = { box, cx, cy, score };
      if (score === 0) break;
    }
    placed.push(best.box);
    return { ...best, text };
  });
}

/**
 * phase: 'first'  -> stars pop in, lines draw
 *        'toggle' -> lines draw again (stars stay put)
 *        'drag'   -> no animation at all while dragging
 *        'static' -> stars and lines appear immediately, comets keep flowing
 */
export function constellation(phase = 'static') {
  const { members, net, expenses } = state.g;
  const edges = state.mode === 'raw' ? state.g.debts.raw : state.g.debts.simplified;
  const pos = positions();
  const maxEdge = Math.max(1, ...edges.map((e) => e.amount_cents));
  const maxNet = Math.max(1, ...Object.values(net).map(Math.abs));
  const radius = Object.fromEntries(members.map((m) => [m.id, 12 + 8 * (Math.abs(net[m.id]) / maxNet)]));
  const labels = placeLabels(edges, pos, radius);
  const drawEdges = phase === 'first' || phase === 'toggle';

  const lines = edges.map((e, i) => {
    const p = pos[e.from], t = pos[e.to];
    const color = memberOf(e.from).color;
    const w = 1.6 + (3 * e.amount_cents) / maxEdge;
    const dx = t.x - p.x, dy = t.y - p.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    // chevron pointing at the creditor, just outside their star
    const off = radius[e.to] + 12;
    const ex = t.x - ux * off, ey = t.y - uy * off;
    const chev = `${ex + ux * 6},${ey + uy * 6} ${ex - ux * 5 - uy * 5},${ey - uy * 5 + ux * 5} ${ex - ux * 5 + uy * 5},${ey - uy * 5 - ux * 5}`;
    const comets = phase === 'drag' ? '' : [0, 1].map((k) => `<circle class="comet" r="${(w * 0.55 + 1).toFixed(1)}" fill="${color}">
        <animateMotion dur="${(2.6 + (i % 3) * 0.4).toFixed(1)}s" begin="${(k * 1.3).toFixed(1)}s" repeatCount="indefinite" path="M${p.x} ${p.y} L${t.x} ${t.y}"/></circle>`).join('');
    const fade = drawEdges ? ` fade-in" style="--i:${i}` : '';
    const L = labels[i];
    return `<g class="edge-g" data-tip="${esc(memberOf(e.from).name)} owes ${esc(memberOf(e.to).name)} ${L.text}">
      <line class="edge${drawEdges ? ' draw' : ''}" pathLength="1" style="--i:${i}" x1="${p.x}" y1="${p.y}" x2="${t.x}" y2="${t.y}" stroke="${color}" stroke-width="${w.toFixed(1)}" opacity="0.6"/>
      ${comets}
      <polygon class="chevron${fade}" points="${chev}" fill="${color}"/>
      <rect class="edge-pill${fade}" x="${L.box.x}" y="${L.box.y}" width="${L.box.w}" height="${L.box.h}" rx="9"/>
      <text class="edge-label${fade}" x="${L.cx}" y="${L.cy + 4}">${L.text}</text></g>`;
  }).join('');

  const stars = members.map((m, i) => {
    const p = pos[m.id];
    const v = net[m.id];
    const r = radius[m.id];
    const ring = v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'transparent';
    const c = Math.cos(p.a);
    const anchor = c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle';
    const lx = p.x + (anchor === 'middle' ? 0 : Math.sign(c) * (r + 14));
    const ly = anchor === 'middle' ? p.y + Math.sign(Math.sin(p.a) || 1) * (r + 20) + 4 : p.y + 4;
    const status = v > 0 ? `is owed ${money(v)}` : v < 0 ? `owes ${money(-v)}` : 'is settled';
    return `<g class="star-g${phase === 'first' ? ' pop' : ''}" style="--i:${i}" data-id="${m.id}" data-tip="${esc(m.name)} ${status}">
      <circle class="halo" cx="${p.x}" cy="${p.y}" r="${r + 10}" fill="${m.color}" opacity="0.16"/>
      <circle cx="${p.x}" cy="${p.y}" r="${r + 4}" fill="none" stroke="${ring}" stroke-width="2" opacity="0.9"/>
      <circle class="core" cx="${p.x}" cy="${p.y}" r="${r}" fill="${m.color}"/>
      <text class="initial" x="${p.x}" y="${p.y + 4}">${initial(m.name)}</text>
      <text class="star-name" style="text-anchor:${anchor}" x="${lx}" y="${ly}">${esc(m.name)}</text>
    </g>`;
  }).join('');

  const empty = edges.length ? '' : `<text class="all-square" x="${VIEW.cx}" y="${VIEW.cy + 6}">${expenses.length ? 'All square ✦' : 'No debts yet'}</text>`;
  const desc = edges.map((e) => `${memberOf(e.from).name} owes ${memberOf(e.to).name} ${money(e.amount_cents)}`).join('. ');
  return `<svg class="constellation" viewBox="${VIEW.x0} ${VIEW.y0} ${VIEW.w} ${VIEW.h}" role="img" aria-label="Debt constellation. ${esc(desc || 'Nobody owes anything.')}">${lines}${stars}${empty}</svg>`;
}

/** Drag a star to rearrange the constellation; the layout is remembered per group. */
export function bindDrag() {
  const sky = document.getElementById('sky');
  let id = null, frame = 0;
  const svgPoint = (e) => {
    const svg = sky.querySelector('svg');
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };
  sky.onpointerdown = (e) => {
    const g = e.target.closest('.star-g');
    if (!g) return;
    id = g.dataset.id;
    sky.setPointerCapture(e.pointerId);
    sky.classList.add('dragging');
  };
  sky.onpointermove = (e) => {
    if (id === null) return;
    const p = svgPoint(e);
    const layout = store(layoutKey()) || {};
    layout[id] = { x: Math.max(30, Math.min(VIEW.w - 30, p.x)), y: Math.max(VIEW.y0 + 30, Math.min(VIEW.y0 + VIEW.h - 30, p.y)) };
    store(layoutKey(), layout);
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => (sky.innerHTML = constellation('drag')));
  };
  sky.onpointerup = sky.onpointercancel = () => {
    if (id === null) return;
    id = null;
    cancelAnimationFrame(frame);
    sky.classList.remove('dragging');
    sky.innerHTML = constellation('static');
  };
}
