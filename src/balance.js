// Pure money logic. All amounts are integer cents to avoid float drift.

/**
 * Largest-remainder allocation: divide `total` cents proportionally to `weights`
 * so the parts are whole cents and always sum exactly to the total.
 */
function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) throw new Error('Weights must add up to more than zero');
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; k < left; k++) out[order[k][1]]++;
  return out;
}

/** Split `total` cents evenly across ids; leftover cents go to the first few people. */
function splitEqually(total, ids) {
  return allocate(total, ids.map(() => 1)).map((share_cents, i) => ({ member_id: ids[i], share_cents }));
}

/**
 * Build splits for any mode. `entries` is [{ member_id, value }]:
 *  equal   -> value ignored
 *  exact   -> value is cents, must add up to the total
 *  percent -> value is a percentage, must add up to 100
 *  shares  -> value is a relative weight (e.g. 2 nights vs 1 night)
 */
function buildSplits(total, type, entries) {
  if (!entries.length) throw new Error('Pick who shares this expense');
  let amounts;
  if (type === 'exact') {
    amounts = entries.map((e) => e.value);
    if (amounts.reduce((a, b) => a + b, 0) !== total) throw new Error('Exact amounts must add up to the total');
  } else if (type === 'percent') {
    if (Math.abs(entries.reduce((a, e) => a + e.value, 0) - 100) > 0.01) throw new Error('Percentages must add up to 100');
    amounts = allocate(total, entries.map((e) => e.value));
  } else if (type === 'shares') {
    amounts = allocate(total, entries.map((e) => e.value));
  } else {
    amounts = allocate(total, entries.map(() => 1));
  }
  return entries.map((e, i) => ({ member_id: e.member_id, share_cents: amounts[i] })).filter((s) => s.share_cents > 0);
}

/** Net position per member: positive = is owed money, negative = owes money. */
function computeNet(members, expenses) {
  const net = Object.fromEntries(members.map((m) => [m.id, 0]));
  for (const e of expenses) {
    net[e.paid_by] += e.amount_cents;
    for (const s of e.splits) net[s.member_id] -= s.share_cents;
  }
  return net;
}

/** "Tangled" view: who owes whom directly, netted per pair but not across third parties. */
function pairwiseDebts(expenses) {
  const owes = {}; // owes[a][b] = cents a owes b
  for (const e of expenses) {
    for (const s of e.splits) {
      if (s.member_id === e.paid_by) continue;
      owes[s.member_id] ??= {};
      owes[s.member_id][e.paid_by] = (owes[s.member_id][e.paid_by] || 0) + s.share_cents;
    }
  }
  const out = [];
  const ids = Object.keys(owes).map(Number);
  const seen = new Set();
  for (const a of ids) {
    for (const bStr of Object.keys(owes[a])) {
      const b = Number(bStr);
      const key = [a, b].sort().join('-');
      if (seen.has(key)) continue;
      seen.add(key);
      const d = (owes[a][b] || 0) - (owes[b]?.[a] || 0);
      if (d > 0) out.push({ from: a, to: b, amount_cents: d });
      else if (d < 0) out.push({ from: b, to: a, amount_cents: -d });
    }
  }
  return out;
}

/** "Untangled" view: greedy min-cash-flow, at most (people - 1) payments. */
function simplify(net) {
  const debtors = [];
  const creditors = [];
  for (const [id, v] of Object.entries(net)) {
    if (v < 0) debtors.push({ id: Number(id), amt: -v });
    else if (v > 0) creditors.push({ id: Number(id), amt: v });
  }
  debtors.sort((a, b) => b.amt - a.amt);
  creditors.sort((a, b) => b.amt - a.amt);
  const out = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    out.push({ from: debtors[i].id, to: creditors[j].id, amount_cents: pay });
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt === 0) i++;
    if (creditors[j].amt === 0) j++;
  }
  return out;
}

module.exports = { allocate, buildSplits, splitEqually, computeNet, pairwiseDebts, simplify };
