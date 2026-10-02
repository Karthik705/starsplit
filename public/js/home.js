// Landing page: hero, create a group, join by code, recent groups.
import { api } from './api.js';
import { state, enter } from './state.js';
import { CURRENCIES, esc, recent, isoDay } from './util.js';
import { $app, toast, toastError, initSegs } from './ui.js';
import { setNav } from './nav.js';

/** Decorative constellation for the hero: five stars, comets flowing along the debts. */
function heroSky() {
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

const STEPS = [
  ['👥', 'Gather your crew', 'Name the trip, add everyone. Share the 6-letter code, no accounts needed.'],
  ['🧾', 'Log what people pay', 'Split equally, by exact amounts, by percentage or by shares.'],
  ['✨', 'Untangle and settle', 'Starsplit finds the fewest payments that make everyone square.'],
];

export function renderHome() {
  document.title = 'Starsplit · split bills under the stars';
  state.g = null;
  setNav();
  state.anim = true;
  const list = recent.get();
  $app.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow"${enter(0)}>✦ Free · No sign-up · Live sync</span>
        <h1${enter(1)}>Split bills under <em>the stars</em></h1>
        <p${enter(2)}>Every trip becomes a constellation. Add your friends, log what everyone paid, and watch a tangled web of IOUs untangle into the fewest payments possible.</p>
        <div class="hero-cta"${enter(3)}>
          <button class="btn big" id="demo">Try a demo trip</button>
          <a class="btn big gray" href="#create">Start your own</a>
        </div>
      </div>
      <div class="hero-art"${enter(2)}>${heroSky()}</div>
    </section>

    <div class="home-grid">
      <form class="card" id="create"${enter(4)}>
        <h2>New constellation</h2>
        <p class="muted small card-sub">A group for a trip, a flat or a night out.</p>
        <div class="list">
          <label class="row-item"><span class="lbl">Name</span><input name="name" placeholder="Goa trip" maxlength="50" required></label>
          <label class="row-item"><span class="lbl">Currency</span><select name="currency">${CURRENCIES.map((c) => `<option>${c}</option>`).join('')}</select></label>
        </div>
        <div class="section-label">People</div>
        <div class="list" id="member-inputs">
          <label class="row-item"><input placeholder="You" maxlength="24" required aria-label="Person 1" class="left"></label>
          <label class="row-item"><input placeholder="A friend" maxlength="24" required aria-label="Person 2" class="left"></label>
          <button type="button" class="row-item link" id="add-star">＋ Add person</button>
        </div>
        <button class="btn block big" style="margin-top:18px">Launch ✦</button>
      </form>

      <div class="stack">
        <form class="card" id="join"${enter(5)}>
          <h2>Have a code?</h2>
          <p class="muted small card-sub">Join a group a friend shared with you.</p>
          <div class="add-row" style="margin:0">
            <input name="code" placeholder="K7M2QX" maxlength="8" class="code-input" required aria-label="Group code">
            <button class="btn tinted">Join</button>
          </div>
        </form>
        ${list.length ? `<div class="card"${enter(6)}><h2 style="margin-bottom:12px">Recent</h2><div class="list">
          ${list.map((r) => `<a class="recent-link" href="#/g/${esc(r.code)}"><span class="tile-ico" style="--tint:var(--blue)">✦</span><span>${esc(r.name)}</span><span class="muted small mono">${esc(r.code)}</span><span class="chev">›</span></a>`).join('')}</div></div>` : ''}
        <div class="card steps"${enter(7)}>
          <h2 style="margin-bottom:6px">How it works</h2>
          ${STEPS.map(([ico, t, d], i) => `<div class="step"><span class="step-n">${i + 1}</span><div><b>${ico} ${t}</b><p class="muted small">${d}</p></div></div>`).join('')}
        </div>
      </div>
    </div>`;
  state.anim = false;
  initSegs($app);
  bindHome();
}

function bindHome() {
  const inputs = document.getElementById('member-inputs');
  const addBtn = document.getElementById('add-star');
  addBtn.onclick = () => {
    const n = inputs.querySelectorAll('input').length;
    if (n >= 12) return toastError('Up to 12 people');
    const row = document.createElement('label');
    row.className = 'row-item';
    row.style.animation = 'rise 0.5s var(--ease) both';
    row.innerHTML = `<input placeholder="Name" maxlength="24" class="left" aria-label="Person ${n + 1}"><button type="button" class="icon-btn" aria-label="Remove">✕</button>`;
    row.querySelector('button').onclick = () => row.remove();
    inputs.insertBefore(row, addBtn);
    row.querySelector('input').focus();
  };
  // Enter in the last name field adds another person instead of submitting
  inputs.addEventListener('keydown', (e) => {
    const all = [...inputs.querySelectorAll('input')];
    if (e.key === 'Enter' && e.target === all[all.length - 1] && e.target.value.trim()) { e.preventDefault(); addBtn.click(); }
  });

  document.getElementById('create').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('.btn.big');
    btn.disabled = true;
    try {
      const { code } = await api('/groups', 'POST', {
        name: f.name.value,
        currency: f.currency.value,
        members: [...inputs.querySelectorAll('input')].map((i) => i.value),
      });
      location.hash = '#/g/' + code;
    } catch (err) { toastError(err.message); btn.disabled = false; }
  };
  document.getElementById('join').onsubmit = (e) => {
    e.preventDefault();
    location.hash = '#/g/' + e.target.code.value.trim().toUpperCase();
  };
  document.getElementById('demo').onclick = createDemo;
  $app.querySelector('a[href="#create"]').onclick = (e) => {
    e.preventDefault();
    document.getElementById('create').scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => document.querySelector('#create input').focus({ preventScroll: true }), 400);
  };
}

async function createDemo() {
  const btn = document.getElementById('demo');
  btn.disabled = true;
  btn.textContent = 'Lighting up the sky…';
  try {
    const { code } = await api('/groups', 'POST', { name: 'Goa Trip', currency: 'INR', members: ['Aarav', 'Meera', 'Rohan', 'Isha', 'Kabir'] });
    const { members } = await api('/groups/' + code);
    const [a, m, r, i, k] = members.map((x) => x.id);
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return isoDay(d); };
    const add = (description, amount, paidBy, split, category, date, splitType = 'equal') =>
      api(`/groups/${code}/expenses`, 'POST', { description, amount, paidBy, category, date, splitType, split: Object.fromEntries(split.map(([id, v]) => [id, v ?? 1])) });
    const all = [a, m, r, i, k].map((id) => [id]);
    await add('Beach villa (3 nights)', 18000, a, all, 'stay', day(5));
    await add('Airport cab', 2100, r, all, 'travel', day(5));
    await add('Seafood dinner', 4200, m, [[a], [m], [r], [i]], 'food', day(4));
    await add('Scooter rentals', 2400, r, [[r], [i], [k]], 'travel', day(3));
    await add('Water sports', 6500, i, [[a], [m], [i], [k]], 'fun', day(3));
    await add('Groceries', 1800, k, [[a], [r], [k]], 'groceries', day(2));
    await add('Bar tab (Kabir skipped)', 3600, a, [[a, 1], [m, 1], [r, 2], [i, 1]], 'fun', day(2), 'shares');
    await add('Farewell brunch', 5000, m, [[a, 40], [m, 20], [r, 20], [i, 20]], 'food', day(0), 'percent');
    location.hash = '#/g/' + code;
    toast('Demo trip ready. Try the Untangled toggle ✦');
  } catch (err) { toastError(err.message); btn.disabled = false; btn.textContent = 'Try a demo trip'; }
}
