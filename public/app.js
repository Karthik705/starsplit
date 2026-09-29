// Starsplit front end: vanilla JS, hash routing, no build step.
const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const $modal = document.getElementById('modal');
const $toast = document.getElementById('toast');
const $tip = document.getElementById('tip');

const CATEGORIES = { food: '🍜', stay: '🏠', travel: '🚕', fun: '🎟️', groceries: '🛒', other: '✨' };
const catColor = (c) => `var(--c-${c})`;
const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD'];
const SPLIT_LABELS = { equal: 'Equal', exact: 'Exact', percent: '%', shares: 'Shares' };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let S = null; // current group state from the API
let mode = 'raw'; // constellation view: 'raw' (tangled) | 'simplified' (untangled)
let tab = 'sky'; // 'sky' | 'insights' | 'wrapped'
let events = null; // EventSource for live sync
let A = false; // when true, the markup being built plays its entrance animations
let shownTotal = 0; // last total shown, so the counter animates from it

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const localToday = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const niceDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const enter = (i = 0) => (A ? ` data-enter style="--i:${i}"` : '');

function fmt(cents, opts = {}) {
  const cur = S?.group.currency || 'USD';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, ...opts }).format(cents / 100);
}
const money = (c) => fmt(c);
const short = (c) => fmt(c, { notation: 'compact', maximumFractionDigits: 1 });

/** Largest-remainder split, mirrors balance.js so previews match what the server stores. */
function allocate(total, weights) {
  const s = sum(weights);
  if (!(s > 0)) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / s);
  const out = raw.map(Math.floor);
  const left = total - sum(out);
  raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i], k) => { if (k < left) out[i]++; });
  return out;
}

async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  $toast.textContent = msg;
  $toast.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($toast.className = ''), 2600);
}

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage unavailable, fine */ }
  return null;
}
const recent = {
  get: () => store('starsplit:recent') || [],
  add(code, name) { store('starsplit:recent', [{ code, name }, ...this.get().filter((r) => r.code !== code)].slice(0, 6)); },
};

const memberOf = (id) => S.members.find((m) => m.id === id);
const avatar = (m, cls = '') => `<span class="avatar ${cls}" style="--c:${m.color}">${esc(m.name.trim()[0]?.toUpperCase() || '?')}</span>`;

/** Wrap a DOM update in a cross-fade / slide using the View Transitions API when available. */
function transition(fn) {
  if (document.startViewTransition && !reduceMotion) document.startViewTransition(fn);
  else fn();
}

// shared hover tooltip: any element with data-tip shows its text
document.addEventListener('mousemove', (e) => {
  const t = e.target.closest?.('[data-tip]');
  if (!t) return void ($tip.className = '');
  showTip(t.dataset.tip, e.clientX, e.clientY);
});
function showTip(text, x, y) {
  $tip.textContent = text;
  $tip.className = 'show';
  const w = $tip.offsetWidth;
  $tip.style.left = Math.min(x + 14, innerWidth - w - 8) + 'px';
  $tip.style.top = y + 16 + 'px';
}
const hideTip = () => ($tip.className = '');

/** Animate a number from `from` to `to` (in cents) with an ease-out curve. */
function countTo(el, from, to) {
  if (!el) return;
  if (reduceMotion || from === to) { el.textContent = money(to); return; }
  const t0 = performance.now(), dur = 900;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    el.textContent = money(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 4))));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- segmented controls with a sliding thumb ----------
function placeThumb(seg) {
  const on = seg.querySelector('button.on');
  const thumb = seg.querySelector('.thumb');
  if (!on || !thumb) return;
  thumb.style.width = on.offsetWidth + 'px';
  thumb.style.transform = `translateX(${on.offsetLeft}px)`;
}
function initSegs(root = document) {
  root.querySelectorAll('.seg').forEach((seg) => {
    if (!seg.querySelector('.thumb')) seg.insertAdjacentHTML('afterbegin', '<span class="thumb"></span>');
    placeThumb(seg);
    if (!seg.classList.contains('ready')) requestAnimationFrame(() => requestAnimationFrame(() => seg.classList.add('ready')));
  });
}
function selectSeg(seg, btn) {
  seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
  placeThumb(seg);
}
addEventListener('resize', () => initSegs());

// ---------- theme + navigation bar ----------
const sunSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const moonSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';

function setNav({ back = false, title = '' } = {}) {
  $nav.innerHTML = `<div class="nav-inner">
    ${back ? '<a class="nav-btn" href="#"><svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2 2 10l8 8"/></svg>Groups</a>' : '<span></span>'}
    <div class="nav-title" id="nav-title">${esc(title)}</div>
    <button class="nav-btn icon" id="theme" aria-label="Switch between light and dark mode">${isDark() ? sunSvg : moonSvg}</button>
  </div>`;
  document.getElementById('theme').onclick = () => {
    const next = isDark() ? 'light' : 'dark';
    transition(() => {
      document.documentElement.dataset.theme = next;
      store('starsplit:theme', next);
      document.getElementById('theme').innerHTML = next === 'dark' ? sunSvg : moonSvg;
    });
  };
}
addEventListener('scroll', () => $nav.classList.toggle('scrolled', scrollY > 6), { passive: true });

