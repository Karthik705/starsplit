// Every change to a group goes through here: call the API, re-render, give feedback.
import { api } from './api.js';
import { state, memberOf } from './state.js';
import { money, reduceMotion } from './util.js';
import { toast, toastError, burst } from './ui.js';

let rerender = () => {};
/** group.js registers how to repaint after the data changes (avoids an import cycle). */
export const onChange = (fn) => (rerender = fn);

const base = () => `/groups/${state.g.group.code}`;

/** Send a change; on success adopt the returned state and repaint. Resolves true on success. */
export async function mutate(path, method, body, okMsg) {
  const wasOpen = state.g.debts.simplified.length > 0;
  const before = new Set(state.g.expenses.map((e) => e.id));
  try {
    state.g = await api(base() + path, method, body);
    rerender();
    if (okMsg) toast(okMsg);
    state.g.expenses.filter((e) => !before.has(e.id)).forEach((e) => document.querySelector(`.exp[data-id="${e.id}"]`)?.classList.add('fresh'));
    if (wasOpen && !state.g.debts.simplified.length && state.g.expenses.length) { burst(); toast('Everyone is square! ✦'); }
    return true;
  } catch (err) { toastError(err.message); return false; }
}

/** Delete a ledger entry, offering Undo (which re-creates it with the same split and date). */
export async function deleteEntry(id) {
  const e = state.g.expenses.find((x) => x.id === id);
  if (!e) return;
  const row = document.querySelector(`.exp[data-id="${id}"]`);
  row?.classList.add('leaving');
  await new Promise((r) => setTimeout(r, reduceMotion ? 0 : 260));
  if (!(await mutate(`/expenses/${id}`, 'DELETE'))) return row?.classList.remove('leaving');

  const restore = e.kind === 'payment'
    ? () => mutate('/settle', 'POST', { from: e.paid_by, to: e.splits[0].member_id, amount: e.amount_cents / 100, date: e.spent_on }, 'Restored')
    : () => mutate('/expenses', 'POST', {
      description: e.description, amount: e.amount_cents / 100, paidBy: e.paid_by, category: e.category, date: e.spent_on,
      splitType: 'exact', split: Object.fromEntries(e.splits.map((s) => [s.member_id, s.share_cents / 100])),
    }, 'Restored');
  toast(e.kind === 'payment' ? 'Payment removed' : `Deleted “${e.description}”`, { action: { label: 'Undo', run: restore } });
}

export function settle(from, to, cents) {
  const msg = `${memberOf(from).name} paid ${memberOf(to).name} ${money(cents)} ✦`;
  return mutate('/settle', 'POST', { from, to, amount: cents / 100 }, msg);
}

// ---------- live sync ----------
let events = null;

export function connectLive(code, onRemoteChange) {
  disconnectLive();
  events = new EventSource(`/api/groups/${code}/events`);
  const live = () => document.getElementById('live');
  events.onopen = () => live()?.classList.remove('off');
  events.onerror = () => live()?.classList.add('off');
  events.onmessage = async () => {
    try {
      const next = await api('/groups/' + code);
      if (JSON.stringify(next) === JSON.stringify(state.g)) return; // our own change, already rendered
      state.g = next;
      onRemoteChange();
    } catch { /* offline, the next event will catch us up */ }
  };
}
export const isLive = () => events?.readyState === 1;
export function disconnectLive() {
  events?.close();
  events = null;
}
