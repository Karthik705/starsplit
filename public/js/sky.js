// "Sky" tab: the constellation, who pays whom, balances and the ledger.
import { state, enter, memberOf } from './state.js';
import { CATEGORIES, catColor, esc, money, niceDate, dayLabel, avatar, store, reduceMotion } from './util.js';
import { toast, toastError, selectSeg, confirmSheet } from './ui.js';
import { deleteEntry, settle } from './actions.js';
import { constellation, bindDrag, layoutKey, caption, greedyNote, glideTo, setFrame } from './constellation.js';
import { timeMachineHTML, bindTimeMachine } from './timeline.js';
import { openExpenseSheet } from './expense-sheet.js';

export function skyHTML() {
  const { g } = state;
  setFrame(null); // always open on the present
  return `
    <div class="layout">
      <div class="col">
        <section class="card sky-card" id="sky-card"${enter(0)}>
          <div class="card-head">
            <h2>The constellation</h2>
            <div class="seg" id="mode-seg" role="group" aria-label="Debt view">
              <button data-mode="raw" class="${state.mode === 'raw' ? 'on' : ''}">Tangled</button>
              <button data-mode="simplified" class="${state.mode === 'simplified' ? 'on' : ''}">Untangled</button>
            </div>
          </div>
          <div id="sky">${constellation(state.anim ? 'first' : 'static')}</div>
          <p class="sky-caption"><span id="caption">${caption()}</span></p>
          <p class="greedy-note" id="greedy-note">${greedyNote()}</p>
          ${timeMachineHTML()}
          <p class="muted small drag-hint">Drag the stars to rearrange · <button class="linkish" id="reset-layout">reset</button></p>
          <div class="pay-list" id="pay-list">${payList()}</div>
          ${g.debts.simplified.length ? `<button class="btn tinted sm" id="copy-plan" style="margin-top:12px">Copy settle-up message</button>` : ''}
        </section>

        <section class="card"${enter(1)}>
          <div class="card-head"><h2>Balances</h2><button class="linkish small" id="manage">Manage people</button></div>
          ${balancesHTML()}
        </section>
      </div>

      <section class="card ledger"${enter(2)}>
        <div class="card-head">
          <h2>Expenses</h2>
          <div class="head-actions">
            <button class="btn gray sm" id="export" title="Download as CSV" ${g.expenses.length ? '' : 'disabled'}>Export</button>
            <button class="btn sm" id="new-exp">＋ Add</button>
          </div>
        </div>
        ${g.expenses.length > 5 ? `<div class="search"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="search" placeholder="Search expenses" value="${esc(state.query)}" aria-label="Search expenses"></div>` : ''}
        <div id="ledger">${ledgerHTML()}</div>
      </section>
    </div>`;
}

function balancesHTML() {
  const { members, net } = state.g;
  const max = Math.max(1, ...members.map((m) => Math.abs(net[m.id])));
  return `<div class="balances">${members.map((m) => {
    const v = net[m.id];
    const w = (Math.abs(v) / max) * 50;
    const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted';
    return `<div class="balance">${avatar(m)}<span class="name">${esc(m.name)}</span>
      <span class="net-bar" aria-hidden="true"><i class="${cls}" style="width:${w}%;${v >= 0 ? 'left:50%' : `right:50%`}"></i></span>
      <span class="amt ${cls}">${v > 0 ? '+' : v < 0 ? '−' : ''}${v ? money(Math.abs(v)) : 'Settled'}</span></div>`;
  }).join('')}</div>
  <p class="muted small legend-note"><span class="pos">+ is owed</span> · <span class="neg">− owes</span></p>`;
}

