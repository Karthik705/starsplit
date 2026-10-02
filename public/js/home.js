// Home (logged in): your groups, create a group, join by code.
import { api } from './api.js';
import { state, enter } from './state.js';
import { CURRENCIES, esc, isoDay, niceDate } from './util.js';
import { $app, toast, toastError } from './ui.js';
import { setNav } from './nav.js';

/** Money in a group's own currency (the dashboard spans many groups). */
const groupMoney = (cents, currency) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: cents >= 1e8 ? 'compact' : 'standard' }).format(cents / 100);

function groupCard(g, i) {
  return `<a class="group-card card" href="#/g/${esc(g.code)}"${enter(3 + Math.min(i, 8))}>
    <span class="tile-ico" style="--tint:var(--blue)">✦</span>
    <div class="group-card-text"><b>${esc(g.name)}</b>
      <span class="muted small">${g.people} people${g.last_activity ? ` · active ${niceDate(g.last_activity)}` : ''}</span></div>
    <span class="group-card-total">${groupMoney(g.total_cents, g.currency)}</span>
  </a>`;
}

export async function renderHome() {
  document.title = 'Your groups · Starsplit';
  state.g = null;
  setNav();
  let groups = [];
  try { groups = (await api('/me/groups')).groups; } catch (err) { return toastError(err.message); }
  const first = state.user.name.split(' ')[0];
  state.anim = true;
  $app.innerHTML = `
    <header class="dash-head">
      <div>
        <p class="muted"${enter(0)}>Hi ${esc(first)} 👋</p>
        <h1 class="large"${enter(1)}>Your constellations</h1>
      </div>
      <button class="btn tinted" id="demo"${enter(2)}>✦ Try a demo trip</button>
    </header>

    <div class="home-grid">
      <section${enter(2)}>
        ${groups.length
          ? `<div class="group-cards">${groups.map(groupCard).join('')}</div>`
          : `<div class="card empty"><span class="big-emoji">🌌</span><b>No groups yet</b><br>Create one below, join with a friend’s code, or try the demo.</div>`}

        <form class="card" id="create" style="margin-top:20px">
          <h2>New constellation</h2>
          <p class="muted small card-sub">A group for a trip, a flat or a night out.</p>
          <div class="list">
            <label class="row-item"><span class="lbl">Name</span><input name="name" placeholder="Goa trip" maxlength="50" required></label>
            <label class="row-item"><span class="lbl">Currency</span><select name="currency">${CURRENCIES.map((c) => `<option>${c}</option>`).join('')}</select></label>
          </div>
          <div class="section-label">People</div>
          <div class="list" id="member-inputs">
            <label class="row-item"><input value="${esc(first)}" placeholder="You" maxlength="24" required aria-label="Person 1" class="left"></label>
            <label class="row-item"><input placeholder="A friend" maxlength="24" required aria-label="Person 2" class="left"></label>
            <button type="button" class="row-item link" id="add-star">＋ Add person</button>
          </div>
          <button class="btn block big" style="margin-top:18px">Launch ✦</button>
        </form>
      </section>

      <div class="stack">
        <form class="card" id="join"${enter(4)}>
          <h2>Have a code?</h2>
          <p class="muted small card-sub">Join a group a friend shared with you.</p>
          <div class="add-row" style="margin:0">
            <input name="code" placeholder="K7M2QX" maxlength="8" class="code-input" required aria-label="Group code">
            <button class="btn tinted">Join</button>
          </div>
        </form>
        <div class="card steps"${enter(5)}>
          <h2 style="margin-bottom:6px">Tips</h2>
          <div class="step"><span class="step-n">1</span><div><b>Invite friends</b><p class="muted small">Open a group and tap “Copy link”. Anyone with an account can join.</p></div></div>
          <div class="step"><span class="step-n">2</span><div><b>Untangle</b><p class="muted small">Flip the constellation to “Untangled” for the fewest payments.</p></div></div>
          <div class="step"><span class="step-n">3</span><div><b>Mark paid</b><p class="muted small">Record settlements as they happen until everyone is square.</p></div></div>
        </div>
      </div>
    </div>`;
  state.anim = false;
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
  } catch (err) { toastError(err.message); btn.disabled = false; btn.textContent = '✦ Try a demo trip'; }
}
