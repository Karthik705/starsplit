// "People & settings" sheet: rename the group, add, rename or remove people.
import { state } from './state.js';
import { esc, avatar } from './util.js';
import { api } from './api.js';
import { openSheet, closeSheet, confirmSheet } from './ui.js';
import { mutate } from './actions.js';

const MAX = 12;

/** Ids of people who appear anywhere in the ledger (they can't be removed). */
const involved = () => new Set(state.g.expenses.flatMap((e) => [e.paid_by, ...e.splits.map((s) => s.member_id)]));

export function openPeopleSheet() {
  const { group, members } = state.g;
  const used = involved();
  openSheet(`
    <div class="sheet">
      <div class="sheet-head">
        <span></span>
        <h2>People &amp; settings</h2>
        <button type="button" class="plain strong" id="done">Done</button>
      </div>
      <div class="sheet-body">
        <div class="section-label">Constellation</div>
        <form class="list" id="rename-group">
          <label class="row-item"><span class="lbl">Name</span><input name="name" value="${esc(group.name)}" maxlength="50" required></label>
          <div class="row-item"><span class="lbl">Currency</span><span class="muted" style="margin-left:auto">${esc(group.currency)}</span></div>
          <div class="row-item"><span class="lbl">Code</span><span class="mono" style="margin-left:auto">${esc(group.code)}</span></div>
        </form>

        <div class="section-label">People · ${members.length} of ${MAX}</div>
        <div class="list" id="people-list">
          ${members.map((m) => `
            <form class="row-item person" data-id="${m.id}">
              ${avatar(m)}
              <input name="name" value="${esc(m.name)}" maxlength="24" required class="left" aria-label="Name of ${esc(m.name)}">
              <button type="button" class="icon-btn" data-remove="${m.id}" aria-label="Remove ${esc(m.name)}"
                ${used.has(m.id) || members.length <= 2 ? `disabled title="${members.length <= 2 ? 'A group needs at least two people' : 'Part of some expenses'}"` : ''}>✕</button>
            </form>`).join('')}
        </div>
        ${members.length < MAX ? `<form class="add-row" id="add-person"><input name="name" placeholder="Add someone new" maxlength="24" required aria-label="New person's name"><button class="btn tinted">Add</button></form>` : ''}
        <p class="muted small sheet-note">Tap a name to rename it. People who are part of an expense can't be removed until those expenses are deleted.</p>

        <div class="section-label">Your account</div>
        <button type="button" class="btn block gray" id="forget">Remove from my groups</button>
        <p class="muted small sheet-note">The group keeps working for everyone else. Open its code again to add it back.</p>
      </div>
    </div>`);

  const reopen = (ok) => ok && openPeopleSheet();
  document.getElementById('done').onclick = closeSheet;

  // save renames when a field loses focus or Enter is pressed
  const saveGroup = async (input) => {
    const name = input.value.trim();
    if (name && name !== state.g.group.name) await mutate('', 'PATCH', { name }, 'Renamed ✦');
  };
  const groupForm = document.getElementById('rename-group');
  groupForm.name.onchange = () => saveGroup(groupForm.name);
  groupForm.onsubmit = (e) => { e.preventDefault(); groupForm.name.blur(); };

  document.getElementById('people-list').querySelectorAll('form.person').forEach((f) => {
    const id = Number(f.dataset.id);
    f.name.onchange = async () => {
      const name = f.name.value.trim();
      const m = state.g.members.find((x) => x.id === id);
      if (!name) { f.name.value = m.name; return; }
      if (name !== m.name && !(await mutate(`/members/${id}`, 'PATCH', { name }, 'Renamed ✦'))) f.name.value = m.name;
    };
    f.onsubmit = (e) => { e.preventDefault(); f.name.blur(); };
  });

  document.getElementById('people-list').onclick = async (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    const m = state.g.members.find((x) => x.id === Number(b.dataset.remove));
    const ok = await confirmSheet({ title: `Remove ${m.name}?`, message: 'They are not part of any expenses, so no balances change.', confirm: 'Remove' });
    if (ok) await mutate(`/members/${m.id}`, 'DELETE', null, `${m.name} removed`);
    openPeopleSheet();
  };

  const add = document.getElementById('add-person');
  if (add) add.onsubmit = async (e) => {
    e.preventDefault();
    reopen(await mutate('/members', 'POST', { name: add.name.value }, 'Star added ✦'));
    document.querySelector('#add-person input')?.focus();
  };

  document.getElementById('forget').onclick = async () => {
    await api('/me/groups/' + group.code, 'DELETE');
    closeSheet();
    location.hash = '#/';
  };
}
