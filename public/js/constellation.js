// The debt constellation: an SVG of stars (people) and glowing debts between them.
//
// It renders a "view" ({ members, net, debts, expenses }): normally the live group state,
// or a frame from the time machine. In the Untangled mode, when the optimal plan splits
// people into independent circles, each circle becomes its own sub-constellation.
import { state, memberOf } from './state.js';
import { esc, money, store, initial, reduceMotion, plural } from './util.js';

const VIEW = { x0: 0, y0: 20, w: 420, h: 380, cx: 210, cy: 210, R: 140 };
const NEBULA = ['#5e5ce6', '#ff9f0a', '#30d158', '#ff375f', '#64d2ff', '#bf5af2'];

let frame = null; // a time-machine frame, or null for the live state
let lastPos = null; // where stars were last drawn, for the glide animation
let tween = 0;

export const currentView = () => frame || state.g;
export const setFrame = (v) => (frame = v);
export const layoutKey = () => 'starsplit:layout:' + state.g.group.code;

const edgesOf = (v) => (state.mode === 'raw' ? v.debts.raw : v.debts.simplified);
const showCircles = (v) => state.mode === 'simplified' && v.debts.circles.length >= 2;

/** The ring layout (or wherever the person dragged the stars to). */
function ringLayout(v) {
  const saved = store(layoutKey()) || {};
  const pos = {};
  v.members.forEach((m, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / v.members.length;
    pos[m.id] = saved[m.id] || { x: VIEW.cx + VIEW.R * Math.cos(a), y: VIEW.cy + VIEW.R * Math.sin(a) };
  });
  return { pos, clusters: [] };
}

/**
 * Untangled layout: each circle of the optimal plan gets its own small ring, the rings are
 * spread around the sky, and people who are already settled sit together at the bottom.
 */
function circleLayout(v) {
  const settled = v.members.filter((m) => !v.net[m.id]).map((m) => m.id);
  const groups = v.debts.circles.map((ids, i) => ({ ids, color: NEBULA[i % NEBULA.length] }));
  const n = groups.length;
  const spread = n === 2 ? 102 : 118;
  const pos = {};
  const clusters = groups.map((g, i) => {
    const a = n === 2 ? Math.PI * i + Math.PI : -Math.PI / 2 + (2 * Math.PI * i) / n;
    const cx = VIEW.cx + spread * Math.cos(a), cy = VIEW.cy - (settled.length ? 14 : 0) + spread * 0.8 * Math.sin(a);
    const r = g.ids.length === 2 ? 62 : Math.min(78, 30 + 12 * g.ids.length);
    g.ids.forEach((id, k) => {
      const b = -Math.PI / 2 + (2 * Math.PI * k) / g.ids.length + (g.ids.length === 2 ? Math.PI / 2 : 0);
      // `a` points away from the circle's centre, so the name sits on the outside
      pos[id] = { x: cx + r * Math.cos(b), y: cy + r * Math.sin(b), a: b };
    });
    return { ...g, cx, cy, r: r + 34 };
  });
  settled.forEach((id, k) => {
    pos[id] = { x: VIEW.cx + (k - (settled.length - 1) / 2) * 56, y: VIEW.y0 + VIEW.h - 26, a: Math.PI / 2 };
  });
  return { pos, clusters };
}

const layout = (v) => (showCircles(v) ? circleLayout(v) : ringLayout(v));

const overlap = (a, b) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Place each amount label somewhere along its line where it collides least
 * with labels already placed and with the stars themselves.
 */
