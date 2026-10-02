// Group page shell: header, stats, tabs. The active tab renders into #panel.
import { api } from './api.js';
import { state, enter, realExpenses } from './state.js';
import { esc, money, recent } from './util.js';
import { $app, $modal, transition, toast, countTo, initSegs, selectSeg, hideTip } from './ui.js';
import { setNav } from './nav.js';
import { onChange, connectLive, isLive } from './actions.js';
import { skyHTML, bindSky } from './sky.js';
import { insightsHTML, bindInsights } from './insights.js';
import { wrappedHTML, bindWrapped } from './wrapped.js';
import { openExpenseSheet } from './expense-sheet.js';
import { openPeopleSheet } from './people-sheet.js';

const TABS = [['sky', 'Sky'], ['insights', 'Insights'], ['wrapped', 'Wrapped']];
const gearSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

onChange(refresh);

export async function openGroup(code, tab) {
  state.tab = tab;
  const next = await api('/groups/' + code);
  transition(() => {
    state.g = next;
    state.shownTotal = 0;
    state.query = '';
    recent.add(next.group.code, next.group.name);
    renderGroup();
  });
  connectLive(next.group.code, () => {
    const typing = document.activeElement?.closest?.('#app form') && document.activeElement.value;
    if (!$modal.open && !typing) { refresh(); toast('Updated by a friend ✦'); }
  });
}

function statsHTML() {
  const { g } = state;
  const open = g.debts.simplified.length;
  const n = realExpenses().length;
  return `
    <div class="stat main"><span class="stat-label">Spent together</span><b class="stat-big" id="stat-total">${money(state.shownTotal)}</b></div>
    <div class="stat"><span class="stat-label">People</span><b>${g.members.length}</b></div>
    <div class="stat"><span class="stat-label">Expenses</span><b>${n}</b></div>
    <div class="stat ${open ? '' : 'good'}"><span class="stat-label">${open ? 'Payments left' : 'Status'}</span><b>${open || (n ? 'Square ✓' : '—')}</b></div>`;
}

/** Full render of the group shell. Called when entering a group. */
function renderGroup() {
  const { group } = state.g;
  document.title = `${group.name} · Starsplit`;
  state.anim = true;
  $app.innerHTML = `
    <header class="group-head">
      <h1 class="large"${enter(0)} id="group-name">${esc(group.name)}</h1>
      <div class="meta"${enter(1)}>
        <button class="chip" id="copy" title="Copy invite link">Code <strong class="mono">${esc(group.code)}</strong><span class="chip-sep">·</span>Copy link</button>
        <button class="chip" id="people">${gearSvg} People &amp; settings</button>
        <span class="live off" id="live" title="Changes from friends appear instantly"><i></i> Live</span>
      </div>
    </header>
    <section class="stats"${enter(2)} id="stats">${statsHTML()}</section>
    <nav class="tabs">
      <div class="seg" id="tabs" role="tablist" aria-label="Views">
        ${TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" class="${state.tab === k ? 'on' : ''}" aria-selected="${state.tab === k}">${l}</button>`).join('')}
      </div>
    </nav>
    <div id="panel" class="panel"></div>
    <button class="fab" id="fab" aria-label="Add expense"><span>＋</span></button>`;
  state.anim = false;
  setNav({ back: true, title: group.name });

  if (isLive()) document.getElementById('live').classList.remove('off');
  document.getElementById('copy').onclick = async () => {
    const url = `${location.origin}/#/g/${group.code}`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: group.name, text: `Join “${group.name}” on Starsplit`, url });
      else { await navigator.clipboard.writeText(url); toast('Invite link copied'); }
    } catch (err) { if (err.name !== 'AbortError') toast('Share code: ' + group.code); }
  };
  document.getElementById('people').onclick = openPeopleSheet;
  document.getElementById('fab').onclick = () => openExpenseSheet();
  document.getElementById('tabs').onclick = (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b || b.dataset.tab === state.tab) return;
    state.tab = b.dataset.tab;
    history.replaceState(null, '', `#/g/${group.code}${state.tab === 'sky' ? '' : '/' + state.tab}`);
    selectSeg(e.currentTarget, b);
    transition(() => renderPanel(true));
  };
  initSegs($app);
  countTo(document.getElementById('stat-total'), 0, state.g.totalSpent);
  state.shownTotal = state.g.totalSpent;
  renderPanel(true);
}

/** Light update after data changes: keeps the shell, counts numbers up, re-renders the panel. */
export function refresh() {
  if (!document.getElementById('panel')) return renderGroup();
  const from = state.shownTotal;
  state.shownTotal = state.g.totalSpent;
  document.getElementById('stats').innerHTML = statsHTML();
  countTo(document.getElementById('stat-total'), from, state.g.totalSpent);
  const name = document.getElementById('group-name');
  if (name.textContent !== state.g.group.name) {
    name.textContent = state.g.group.name;
    document.getElementById('nav-title').textContent = state.g.group.name;
    document.title = `${state.g.group.name} · Starsplit`;
    recent.add(state.g.group.code, state.g.group.name);
  }
  renderPanel(false);
}

function renderPanel(anim) {
  hideTip();
  const panel = document.getElementById('panel');
  const [html, bind] = { sky: [skyHTML, bindSky], insights: [insightsHTML, bindInsights], wrapped: [wrappedHTML, bindWrapped] }[state.tab];
  state.anim = anim;
  panel.innerHTML = html();
  state.anim = false;
  bind(anim);
  initSegs(panel);
}