function ledgerHTML() {
  const { g } = state;
  if (!g.expenses.length) {
    return `<div class="empty"><span class="big-emoji">🌌</span><b>Nothing here yet</b><br>Add your first expense to light up the sky.<br><button class="btn sm" style="margin-top:14px" id="empty-add">＋ Add an expense</button></div>`;
  }
  const q = state.query.trim().toLowerCase();
  const list = q ? g.expenses.filter((e) => matches(e, q)) : g.expenses;
  if (!list.length) return `<div class="empty small">No expenses match “${esc(state.query)}”.</div>`;
  let lastDay = null, html = '';
  list.forEach((e, i) => {
    if (e.spent_on !== lastDay) {
      lastDay = e.spent_on;
      const dayTotal = list.filter((x) => x.spent_on === lastDay && x.kind === 'expense').reduce((a, x) => a + x.amount_cents, 0);
      html += `<div class="day-head"><span>${dayLabel(lastDay)}</span>${dayTotal ? `<span>${money(dayTotal)}</span>` : ''}</div>`;
    }
    html += expenseRow(e, i);
  });
  return html;
}

const matches = (e, q) => {
  const payer = memberOf(e.paid_by).name;
  const text = e.kind === 'payment' ? `${payer} paid ${memberOf(e.splits[0].member_id).name} settled` : `${e.description} ${payer} ${e.category}`;
  return text.toLowerCase().includes(q);
};

function expenseRow(e, i) {
  const payer = memberOf(e.paid_by);
  const anim = state.anim ? ` data-enter style="--i:${Math.min(i, 12) + 3}"` : '';
  if (e.kind === 'payment') {
    const to = memberOf(e.splits[0].member_id);
    return `<div class="exp payment" data-id="${e.id}" data-pay="${e.id}" tabindex="0" role="button" aria-label="Payment from ${esc(payer.name)} to ${esc(to.name)}"${anim}>
      <span class="tile-ico" style="--tint:var(--green)">🤝</span>
      <div><div class="title">${esc(payer.name)} paid ${esc(to.name)}</div><div class="muted small">Settle-up · ${niceDate(e.spent_on)}</div></div>
      <div class="amt pos">${money(e.amount_cents)}</div><button class="icon-btn" data-del="${e.id}" aria-label="Delete payment">✕</button></div>`;
  }
  const n = e.splits.length;
  const shares = e.splits.map((s) => s.share_cents);
  const even = Math.max(...shares) - Math.min(...shares) <= 1;
  const how = n === state.g.members.length && even ? 'split with everyone' : even ? `split ${n} ways` : 'custom split';
  return `<div class="exp editable" data-id="${e.id}" data-edit="${e.id}" tabindex="0" role="button" aria-label="Edit ${esc(e.description)}"${anim}>
    <span class="tile-ico" style="--tint:${catColor(e.category)}">${CATEGORIES[e.category] || '✨'}</span>
    <div class="exp-text"><div class="title">${esc(e.description)}</div>
    <div class="muted small">${avatar(payer, 'xs')} ${esc(payer.name)} paid · ${how}</div></div>
    <div class="amt">${money(e.amount_cents)}</div><button class="icon-btn" data-del="${e.id}" aria-label="Delete ${esc(e.description)}">✕</button></div>`;
}

function payRow(d) {
  const a = memberOf(d.from), b = memberOf(d.to);
  return `<div class="pay"><span class="who">${avatar(a, 'sm')}${esc(a.name)}<span class="arrow">→</span>${avatar(b, 'sm')}${esc(b.name)}</span>
    <span class="right"><b>${money(d.amount_cents)}</b>
    <button class="btn tinted sm" data-settle="${d.from},${d.to},${d.amount_cents}">Mark paid</button></span></div>`;
}

/** Payments to make. In the Untangled view they're grouped by the circle that settles them. */
function payList() {
  const { debts } = state.g;
  if (state.mode === 'raw' || debts.circles.length < 2) return (state.mode === 'raw' ? debts.raw : debts.simplified).map(payRow).join('');
  return debts.circles.map((ids, i) => {
    const inCircle = debts.simplified.filter((d) => ids.includes(d.from));
    const names = ids.map((id) => esc(memberOf(id).name)).join(', ');
    return `<div class="circle-head"><span class="circle-dot" style="--k:var(--circle-${i % 6})"></span>Circle ${i + 1}<span class="muted small">${names}</span></div>${inCircle.map(payRow).join('')}`;
  }).join('');
}

