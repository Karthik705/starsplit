// "Wrapped" tab: Spotify-style awards for the trip.
import { state, memberOf, realExpenses } from './state.js';
import { CATEGORIES, catColor, esc, sum, money, niceDate, reduceMotion } from './util.js';

export function wrappedHTML() {
  const exps = realExpenses();
  if (exps.length < 2) return `<div class="card empty"><span class="big-emoji">🎁</span>Add a couple of expenses to unlock your trip's Wrapped.</div>`;
  const paid = state.g.members.map((m) => ({ m, v: sum(exps.filter((e) => e.paid_by === m.id).map((e) => e.amount_cents)) }));
  const used = state.g.members.map((m) => ({ m, v: sum(exps.flatMap((e) => e.splits.filter((s) => s.member_id === m.id).map((s) => s.share_cents))) }));
  const top = (arr) => arr.reduce((a, b) => (b.v > a.v ? b : a));
  const biggest = exps.reduce((a, b) => (b.amount_cents > a.amount_cents ? b : a));
  const cats = {};
  exps.forEach((e) => (cats[e.category] = (cats[e.category] || 0) + e.amount_cents));
  const [favCat, favCatV] = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
  const days = {};
  exps.forEach((e) => (days[e.spent_on] = (days[e.spent_on] || 0) + e.amount_cents));
  const [busyDay, busyV] = Object.entries(days).sort((a, b) => b[1] - a[1])[0];
  const payments = state.g.expenses.filter((e) => e.kind === 'payment');
  const settler = {};
  payments.forEach((p) => (settler[p.paid_by] = (settler[p.paid_by] || 0) + 1));
  const settlerId = Object.entries(settler).sort((a, b) => b[1] - a[1])[0];
  const square = state.g.members.reduce((a, m) => (Math.abs(state.g.net[m.id]) < Math.abs(state.g.net[a.id]) ? m : a));
  const backbone = top(paid), appetite = top(used);

  const cards = [
    ['🏦', 'The Backbone', backbone.m.name, `fronted ${money(backbone.v)} for the group`, backbone.m.color],
    ['🍴', 'Biggest Appetite', appetite.m.name, `benefited from ${money(appetite.v)} of costs`, appetite.m.color],
    ['💎', 'Priciest Moment', biggest.description, `${money(biggest.amount_cents)} · paid by ${memberOf(biggest.paid_by).name}`, 'var(--purple)'],
    [CATEGORIES[favCat], 'Signature Vibe', favCat[0].toUpperCase() + favCat.slice(1), `${Math.round((favCatV / state.g.totalSpent) * 100)}% of all spending`, catColor(favCat)],
    ['📅', 'Wildest Day', niceDate(busyDay), `${money(busyV)} spent in one day`, 'var(--orange)'],
    ['🧾', 'Average Expense', money(Math.round(state.g.totalSpent / exps.length)), `across ${exps.length} expenses`, 'var(--blue)'],
    ['🤝', settlerId ? 'Peacemaker' : 'Closest to Square', settlerId ? memberOf(Number(settlerId[0])).name : square.name,
      settlerId ? `settled up ${settlerId[1]} time${settlerId[1] === 1 ? '' : 's'}` : 'has the smallest balance', 'var(--green)'],
  ];
  return `<div class="wrapped">${cards.map(([ico, label, big, sub, color], i) => `
    <div class="award" style="--c:${color}"${state.anim ? ` data-enter` : ''} ${state.anim ? `data-i="${i}"` : ''}>
      <div class="award-ico">${ico}</div>
      <div class="award-label">${label}</div>
      <div class="award-big">${esc(big)}</div>
      <div class="award-sub">${esc(sub)}</div>
    </div>`).join('')}</div>`;
}

/** Cards tilt toward the pointer, with a soft highlight that follows it. */
export function bindWrapped() {
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
