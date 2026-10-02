// Shared, mutable UI state. Modules read and write these fields directly.
export const state = {
  user: null, // the logged-in account, or null
  g: null, // current group state from the API
  mode: 'raw', // constellation view: 'raw' (tangled) | 'simplified' (untangled)
  tab: 'sky', // 'sky' | 'insights' | 'wrapped'
  anim: false, // when true, the markup being built plays its entrance animations
  shownTotal: 0, // last total shown, so the counter animates from it
  query: '', // expense search filter
};

export const memberOf = (id) => state.g.members.find((m) => m.id === id);
export const realExpenses = () => state.g.expenses.filter((e) => e.kind === 'expense');

/** ` data-enter` attribute for entrance animations, only while `state.anim` is on. */
export const enter = (i = 0) => (state.anim ? ` data-enter style="--i:${i}"` : '');
