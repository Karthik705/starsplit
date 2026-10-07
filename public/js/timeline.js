// Time machine: replay the ledger entry by entry and watch the sky form.
// Balances are never stored, only derived from the ledger, so any moment in the trip can be
// rebuilt exactly, with the same code the server uses.
import { deriveDebts } from '/shared/ledger.mjs';
import { state, memberOf } from './state.js';
import { esc, money, niceDate } from './util.js';

const STEP_MS = 1100;

/** Ledger entries in the order they happened. */
const chronological = () =>
  state.g.expenses.slice().sort((a, b) => a.spent_on.localeCompare(b.spent_on) || a.id - b.id);

/** The group as it stood after the first `i` entries. */
export function frameAt(i) {
  const entries = chronological().slice(0, i);
  return { members: state.g.members, expenses: entries, ...deriveDebts(state.g.members, entries), last: entries[i - 1] };
}

export function timeMachineHTML() {
  const n = state.g.expenses.length;
  if (n < 2) return '';
  return `
    <div class="tm" id="tm">
      <button type="button" class="tm-play" id="tm-play" aria-label="Replay the trip">${PLAY}</button>
      <div class="tm-track">
        <input type="range" id="tm-range" min="0" max="${n}" value="${n}" aria-label="Time machine: scrub through the ledger">
        <div class="tm-label" id="tm-label">Time machine · replay how the debts formed</div>
      </div>
    </div>`;
}

const PLAY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>';
const PAUSE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="5" height="16" rx="1.5"/><rect x="14" y="4" width="5" height="16" rx="1.5"/></svg>';

/**
 * Wire up the controls. `show(frame | null, hotMemberId)` repaints the sky:
 * a frame while replaying, null to go back to the live state.
 */
export function bindTimeMachine(show) {
  const range = document.getElementById('tm-range');
  if (!range) return;
  const play = document.getElementById('tm-play');
  const label = document.getElementById('tm-label');
  const n = Number(range.max);
  let timer = null;

  const describe = (f) => {
    if (!f.last) return 'Before the trip: an empty sky';
    const e = f.last;
    const what = e.kind === 'payment'
      ? `${esc(memberOf(e.paid_by).name)} paid ${esc(memberOf(e.splits[0].member_id).name)} back`
      : `${esc(e.description)} · ${esc(memberOf(e.paid_by).name)} paid`;
    return `<b>${niceDate(e.spent_on)}</b> · ${what} ${money(e.amount_cents)} <span class="muted">(${range.value}/${n})</span>`;
  };

  const go = (i) => {
    range.value = i;
    range.style.setProperty('--p', `${(i / n) * 100}%`);
    if (i >= n) {
      label.textContent = 'Time machine · replay how the debts formed';
      return show(null);
    }
    const f = frameAt(i);
    label.innerHTML = describe(f);
    show(f, f.last?.paid_by);
  };
  const stop = () => {
    clearInterval(timer);
    timer = null;
    play.innerHTML = PLAY;
    play.setAttribute('aria-label', 'Replay the trip');
  };

  range.style.setProperty('--p', '100%');
  range.oninput = () => { stop(); go(Number(range.value)); };
  play.onclick = () => {
    if (timer) return stop();
    play.innerHTML = PAUSE;
    play.setAttribute('aria-label', 'Pause');
    if (Number(range.value) >= n) go(0);
    timer = setInterval(() => {
      const next = Number(range.value) + 1;
      go(next);
      if (next >= n) stop();
    }, STEP_MS);
  };
  // stop playing if the panel is replaced (tab switch, live update)
  const watch = new MutationObserver(() => { if (!document.body.contains(range)) { stop(); watch.disconnect(); } });
  watch.observe(document.getElementById('panel'), { childList: true });
}