let titleObserver;
function watchLargeTitle() {
  titleObserver?.disconnect();
  const h = $app.querySelector('h1.large');
  const t = document.getElementById('nav-title');
  if (!h || !t || !('IntersectionObserver' in window)) return;
  titleObserver = new IntersectionObserver(([e]) => t.classList.toggle('show', !e.isIntersecting), { rootMargin: '-56px 0px 0px 0px' });
  titleObserver.observe(h);
}

// ---------- router + live sync ----------
addEventListener('hashchange', route);
route();

async function route() {
  events?.close();
  events = null;
  scrollTo(0, 0);
  const match = location.hash.match(/^#\/g\/([A-Za-z0-9]+)(?:\/(insights|wrapped))?/);
  if (!match) { S = null; return transition(renderHome); }
  tab = match[2] || 'sky';
  try {
    const next = await api('/groups/' + match[1]);
    transition(() => {
      S = next;
      shownTotal = 0;
      recent.add(S.group.code, S.group.name);
      renderGroup();
    });
    connectLive(next.group.code);
  } catch (err) {
    toast(err.message, true);
    location.hash = '';
  }
}

function connectLive(code) {
  events = new EventSource(`/api/groups/${code}/events`);
  const live = () => document.getElementById('live');
  events.onopen = () => live()?.classList.remove('off');
  events.onerror = () => live()?.classList.add('off');
  events.onmessage = async () => {
    try {
      const next = await api('/groups/' + code);
      if (JSON.stringify(next) === JSON.stringify(S)) return; // our own change, already rendered
      S = next;
      const typing = document.activeElement?.closest?.('#app form') && document.activeElement.value;
      if (!$modal.open && !typing) { refresh(); toast('Updated by a friend ✦'); }
    } catch { /* offline */ }
  };
}

// ---------- home ----------
function renderHome() {
  document.title = 'Starsplit — split bills under the stars';
  setNav();
  titleObserver?.disconnect();
  A = true;
  const list = recent.get();
  $app.innerHTML = `
    <section class="hero">
      <div class="app-icon">✦</div>
      <h1>Split bills under <em>the stars</em></h1>
      <p>Every trip becomes a constellation. Add your friends, log what everyone paid, and watch a tangled web of IOUs untangle into the fewest payments possible.</p>
      <button class="btn big" id="demo">Try the demo</button>
    </section>
    <div class="home-grid">
      <form class="card" id="create"${enter(1)}>
        <h2 style="margin-bottom:14px">New constellation</h2>
        <div class="list">
          <label class="row-item"><span class="lbl">Name</span><input name="name" placeholder="Goa trip" maxlength="50" required></label>
          <label class="row-item"><span class="lbl">Currency</span><select name="currency">${CURRENCIES.map((c) => `<option>${c}</option>`).join('')}</select></label>
        </div>
        <div class="section-label">People</div>
        <div class="list" id="member-inputs">
          <label class="row-item"><input placeholder="Name" maxlength="24" required style="text-align:left"></label>
          <label class="row-item"><input placeholder="Name" maxlength="24" required style="text-align:left"></label>
          <div class="row-item link" id="add-star" role="button" tabindex="0">＋ Add person</div>
        </div>
        <button class="btn block big" style="margin-top:18px">Launch</button>
      </form>
      <div class="stack">
        <form class="card" id="join"${enter(2)}>
          <h2 style="margin-bottom:14px">Have a code?</h2>
          <div class="add-row" style="margin:0">
            <input name="code" placeholder="K7M2QX" maxlength="8" style="text-transform:uppercase;letter-spacing:.14em" required>
            <button class="btn tinted">Join</button>
          </div>
        </form>
        ${list.length ? `<div class="card"${enter(3)}><h2 style="margin-bottom:10px">Recent</h2><div class="list">
          ${list.map((r) => `<a class="recent-link" href="#/g/${esc(r.code)}"><span class="tile-ico" style="--tint:var(--blue)">✦</span><span>${esc(r.name)}</span><span class="muted small">${esc(r.code)}</span></a>`).join('')}</div></div>` : ''}
      </div>
    </div>`;
  A = false;

  const inputs = document.getElementById('member-inputs');
  const addStar = () => {
    if (inputs.querySelectorAll('input').length >= 12) return toast('Up to 12 people', true);
    const row = document.createElement('label');
    row.className = 'row-item';
    row.style.animation = 'rise 0.5s var(--ease) both';
    row.innerHTML = '<input placeholder="Name" maxlength="24" style="text-align:left">';
    inputs.insertBefore(row, document.getElementById('add-star'));
    row.querySelector('input').focus();
  };
  document.getElementById('add-star').onclick = addStar;
  document.getElementById('add-star').onkeydown = (e) => e.key === 'Enter' && addStar();
  document.getElementById('create').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('.btn');
    btn.disabled = true;
    try {
      const { code } = await api('/groups', 'POST', {
        name: f.name.value,
        currency: f.currency.value,
        members: [...inputs.querySelectorAll('input')].map((i) => i.value),
      });
      location.hash = '#/g/' + code;
    } catch (err) { toast(err.message, true); btn.disabled = false; }
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
  try {
    const { code } = await api('/groups', 'POST', { name: 'Goa Trip', currency: 'INR', members: ['Aarav', 'Meera', 'Rohan', 'Isha', 'Kabir'] });
    const { members } = await api('/groups/' + code);
    const [a, m, r, i, k] = members.map((x) => x.id);
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
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
  } catch (err) { toast(err.message, true); btn.disabled = false; }
}

// ---------- group page ----------
/** Full render of the group shell. Called when entering a group. */
function renderGroup() {
  document.title = `${S.group.name} · Starsplit`;
  const { group } = S;
  setNav({ back: true, title: group.name });
  A = true;
  $app.innerHTML = `
    <h1 class="large"${enter(0)}>${esc(group.name)}</h1>
    <div class="meta"${enter(1)}>
      <button class="code-chip" id="copy" title="Copy invite link">Code <strong>${esc(group.code)}</strong> · copy link</button>
      <span class="live off" id="live" title="Changes from friends appear instantly"><i></i> Live</span>
    </div>
    <div class="summary"${enter(2)}>
      <div><div class="muted small">Spent together</div><div class="big" id="stat-total">${money(0)}</div></div>
      <div class="stars-count"><b id="stat-stars">${S.members.length}</b><span class="muted small">stars</span></div>
    </div>
    <nav class="tabs">
      <div class="seg" id="tabs" role="tablist">
        ${[['sky', 'Sky'], ['insights', 'Insights'], ['wrapped', 'Wrapped']]
          .map(([k, l]) => `<button role="tab" data-tab="${k}" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}">${l}</button>`).join('')}
      </div>
    </nav>
    <div id="panel" class="panel"></div>`;
  A = false;

  if (events?.readyState === 1) document.getElementById('live').classList.remove('off');
  document.getElementById('copy').onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); toast('Invite link copied'); }
    catch { toast('Share code: ' + group.code); }
  };
  document.getElementById('tabs').onclick = (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b || b.dataset.tab === tab) return;
    tab = b.dataset.tab;
    history.replaceState(null, '', `#/g/${S.group.code}${tab === 'sky' ? '' : '/' + tab}`);
    selectSeg(e.currentTarget, b);
    e.currentTarget.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', x === b));
    transition(() => renderPanel(true));
  };
  initSegs($app);
  watchLargeTitle();
  countTo(document.getElementById('stat-total'), 0, S.totalSpent);
  shownTotal = S.totalSpent;
  renderPanel(true);
}