function placeLabels(edges, pos, radius) {
  const starBoxes = Object.entries(pos).map(([id, p]) => {
    const r = (radius[id] || 12) + 6;
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
 *        'drag'   -> no animation at all (dragging, gliding, replaying)
 *        'static' -> stars and lines appear immediately, comets keep flowing
 * opts.pos overrides star positions; opts.bare hides debts (used while stars glide).
 */
export function constellation(phase = 'static', opts = {}) {
  const v = currentView();
  const { members, net } = v;
  const edges = opts.bare ? [] : edgesOf(v);
  const lay = layout(v);
  const pos = opts.pos || lay.pos;
  if (!opts.pos) lastPos = pos;
  const maxEdge = Math.max(1, ...edges.map((e) => e.amount_cents));
  const maxNet = Math.max(1, ...Object.values(net).map(Math.abs));
  const radius = Object.fromEntries(members.map((m) => [m.id, 12 + 8 * (Math.abs(net[m.id] || 0) / maxNet)]));
  const labels = placeLabels(edges, pos, radius);
  const drawEdges = phase === 'first' || phase === 'toggle';

  const nebulae = !opts.bare && !opts.pos ? lay.clusters.map((c, i) => `
    <g class="nebula${drawEdges ? ' fade-in' : ''}" style="--i:${i}" data-tip="These ${c.ids.length} people can settle among themselves">
      <circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" fill="url(#neb${i})"/>
      <text class="nebula-label" x="${c.cx}" y="${c.cy + c.r + 2}" fill="${c.color}">Circle ${i + 1}</text>
    </g>`).join('') : '';
  const defs = lay.clusters.map((c, i) => `<radialGradient id="neb${i}"><stop offset="0" stop-color="${c.color}" stop-opacity="0.22"/><stop offset="0.7" stop-color="${c.color}" stop-opacity="0.08"/><stop offset="1" stop-color="${c.color}" stop-opacity="0"/></radialGradient>`).join('');

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
        <animateMotion dur="${(2.6 + (i % 3) * 0.4).toFixed(1)}s" begin="-${(k * 1.3).toFixed(1)}s" repeatCount="indefinite" path="M${p.x} ${p.y} L${t.x} ${t.y}"/></circle>`).join('');
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
    const val = net[m.id] || 0;
    const r = radius[m.id];
    const ring = val > 0 ? 'var(--green)' : val < 0 ? 'var(--red)' : 'transparent';
    const a = p.a ?? Math.atan2(p.y - VIEW.cy, p.x - VIEW.cx);
    const c = Math.cos(a);
    const anchor = c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle';
    const lx = p.x + (anchor === 'middle' ? 0 : Math.sign(c) * (r + 14));
    const ly = anchor === 'middle' ? p.y + Math.sign(Math.sin(a) || 1) * (r + 20) + 4 : p.y + 4;
    const status = val > 0 ? `is owed ${money(val)}` : val < 0 ? `owes ${money(-val)}` : 'is settled';
    const hot = opts.hot === m.id ? ' hot' : '';
    return `<g class="star-g${phase === 'first' ? ' pop' : ''}${val ? '' : ' settled'}${hot}" style="--i:${i}" data-id="${m.id}" data-tip="${esc(m.name)} ${status}">
      <circle class="halo" cx="${p.x}" cy="${p.y}" r="${r + 10}" fill="${m.color}" opacity="0.16"/>
      <circle cx="${p.x}" cy="${p.y}" r="${r + 4}" fill="none" stroke="${ring}" stroke-width="2" opacity="0.9"/>
      <circle class="core" cx="${p.x}" cy="${p.y}" r="${r}" fill="${m.color}"/>
      <text class="initial" x="${p.x}" y="${p.y + 4}">${initial(m.name)}</text>
      <text class="star-name" style="text-anchor:${anchor}" x="${lx}" y="${ly}">${esc(m.name)}</text>
    </g>`;
  }).join('');

  const empty = edges.length || opts.bare ? '' : `<text class="all-square" x="${VIEW.cx}" y="${VIEW.cy + 6}">${v.expenses.length ? 'All square ✦' : 'No debts yet'}</text>`;
  const desc = edges.map((e) => `${memberOf(e.from).name} owes ${memberOf(e.to).name} ${money(e.amount_cents)}`).join('. ');
  return `<svg class="constellation" viewBox="${VIEW.x0} ${VIEW.y0} ${VIEW.w} ${VIEW.h}" role="img" aria-label="Debt constellation. ${esc(desc || 'Nobody owes anything.')}">
    <defs>${defs}</defs>${nebulae}${lines}${stars}${empty}</svg>`;
}

/** One line under the sky that explains what it shows. */
export function caption() {
  const v = currentView();
  const raw = v.debts.raw.length, best = v.debts.simplified.length;
  if (!raw && !best) return v.expenses.length ? 'Everyone is square ✨' : 'No debts yet. Add an expense to see the sky change.';
  if (state.mode === 'raw') return `${plural(raw, 'payment')} if everyone paid back directly. Flip to Untangled.`;
  const parts = [`Only ${plural(best, 'payment')} needed, the proven minimum`];
  if (v.debts.circles.length >= 2) parts.push(`${v.debts.circles.length} circles settle independently`);
  return parts.join(' · ');
}

/** Extra line comparing against the usual greedy approach, when we actually beat it. */
export function greedyNote() {
  const v = currentView();
  const { greedyCount, simplified } = v.debts;
  if (state.mode !== 'simplified' || greedyCount <= simplified.length) return '';
  return `A typical greedy split would need ${greedyCount}. Starsplit searched every way to split the group into circles and found ${simplified.length}.`;
}

/** Glide the stars from where they were to where the current mode wants them, then draw the debts. */
export function glideTo(sky, done) {
  const from = lastPos;
  const to = layout(currentView()).pos;
  const moves = from && Object.keys(to).some((id) => from[id] && (Math.abs(from[id].x - to[id].x) > 1 || Math.abs(from[id].y - to[id].y) > 1));
  cancelAnimationFrame(tween);
  if (!moves || reduceMotion) { sky.innerHTML = constellation('toggle'); return done?.(); }
  const t0 = performance.now(), dur = 750;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const step = (now) => {
    const k = ease(Math.min(1, (now - t0) / dur));
    const pos = {};
    for (const id of Object.keys(to)) {
      const a = from[id] || to[id];
      pos[id] = { x: a.x + (to[id].x - a.x) * k, y: a.y + (to[id].y - a.y) * k, a: k < 0.5 ? a.a : to[id].a };
    }
    sky.innerHTML = constellation('drag', { pos, bare: true });
    if (k < 1) tween = requestAnimationFrame(step);
    else { sky.innerHTML = constellation('toggle'); done?.(); }
  };
  tween = requestAnimationFrame(step);
}

/** Drag a star to rearrange the constellation; the ring layout is remembered per group. */
export function bindDrag() {
  const sky = document.getElementById('sky');
  let id = null, raf = 0;
  const svgPoint = (e) => {
    const svg = sky.querySelector('svg');
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };
  sky.onpointerdown = (e) => {
    const g = e.target.closest('.star-g');
    // circles are laid out automatically, so dragging only applies to the ring
    if (!g || showCircles(currentView())) return;
    id = g.dataset.id;
    sky.setPointerCapture(e.pointerId);
    sky.classList.add('dragging');
  };
  sky.onpointermove = (e) => {
    if (id === null) return;
    const p = svgPoint(e);
    const saved = { ...ringLayout(currentView()).pos, ...(store(layoutKey()) || {}) };
    saved[id] = { x: Math.max(30, Math.min(VIEW.w - 30, p.x)), y: Math.max(VIEW.y0 + 30, Math.min(VIEW.y0 + VIEW.h - 30, p.y)) };
    store(layoutKey(), saved);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => (sky.innerHTML = constellation('drag')));
  };
  sky.onpointerup = sky.onpointercancel = () => {
    if (id === null) return;
    id = null;
    cancelAnimationFrame(raf);
    sky.classList.remove('dragging');
    sky.innerHTML = constellation('static');
  };
}
