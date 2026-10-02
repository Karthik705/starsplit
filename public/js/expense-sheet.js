// Add / edit expense sheet, with live per-person previews for every split mode.
import { state } from './state.js';
import { CATEGORIES, SPLIT_LABELS, esc, sum, money, allocate, localToday, avatar } from './util.js';
import { $modal, openSheet, closeSheet, selectSeg, toastError } from './ui.js';
import { mutate, deleteEntry } from './actions.js';

export function openExpenseSheet(edit) {
  const { members, group } = state.g;
  const inc = {}, vals = { exact: {}, percent: {}, shares: {} }, seeded = {}, touched = {};
  let type = 'equal';

  if (edit) {
    const shares = edit.splits.map((s) => s.share_cents);
    const even = Math.max(...shares) - Math.min(...shares) <= 1;
    type = even ? 'equal' : 'exact';
    edit.splits.forEach((s) => { inc[s.member_id] = true; vals.exact[s.member_id] = (s.share_cents / 100).toFixed(2); });
    if (!even) seeded.exact = touched.exact = true;
  } else members.forEach((m) => (inc[m.id] = true));

  openSheet(`
    <form id="exp-form" class="sheet" autocomplete="off">
      <div class="sheet-head">
        <button type="button" class="plain" id="cancel">Cancel</button>
        <h2>${edit ? 'Edit Expense' : 'New Expense'}</h2>
        <button class="plain strong">${edit ? 'Save' : 'Add'}</button>
      </div>
      <div class="sheet-body">
        <div class="amount-field">
          <span class="cur">${esc(group.currency)}</span>
          <input name="amount" type="number" step="0.01" min="0.01" inputmode="decimal" placeholder="0.00" required aria-label="Amount" value="${edit ? edit.amount_cents / 100 : ''}">
        </div>
        <div class="list">
          <label class="row-item"><span class="lbl">For</span><input name="description" placeholder="Dinner at the beach shack" maxlength="60" required value="${edit ? esc(edit.description) : ''}"></label>
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
        <p class="split-status" id="split-status" aria-live="polite"></p>
        ${edit ? `<button type="button" class="btn block danger-tint" id="del">Delete expense</button>` : ''}
      </div>
    </form>`);

  const form = document.getElementById('exp-form');
  const rows = document.getElementById('split-rows');
  const status = document.getElementById('split-status');
  const typeSeg = document.getElementById('split-type');
  const totalCents = () => Math.round(Number(form.amount.value) * 100) || 0;
  const included = () => members.filter((m) => inc[m.id]).map((m) => m.id);

  function seed() {
    if (type === 'equal' || seeded[type]) return;
    seeded[type] = true;
    const ids = included();
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
    const unit = { exact: group.currency, percent: '%', shares: '×' }[type];
    rows.innerHTML = members.map((m) => `
      <div class="split-row" data-id="${m.id}">
        ${avatar(m)}
        <span class="name ${inc[m.id] ? '' : 'off'}">${esc(m.name)}</span>
        ${type === 'equal' ? '' : `<span class="val-wrap"><input class="val" type="number" step="any" min="0" inputmode="decimal" aria-label="${esc(m.name)} ${unit}" value="${vals[type][m.id] ?? ''}" ${inc[m.id] ? '' : 'disabled'}><em>${unit}</em></span>`}
        <span class="share-preview"></span>
        <label class="switch"><input type="checkbox" ${inc[m.id] ? 'checked' : ''} aria-label="Include ${esc(m.name)}"><i></i></label>
      </div>`).join('');
    compute();
  }

  function compute() {
    const total = totalCents();
    const ids = included();
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
      msg = ids.length && total ? `≈ ${money(Math.round(total / ids.length))} each` : '';
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
      if (type === 'exact' && !touched.exact) {
        seeded.exact = false;
        seed();
        rows.querySelectorAll('.val').forEach((el) => { el.value = vals.exact[el.closest('.split-row').dataset.id] ?? ''; });
      }
    } else {
      vals[type][id] = e.target.value;
      if (type === 'exact') touched.exact = true;
    }
    compute();
  });
  form.amount.addEventListener('input', () => {
    if (type === 'exact' && !touched.exact) { seeded.exact = false; drawRows(); } else compute();
  });
  document.getElementById('cancel').onclick = closeSheet;
  document.getElementById('del')?.addEventListener('click', () => { closeSheet(); deleteEntry(edit.id); });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const ids = included();
    if (!ids.length) return toastError('Pick at least one person');
    const btn = form.querySelector('.plain.strong');
    btn.disabled = true;
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
      ? await mutate(`/expenses/${edit.id}`, 'PUT', body, 'Expense updated ✦')
      : await mutate('/expenses', 'POST', body, 'Expense added ✦');
    if (ok) closeSheet();
    else btn.disabled = false;
  };
  drawRows();
  if (!edit) form.amount.focus();
  $modal.scrollTop = 0;
}