/** Light update after data changes: keeps the shell, counts numbers up, re-renders the panel. */
function refresh() {
  if (!document.getElementById('panel')) return renderGroup();
  countTo(document.getElementById('stat-total'), shownTotal, S.totalSpent);
  shownTotal = S.totalSpent;
  document.getElementById('stat-stars').textContent = S.members.length;
  renderPanel(false);
}

function renderPanel(anim) {
  hideTip();
  const panel = document.getElementById('panel');
  A = anim;
  if (tab === 'sky') panel.innerHTML = skyHTML();
  else if (tab === 'insights') panel.innerHTML = insightsHTML();
  else panel.innerHTML = wrappedHTML();
  A = false;
  if (tab === 'sky') bindSky(anim);
  else if (tab === 'insights') bindInsights();
  else bindWrapped();
  initSegs(panel);
}

async function mutate(path, method, body, okMsg) {
  const wasOpen = S.debts.simplified.length > 0;
  const before = new Set(S.expenses.map((e) => e.id));
  try {
    S = await api(path, method, body);
    refresh();
    toast(okMsg);
    S.expenses.filter((e) => !before.has(e.id)).forEach((e) => document.querySelector(`.exp[data-id="${e.id}"]`)?.classList.add('fresh'));
    if (wasOpen && !S.debts.simplified.length && S.expenses.length) { burst(); toast('Everyone is square! ✦'); }
    return true;
  } catch (err) { toast(err.message, true); return false; }
}

function burst() {
  for (let i = 0; i < 44; i++) {
    const s = document.createElement('span');
    s.className = 'spark';
    s.textContent = '✦';
    const ang = Math.random() * Math.PI * 2, dist = 120 + Math.random() * 280;
    s.style.cssText = `--dx:${Math.cos(ang) * dist}px;--dy:${Math.sin(ang) * dist - 80}px;color:${['#ffcc00', '#ff2d55', '#34c759', '#5ac8fa', '#af52de', '#ff9500'][i % 6]};font-size:${10 + Math.random() * 20}px`;
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1700);
  }
}

// ---------- tab: sky ----------
function skyHTML() {
  const { members, expenses, net } = S;
  return `
    <div class="layout">
      <div class="col">
        <section class="card"${enter(0)}>
          <div class="card-head">
            <h2>The constellation</h2>
            <div class="seg" id="mode-seg" role="group" aria-label="Debt view">
              <button data-mode="raw" class="${mode === 'raw' ? 'on' : ''}">Tangled</button>
              <button data-mode="simplified" class="${mode === 'simplified' ? 'on' : ''}">Untangled</button>
            </div>
          </div>
          <div id="sky">${constellation(A ? 'first' : 'static')}</div>
          <p class="sky-caption"><span id="caption">${caption()}</span><br><span class="muted small">Drag the stars to rearrange · <button class="linkish" id="reset-layout">reset</button></span></p>
          <div class="pay-list" id="pay-list">${payList()}</div>
          ${S.debts.simplified.length ? `<button class="btn tinted sm" id="copy-plan" style="margin-top:12px">Copy settle-up message</button>` : ''}
        </section>

        <section class="card"${enter(1)}>
          <h2 style="margin-bottom:6px">Balances</h2>
          ${members.map((m) => {
            const v = net[m.id];
            return `<div class="balance">${avatar(m)}<span class="name">${esc(m.name)}</span>
              <span class="amt ${v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted'}">${v > 0 ? '+' : v < 0 ? '−' : ''}${v ? money(Math.abs(v)) : 'Settled'}</span></div>`;
          }).join('')}
          <form class="add-row" id="add-member">
            <input name="name" placeholder="Add someone new" maxlength="24" required>
            <button class="btn tinted">Add</button>
          </form>
        </section>
      </div>

      <section class="card"${enter(2)}>
        <div class="card-head">
          <h2>Expenses</h2>
          <div style="display:flex;gap:8px">
            <button class="btn gray sm" id="export" title="Download as CSV">Export</button>
            <button class="btn sm" id="new-exp">＋ Add</button>
          </div>
        </div>
        ${expenses.length ? expenses.map((e, i) => expenseRow(e, i)).join('') : `<div class="empty"><span class="big-emoji">🌌</span>Nothing yet.<br>Add your first expense to light up the sky.</div>`}
      </section>
    </div>`;
}