async function copyPlan() {
  const { g } = state;
  const lines = g.debts.simplified.map((d) => `• ${memberOf(d.from).name} → ${memberOf(d.to).name}: ${money(d.amount_cents)}`);
  const text = `✦ ${g.group.name}: settle-up plan\n${lines.join('\n')}\n\nDetails: ${location.origin}/#/g/${g.group.code}`;
  try { await navigator.clipboard.writeText(text); toast('Copied. Paste it in your group chat'); }
  catch { toastError('Could not copy'); }
}

function exportCSV() {
  const { g } = state;
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const head = ['Date', 'Description', 'Category', 'Type', 'Paid by', 'Amount', ...g.members.map((m) => `${m.name} share`)];
  const rows = g.expenses.slice().reverse().map((e) => [
    e.spent_on, e.description, e.category, e.kind, memberOf(e.paid_by).name, (e.amount_cents / 100).toFixed(2),
    ...g.members.map((m) => ((e.splits.find((s) => s.member_id === m.id)?.share_cents || 0) / 100).toFixed(2)),
  ]);
  const csv = [head, ...rows].map((r) => r.map(q).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `${g.group.name.replace(/\W+/g, '-').toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function paintText() {
  document.getElementById('caption').textContent = caption();
  document.getElementById('greedy-note').textContent = greedyNote();
}

export function bindSky() {
  const seg = document.getElementById('mode-seg');
  seg.onclick = (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || b.dataset.mode === state.mode) return;
    state.mode = b.dataset.mode;
    selectSeg(seg, b);
    // collapse the current lines, glide the stars into place, then draw the new set
    const sky = document.getElementById('sky');
    sky.classList.add('morphing');
    setTimeout(() => {
      sky.classList.remove('morphing');
      glideTo(sky);
      paintText();
      document.getElementById('pay-list').innerHTML = payList();
    }, reduceMotion ? 0 : 220);
  };
  bindTimeMachine((frame, hot) => {
    setFrame(frame);
    document.getElementById('sky-card').classList.toggle('replaying', Boolean(frame));
    document.getElementById('sky').innerHTML = constellation(frame ? 'drag' : 'static', { hot });
    paintText();
  });
  document.getElementById('new-exp').onclick = () => openExpenseSheet();
  document.getElementById('export').onclick = exportCSV;
  document.getElementById('copy-plan')?.addEventListener('click', copyPlan);
  document.getElementById('manage').onclick = () => document.getElementById('people').click();
  document.getElementById('reset-layout').onclick = () => { store(layoutKey(), {}); document.getElementById('sky').innerHTML = constellation('toggle'); };
  document.getElementById('pay-list').onclick = (e) => {
    const b = e.target.closest('[data-settle]');
    if (!b) return;
    const [from, to, cents] = b.dataset.settle.split(',').map(Number);
    b.disabled = true;
    settle(from, to, cents);
  };
  const search = document.getElementById('search');
  if (search) search.oninput = () => { state.query = search.value; document.getElementById('ledger').innerHTML = ledgerHTML(); };
  bindLedger();
  bindDrag();
}

function bindLedger() {
  const ledger = document.getElementById('ledger');
  const act = async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); return deleteEntry(Number(del.dataset.del)); }
    const edit = e.target.closest('[data-edit]');
    if (edit) return openExpenseSheet(state.g.expenses.find((x) => x.id === Number(edit.dataset.edit)));
    const pay = e.target.closest('[data-pay]');
    if (pay) {
      const p = state.g.expenses.find((x) => x.id === Number(pay.dataset.pay));
      const ok = await confirmSheet({ title: 'Remove this payment?', message: `${memberOf(p.paid_by).name} → ${memberOf(p.splits[0].member_id).name}, ${money(p.amount_cents)}. Their balances will go back to before it was recorded.`, confirm: 'Remove' });
      if (ok) deleteEntry(p.id);
    }
    if (e.target.closest('#empty-add')) openExpenseSheet();
  };
  ledger.onclick = act;
  ledger.onkeydown = (e) => { if (e.key === 'Enter' && e.target.matches('.exp')) act(e); };
}
