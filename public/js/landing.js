// Public landing page, shown when nobody is logged in.
import { state, enter } from './state.js';
import { $app } from './ui.js';
import { setNav } from './nav.js';

/** Decorative constellation: five stars, comets flowing along the debts. */
export function heroSky() {
  const stars = [
    { x: 160, y: 46, c: '#0a84ff', n: 'A' }, { x: 272, y: 128, c: '#ff9f0a', n: 'M' },
    { x: 228, y: 252, c: '#30d158', n: 'R' }, { x: 92, y: 252, c: '#ff375f', n: 'I' }, { x: 48, y: 128, c: '#bf5af2', n: 'K' },
  ];
  const edges = [[4, 0], [3, 0], [1, 0], [3, 2], [4, 3]];
  const lines = edges.map(([a, b], i) => {
    const p = stars[a], t = stars[b];
    return `<line x1="${p.x}" y1="${p.y}" x2="${t.x}" y2="${t.y}" stroke="${p.c}" stroke-width="2" opacity="0.5"/>
      <circle r="3" fill="${p.c}"><animateMotion dur="${2.4 + (i % 3) * 0.5}s" repeatCount="indefinite" path="M${p.x} ${p.y} L${t.x} ${t.y}"/></circle>`;
  }).join('');
  const dots = stars.map((s, i) => `<g class="hero-star" style="--i:${i}">
      <circle cx="${s.x}" cy="${s.y}" r="26" fill="${s.c}" opacity="0.16" class="halo"/>
      <circle cx="${s.x}" cy="${s.y}" r="17" fill="${s.c}"/>
      <text x="${s.x}" y="${s.y + 5}" class="initial">${s.n}</text></g>`).join('');
  return `<svg class="hero-sky" viewBox="0 0 320 300" aria-hidden="true">${lines}${dots}</svg>`;
}

const FEATURES = [
  ['🪢', 'The provably fewest payments', 'Most apps settle up greedily. Starsplit searches every way your group splits into self-settling circles and finds the true minimum.', 'var(--blue)'],
  ['➗', 'Split any way', 'Equally, exact amounts, percentages or shares, with live previews that always add up to the cent.', 'var(--purple)'],
  ['⚡', 'Live with friends', 'Share a 6-letter code. Everyone sees changes instantly, on any device.', 'var(--orange)'],
  ['⏪', 'A time machine for the trip', 'Replay the ledger and watch the debts form day by day, then hand out Wrapped awards like “The Backbone”.', 'var(--green)'],
];

const STEPS = [
  ['Create an account', 'Your groups are saved to it and follow you to any device.'],
  ['Start a group, invite friends', 'Name the trip, add people, share the code.'],
  ['Log expenses, then settle', 'Tap “Untangled” and mark payments as they happen.'],
];

export function renderLanding() {
  document.title = 'Starsplit · split bills under the stars';
  state.g = null;
  setNav();
  state.anim = true;
  $app.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow"${enter(0)}>✦ Free · Live sync · Built for trips</span>
        <h1${enter(1)}>Split bills under <em>the stars</em></h1>
        <p${enter(2)}>Every trip becomes a constellation. Add your friends, log what everyone paid, and watch a tangled web of IOUs untangle into the fewest payments possible.</p>
        <div class="hero-cta"${enter(3)}>
          <a class="btn big" href="#/signup">Get started, it’s free</a>
          <a class="btn big gray" href="#/login">Log in</a>
        </div>
      </div>
      <div class="hero-art"${enter(2)}>${heroSky()}</div>
    </section>

    <section class="features">
      ${FEATURES.map(([ico, t, d, c], i) => `<div class="card feature" style="--c:${c}"${enter(4 + i)}><span class="feature-ico">${ico}</span><h3>${t}</h3><p class="muted">${d}</p></div>`).join('')}
    </section>

    <section class="card how"${enter(8)}>
      <h2>How it works</h2>
      <div class="how-steps">
        ${STEPS.map(([t, d], i) => `<div class="step"><span class="step-n">${i + 1}</span><div><b>${t}</b><p class="muted small">${d}</p></div></div>`).join('')}
      </div>
    </section>

    <section class="cta-band"${enter(9)}>
      <h2>Ready for your next trip?</h2>
      <a class="btn big" href="#/signup">Create your free account</a>
    </section>`;
  state.anim = false;
}