function bindSky(first) {
  const seg = document.getElementById('mode-seg');
  seg.onclick = (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || b.dataset.mode === mode) return;
    mode = b.dataset.mode;
    selectSeg(seg, b);
    // collapse the current lines, then draw the new set
    const sky = document.getElementById('sky');
    sky.classList.add('morphing');
    setTimeout(() => {
      sky.classList.remove('morphing');
      sky.innerHTML = constellation('toggle');
      document.getElementById('caption').textContent = caption();
      const pl = document.getElementById('pay-list');
      pl.innerHTML = payList();
      bindPayButtons();
    }, reduceMotion ? 0 : 260);
  };
  document.getElementById('new-exp').onclick = () => openExpenseModal();
  document.getElementById('export').onclick = exportCSV;
  document.getElementById('copy-plan')?.addEventListener('click', copyPlan);
  document.getElementById('reset-layout').onclick = () => { store(layoutKey(), {}); document.getElementById('sky').innerHTML = constellation('toggle'); };
  document.getElementById('add-member').onsubmit = (e) => {
    e.preventDefault();
    mutate(`/groups/${S.group.code}/members`, 'POST', { name: e.target.name.value }, 'Star added');
  };
  $app.querySelectorAll('[data-del]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); deleteExpense(Number(b.dataset.del)); }));
  $app.querySelectorAll('[data-edit]').forEach((row) => {
    const open = () => openExpenseModal(S.expenses.find((x) => x.id === Number(row.dataset.edit)));
    row.onclick = open;
    row.onkeydown = (e) => e.key === 'Enter' && open();
  });
  bindPayButtons();
  bindDrag();
}

async function deleteExpense(id) {
  const row = document.querySelector(`.exp[data-id="${id}"]`);
  row?.classList.add('leaving');
  await new Promise((r) => setTimeout(r, reduceMotion ? 0 : 260));
  if (!(await mutate(`/groups/${S.group.code}/expenses/${id}`, 'DELETE', null, 'Deleted'))) row?.classList.remove('leaving');
}

function bindPayButtons() {
  $app.querySelectorAll('[data-settle]').forEach((b) => (b.onclick = () => {
    const [from, to, amount] = b.dataset.settle.split(',');
    mutate(`/groups/${S.group.code}/settle`, 'POST', { from, to, amount: Number(amount) / 100 }, 'Payment recorded ✦');
  }));
}

function caption() {
  const raw = S.debts.raw.length, simple = S.debts.simplified.length;
  if (!raw && !simple) return S.expenses.length ? 'Everyone is square ✨' : 'No debts yet. Add an expense to see the sky change.';
  if (mode === 'raw') return `${raw} payment${raw === 1 ? '' : 's'} if everyone paid back directly`;
  const saved = raw - simple;
  return `Only ${simple} payment${simple === 1 ? '' : 's'} needed${saved > 0 ? ` — ${saved} fewer!` : ''}`;
}

function payList() {
  const edges = mode === 'raw' ? S.debts.raw : S.debts.simplified;
  return edges.map((d) => {
    const a = memberOf(d.from), b = memberOf(d.to);
    return `<div class="pay"><span class="who">${avatar(a, 'sm')}${esc(a.name)}<span class="arrow">›</span>${avatar(b, 'sm')}${esc(b.name)}</span>
      <span class="right"><b>${money(d.amount_cents)}</b>
      <button class="btn tinted sm" data-settle="${d.from},${d.to},${d.amount_cents}">Mark paid</button></span></div>`;
  }).join('');
}

async function copyPlan() {
  const lines = S.debts.simplified.map((d) => `• ${memberOf(d.from).name} → ${memberOf(d.to).name}: ${money(d.amount_cents)}`);
  const text = `✦ ${S.group.name}: settle-up plan\n${lines.join('\n')}\n\nDetails: ${location.href}`;
  try { await navigator.clipboard.writeText(text); toast('Copied. Paste it in your group chat'); }
  catch { toast('Could not copy', true); }
}

function exportCSV() {
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const head = ['Date', 'Description', 'Category', 'Type', 'Paid by', 'Amount', ...S.members.map((m) => `${m.name} share`)];
  const rows = S.expenses.slice().reverse().map((e) => [
    e.spent_on, e.description, e.category, e.kind, memberOf(e.paid_by).name, (e.amount_cents / 100).toFixed(2),
    ...S.members.map((m) => ((e.splits.find((s) => s.member_id === m.id)?.share_cents || 0) / 100).toFixed(2)),
  ]);
  const csv = [head, ...rows].map((r) => r.map(q).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `${S.group.name.replace(/\W+/g, '-').toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function expenseRow(e, i) {
  const payer = memberOf(e.paid_by);
  const when = niceDate(e.spent_on);
  const anim = A ? ` data-enter style="--i:${Math.min(i, 12) + 3}"` : '';
  if (e.kind === 'payment') {
    const to = memberOf(e.splits[0].member_id);
    return `<div class="exp" data-id="${e.id}"${anim}><span class="tile-ico" style="--tint:var(--green)">🤝</span>
      <div><div class="title">${esc(payer.name)} paid ${esc(to.name)}</div><div class="muted small">${when}</div></div>
      <div class="amt pos">${money(e.amount_cents)}</div><button class="icon-btn" data-del="${e.id}" aria-label="Delete">✕</button></div>`;
  }
  const n = e.splits.length;
  const even = Math.max(...e.splits.map((s) => s.share_cents)) - Math.min(...e.splits.map((s) => s.share_cents)) <= 1;
  const how = n === S.members.length && even ? 'with everyone' : even ? `${n} ways` : 'custom split';
  return `<div class="exp editable" data-id="${e.id}" data-edit="${e.id}" tabindex="0"${anim}><span class="tile-ico" style="--tint:${catColor(e.category)}">${CATEGORIES[e.category] || '✨'}</span>
    <div><div class="title">${esc(e.description)}</div>
    <div class="muted small">${esc(payer.name)} paid · ${how} · ${when}</div></div>
    <div class="amt">${money(e.amount_cents)}</div><button class="icon-btn" data-del="${e.id}" aria-label="Delete">✕</button></div>`;
}

// ---------- the constellation (SVG) ----------
const layoutKey = () => 'starsplit:layout:' + S.group.code;
const VIEW = { x0: 0, y0: 20, w: 420, h: 380, cx: 210, cy: 210, R: 140 };

function positions() {
  const saved = store(layoutKey()) || {};
  const pos = {};
  S.members.forEach((m, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / S.members.length;
    const p = saved[m.id] || { x: VIEW.cx + VIEW.R * Math.cos(a), y: VIEW.cy + VIEW.R * Math.sin(a) };
    pos[m.id] = { x: p.x, y: p.y, a: Math.atan2(p.y - VIEW.cy, p.x - VIEW.cx) };
  });
  return pos;
}

/**
 * phase: 'first'  -> stars pop in, lines draw
 *        'toggle' -> lines draw again (stars stay put)
 *        'drag'   -> no animation at all while dragging
 *        'static' -> stars and lines appear immediately, comets keep flowing
 */
function constellation(phase = 'static') {
  const { members, net } = S;
  const edges = mode === 'raw' ? S.debts.raw : S.debts.simplified;
  const pos = positions();
  const maxEdge = Math.max(1, ...edges.map((e) => e.amount_cents));
  const maxNet = Math.max(1, ...Object.values(net).map(Math.abs));
  const drawEdges = phase === 'first' || phase === 'toggle';

  const lines = edges.map((e, i) => {
    const p = pos[e.from], t = pos[e.to];
    const color = memberOf(e.from).color;
    const w = 1.6 + (3 * e.amount_cents) / maxEdge;
    const dx = t.x - p.x, dy = t.y - p.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const lx = p.x + dx * 0.45, ly = p.y + dy * 0.45;
    const label = money(e.amount_cents);
    const pw = label.length * 6.3 + 14;
    // chevron pointing at the creditor, just before their star
    const ex = t.x - ux * 30, ey = t.y - uy * 30;
    const chev = `${ex + ux * 6},${ey + uy * 6} ${ex - ux * 5 - uy * 5},${ey - uy * 5 + ux * 5} ${ex - ux * 5 + uy * 5},${ey - uy * 5 - ux * 5}`;
    const comets = phase === 'drag' ? '' : [0, 1].map((k) => `<circle class="comet" r="${(w * 0.55 + 1).toFixed(1)}" fill="${color}">
        <animateMotion dur="${(2.6 + (i % 3) * 0.4).toFixed(1)}s" begin="${(k * 1.3).toFixed(1)}s" repeatCount="indefinite" path="M${p.x} ${p.y} L${t.x} ${t.y}"/></circle>`).join('');
    const fade = drawEdges ? ` fade-in" style="--i:${i}` : '';
    return `<line class="edge${drawEdges ? ' draw' : ''}" pathLength="1" style="--i:${i}" x1="${p.x}" y1="${p.y}" x2="${t.x}" y2="${t.y}" stroke="${color}" stroke-width="${w.toFixed(1)}" opacity="0.6"/>
      ${comets}
      <polygon class="chevron${fade}" points="${chev}" fill="${color}"/>
      <rect class="edge-pill${fade}" x="${lx - pw / 2}" y="${ly - 9}" width="${pw}" height="18" rx="9"/>
      <text class="edge-label${fade}" x="${lx}" y="${ly + 4}">${label}</text>`;
  }).join('');

  const stars = members.map((m, i) => {
    const p = pos[m.id];
    const v = net[m.id];
    const r = 12 + 8 * (Math.abs(v) / maxNet);
    const ring = v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'transparent';
    const c = Math.cos(p.a);
    const anchor = c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle';
    const lx = p.x + (anchor === 'middle' ? 0 : Math.sign(c) * (r + 14));
    const ly = anchor === 'middle' ? p.y + Math.sign(Math.sin(p.a) || 1) * (r + 20) + 4 : p.y + 4;
    const state = v > 0 ? `is owed ${money(v)}` : v < 0 ? `owes ${money(-v)}` : 'is settled';
    return `<g class="star-g${phase === 'first' ? ' pop' : ''}" style="--i:${i}" data-id="${m.id}" data-tip="${esc(m.name)} ${state}">
      <circle class="halo" cx="${p.x}" cy="${p.y}" r="${r + 10}" fill="${m.color}" opacity="0.16"/>
      <circle cx="${p.x}" cy="${p.y}" r="${r + 4}" fill="none" stroke="${ring}" stroke-width="2" opacity="0.9"/>
      <circle class="core" cx="${p.x}" cy="${p.y}" r="${r}" fill="${m.color}"/>
      <text class="initial" x="${p.x}" y="${p.y + 4}">${esc(m.name.trim()[0]?.toUpperCase() || '')}</text>
      <text class="star-name" style="text-anchor:${anchor}" x="${lx}" y="${ly}">${esc(m.name)}</text>
    </g>`;
  }).join('');

  const empty = edges.length ? '' : `<text class="all-square" x="${VIEW.cx}" y="${VIEW.cy + 6}">${S.expenses.length ? 'All square ✦' : 'No debts yet'}</text>`;
  return `<svg class="constellation" viewBox="${VIEW.x0} ${VIEW.y0} ${VIEW.w} ${VIEW.h}" role="img" aria-label="Debt constellation">${lines}${stars}${empty}</svg>`;
}

/** Drag a star to rearrange the constellation; the layout is remembered per group. */
function bindDrag() {
  const sky = document.getElementById('sky');
  let id = null;
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
    sky.innerHTML = constellation('drag');
  };
  sky.onpointerup = sky.onpointercancel = () => {
    if (id === null) return;
    id = null;
    sky.classList.remove('dragging');
    sky.innerHTML = constellation('static');
  };
}

// ---------- tab: insights ----------
const realExpenses = () => S.expenses.filter((e) => e.kind === 'expense');

function insightsHTML() {
  const exps = realExpenses();
  if (!exps.length) return `<div class="card empty"><span class="big-emoji">📊</span>No expenses yet. Add a few and the charts will appear here.</div>`;
  return `
    <div class="insights${A ? ' anim' : ''}">
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
function bindInsights() {
  const svg = document.getElementById('timeline')?.querySelector('svg');
  if (!svg) return;
  const cross = svg.querySelector('.cross'), mark = svg.querySelector('.mark');
  svg.onmousemove = (e) => {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 520;
    const p = timelinePts.reduce((best, c) => (Math.abs(c.x - x) < Math.abs(best.x - x) ? c : best));
    cross.setAttribute('x1', p.x); cross.setAttribute('x2', p.x); cross.style.display = '';
    mark.setAttribute('cx', p.x); mark.setAttribute('cy', p.y); mark.style.display = '';
    showTip(`${niceDate(p.date)}\n${money(p.cum)} total · +${money(p.day)} that day`, e.clientX, e.clientY);
  };
  svg.onmouseleave = () => { cross.style.display = mark.style.display = 'none'; hideTip(); };
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
  const stats = S.members.map((m) => ({
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

// ---------- tab: wrapped ----------
function wrappedHTML() {
  const exps = realExpenses();
  if (exps.length < 2) return `<div class="card empty"><span class="big-emoji">🎁</span>Add a couple of expenses to unlock your trip's Wrapped.</div>`;
  const paid = S.members.map((m) => ({ m, v: sum(exps.filter((e) => e.paid_by === m.id).map((e) => e.amount_cents)) }));
  const used = S.members.map((m) => ({ m, v: sum(exps.flatMap((e) => e.splits.filter((s) => s.member_id === m.id).map((s) => s.share_cents))) }));
  const top = (arr) => arr.reduce((a, b) => (b.v > a.v ? b : a));
  const biggest = exps.reduce((a, b) => (b.amount_cents > a.amount_cents ? b : a));
  const cats = {};
  exps.forEach((e) => (cats[e.category] = (cats[e.category] || 0) + e.amount_cents));
  const [favCat, favCatV] = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
  const days = {};
  exps.forEach((e) => (days[e.spent_on] = (days[e.spent_on] || 0) + e.amount_cents));
  const [busyDay, busyV] = Object.entries(days).sort((a, b) => b[1] - a[1])[0];
  const payments = S.expenses.filter((e) => e.kind === 'payment');
  const settler = {};
  payments.forEach((p) => (settler[p.paid_by] = (settler[p.paid_by] || 0) + 1));
  const settlerId = Object.entries(settler).sort((a, b) => b[1] - a[1])[0];
  const square = S.members.reduce((a, m) => (Math.abs(S.net[m.id]) < Math.abs(S.net[a.id]) ? m : a));
  const backbone = top(paid), appetite = top(used);

  const cards = [
    ['🏦', 'The Backbone', backbone.m.name, `fronted ${money(backbone.v)} for the group`, backbone.m.color],
    ['🍴', 'Biggest Appetite', appetite.m.name, `benefited from ${money(appetite.v)} of costs`, appetite.m.color],
    ['💎', 'Priciest Moment', biggest.description, `${money(biggest.amount_cents)} · paid by ${memberOf(biggest.paid_by).name}`, 'var(--purple)'],
    [CATEGORIES[favCat], 'Signature Vibe', favCat[0].toUpperCase() + favCat.slice(1), `${Math.round((favCatV / S.totalSpent) * 100)}% of all spending`, catColor(favCat)],
    ['📅', 'Wildest Day', niceDate(busyDay), `${money(busyV)} spent in one day`, 'var(--orange)'],
    ['🧾', 'Average Expense', money(Math.round(S.totalSpent / exps.length)), `across ${exps.length} expenses`, 'var(--blue)'],
    ['🤝', settlerId ? 'Peacemaker' : 'Closest to Square', settlerId ? memberOf(Number(settlerId[0])).name : square.name,
      settlerId ? `settled up ${settlerId[1]} time${settlerId[1] === 1 ? '' : 's'}` : 'has the smallest balance', 'var(--green)'],
  ];
  return `<div class="wrapped">${cards.map(([ico, label, big, sub, color], i) => `
    <div class="award" style="--c:${color}"${A ? ` data-enter` : ''} ${A ? `data-i="${i}"` : ''}>
      <div class="award-ico">${ico}</div>
      <div class="award-label">${label}</div>
      <div class="award-big">${esc(big)}</div>
      <div class="award-sub">${esc(sub)}</div>
    </div>`).join('')}</div>`;
}

/** Cards tilt toward the pointer, with a soft highlight that follows it. */
function bindWrapped() {
  document.querySelectorAll('.award').forEach((el) => {
    if (el.dataset.i) el.style.setProperty('--i', el.dataset.i);
    if (reduceMotion) return;
    el.onpointermove = (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      el.style.transform = `perspective(700px) rotateY(${(px - 0.5) * 12}deg) rotateX(${(0.5 - py) * 12}deg) translateY(-4px)`;
      el.style.setProperty('--mx', px * 100 + '%');
      el.style.setProperty('--my', py * 100 + '%');
    };
    el.onpointerleave = () => (el.style.transform = '');
  });
}

// ---------- add / edit expense sheet ----------
function closeSheet() {
  if (!$modal.open || $modal.classList.contains('closing')) return;
  if (reduceMotion) return $modal.close();
  $modal.classList.add('closing');
  setTimeout(() => { $modal.close(); $modal.classList.remove('closing'); }, 290);
}
$modal.addEventListener('click', (e) => { if (e.target === $modal) closeSheet(); });
$modal.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });

function openExpenseModal(edit) {
  const { members } = S;
  const inc = {}, vals = { exact: {}, percent: {}, shares: {} }, seeded = {}, touched = {};
  let type = 'equal';

  if (edit) {
    const shares = edit.splits.map((s) => s.share_cents);
    const even = Math.max(...shares) - Math.min(...shares) <= 1;
    type = even ? 'equal' : 'exact';
    edit.splits.forEach((s) => { inc[s.member_id] = true; vals.exact[s.member_id] = (s.share_cents / 100).toFixed(2); });
    if (!even) seeded.exact = touched.exact = true;
  } else members.forEach((m) => (inc[m.id] = true));

  $modal.innerHTML = `
    <form id="exp-form" autocomplete="off">
      <div class="sheet-head">
        <button type="button" class="plain" id="cancel">Cancel</button>
        <h2>${edit ? 'Edit Expense' : 'New Expense'}</h2>
        <button class="plain strong">${edit ? 'Save' : 'Add'}</button>
      </div>
      <div class="sheet-body">
        <div class="list">
          <label class="row-item"><span class="lbl">For</span><input name="description" placeholder="Dinner at the beach shack" maxlength="60" required value="${edit ? esc(edit.description) : ''}"></label>
          <label class="row-item"><span class="lbl">Amount</span><input name="amount" type="number" step="0.01" min="0.01" inputmode="decimal" placeholder="${esc(S.group.currency)}" required value="${edit ? edit.amount_cents / 100 : ''}"></label>
          <label class="row-item"><span class="lbl">Date</span><input name="date" type="date" required value="${edit ? edit.spent_on : localToday()}"></label>
          <label class="row-item"><span class="lbl">Paid by</span><select name="paidBy">${members.map((m) => `<option value="${m.id}" ${edit?.paid_by === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
        </div>
        <div class="section-label">Category</div>
        <div class="cats">
          ${Object.entries(CATEGORIES).map(([k, ico]) => `<label class="cat"><input type="radio" name="category" value="${k}" ${(edit ? edit.category : 'food') === k ? 'checked' : ''}><span><b>${ico}</b>${k}</span></label>`).join('')}
        </div>
        <div class="section-label">Split</div>
        <div class="seg full" id="split-type">${Object.entries(SPLIT_LABELS).map(([k, l]) => `<button type="button" data-type="${k}">${l}</button>`).join('')}</div>
        <div class="list split-list" id="split-rows"></div>
        <p class="split-status" id="split-status"></p>
        ${edit ? `<button type="button" class="btn block" id="del" style="background:color-mix(in srgb,var(--red) 14%,transparent);color:var(--red);margin-top:8px">Delete expense</button>` : ''}
      </div>
    </form>`;
  $modal.classList.remove('closing');
  $modal.showModal();

  const form = document.getElementById('exp-form');
  const rows = document.getElementById('split-rows');
  const status = document.getElementById('split-status');
  const typeSeg = document.getElementById('split-type');
  const totalCents = () => Math.round(Number(form.amount.value) * 100) || 0;
  initSegs($modal);

  function seed() {
    if (type === 'equal' || seeded[type]) return;
    seeded[type] = true;
    const ids = members.filter((m) => inc[m.id]).map((m) => m.id);
    const total = totalCents();
    ids.forEach((id, i) => {
      if (type === 'shares') vals.shares[id] = 1;
      if (type === 'percent') vals.percent[id] = allocate(10000, ids.map(() => 1))[i] / 100;
      if (type === 'exact') vals.exact[id] = (allocate(total, ids.map(() => 1))[i] / 100).toFixed(2);
    });
  }

  function drawRows() {
    seed();
    selectSeg(typeSeg, typeSeg.querySelector(`[data-type="${type}"]`));
    const unit = { exact: S.group.currency, percent: '%', shares: '×' }[type];
    rows.innerHTML = members.map((m) => `
      <div class="split-row" data-id="${m.id}">
        ${avatar(m)}
        <span class="name ${inc[m.id] ? '' : 'off'}">${esc(m.name)}</span>
        ${type === 'equal' ? '' : `<span class="val-wrap"><input class="val" type="number" step="any" min="0" inputmode="decimal" value="${vals[type][m.id] ?? ''}" ${inc[m.id] ? '' : 'disabled'}><em>${unit}</em></span>`}
        <span class="share-preview"></span>
        <label class="switch"><input type="checkbox" ${inc[m.id] ? 'checked' : ''} aria-label="Include ${esc(m.name)}"><i></i></label>
      </div>`).join('');
    compute();
  }

  function compute() {
    const total = totalCents();
    const ids = members.filter((m) => inc[m.id]).map((m) => m.id);
    let amounts, msg = '', ok = true;
    if (type === 'exact') {
      amounts = ids.map((id) => Math.round((Number(vals.exact[id]) || 0) * 100));
      const diff = total - sum(amounts);
      ok = diff === 0;
      msg = ok ? 'All allocated ✓' : diff > 0 ? `${money(diff)} left to assign` : `${money(-diff)} over the total`;
    } else if (type === 'percent') {
      const w = ids.map((id) => Number(vals.percent[id]) || 0);
      amounts = allocate(total, w);
      const s = Math.round(sum(w) * 100) / 100;
      ok = Math.abs(s - 100) < 0.01;
      msg = ok ? 'Adds up to 100% ✓' : `${s}% of 100%`;
    } else if (type === 'shares') {
      amounts = allocate(total, ids.map((id) => Number(vals.shares[id]) || 0));
      msg = ids.length ? `${sum(ids.map((id) => Number(vals.shares[id]) || 0))} shares in total` : '';
    } else {
      amounts = allocate(total, ids.map(() => 1));
      msg = ids.length ? `≈ ${money(Math.round(total / ids.length))} each` : '';
    }
    if (!ids.length) { msg = 'Pick at least one person'; ok = false; }
    status.textContent = msg;
    status.className = 'split-status' + (ok ? '' : ' warn');
    rows.querySelectorAll('.split-row').forEach((row) => {
      const i = ids.indexOf(Number(row.dataset.id));
      row.querySelector('.share-preview').textContent = i >= 0 && total ? money(amounts[i]) : '';
    });
  }

  typeSeg.onclick = (e) => {
    const b = e.target.closest('[data-type]');
    if (b) { type = b.dataset.type; drawRows(); }
  };
  rows.addEventListener('input', (e) => {
    const row = e.target.closest('.split-row');
    const id = row.dataset.id;
    if (e.target.type === 'checkbox') {
      inc[id] = e.target.checked;
      row.querySelector('.name').classList.toggle('off', !inc[id]);
      const v = row.querySelector('.val');
      if (v) v.disabled = !inc[id];
      if (inc[id] && vals[type] && vals[type][id] === undefined) {
        vals[type][id] = type === 'shares' ? 1 : 0;
        if (v) v.value = vals[type][id];
      }
      if (type === 'exact' && !touched.exact) { seeded.exact = false; seed(); rows.querySelectorAll('.val').forEach((el) => { el.value = vals.exact[el.closest('.split-row').dataset.id] ?? ''; }); }
      compute();
    } else {
      vals[type][id] = e.target.value;
      if (type === 'exact') touched.exact = true;
      compute();
    }
  });
  form.amount.addEventListener('input', () => {
    if (type === 'exact' && !touched.exact) { seeded.exact = false; drawRows(); } else compute();
  });
  document.getElementById('cancel').onclick = closeSheet;
  document.getElementById('del')?.addEventListener('click', () => { closeSheet(); deleteExpense(edit.id); });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const ids = members.filter((m) => inc[m.id]).map((m) => m.id);
    if (!ids.length) return toast('Pick at least one person', true);
    const body = {
      description: form.description.value,
      amount: form.amount.value,
      date: form.date.value,
      category: form.category.value,
      paidBy: form.paidBy.value,
      splitType: type,
      split: Object.fromEntries(ids.map((id) => [id, type === 'equal' ? 1 : vals[type][id]])),
    };
    const ok = edit
      ? await mutate(`/groups/${S.group.code}/expenses/${edit.id}`, 'PUT', body, 'Expense updated ✦')
      : await mutate(`/groups/${S.group.code}/expenses`, 'POST', body, 'Expense added ✦');
    if (ok) closeSheet();
  };
  drawRows();
  if (!edit) form.description.focus();
}
