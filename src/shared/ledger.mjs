// Pure money logic, shared by the server (via require) and the browser (as an ES module).
// All amounts are integer cents to avoid float drift.

/**
 * Largest-remainder allocation: divide `total` cents proportionally to `weights`
 * so the parts are whole cents and always sum exactly to the total.
 */
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) throw new Error('Weights must add up to more than zero');
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  const left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; k < left; k++) out[order[k][1]]++;
  return out;
}

/** Split `total` cents evenly across ids; leftover cents go to the first few people. */
export function splitEqually(total, ids) {
  return allocate(total, ids.map(() => 1)).map((share_cents, i) => ({ member_id: ids[i], share_cents }));
}

/**
 * Build splits for any mode. `entries` is [{ member_id, value }]:
 *  equal   -> value ignored
 *  exact   -> value is cents, must add up to the total
 *  percent -> value is a percentage, must add up to 100
 *  shares  -> value is a relative weight (e.g. 2 nights vs 1 night)
 */
export function buildSplits(total, type, entries) {
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
export function computeNet(members, expenses) {
  const net = Object.fromEntries(members.map((m) => [m.id, 0]));
  for (const e of expenses) {
    net[e.paid_by] += e.amount_cents;
    for (const s of e.splits) net[s.member_id] -= s.share_cents;
  }
  return net;
}

/** "Tangled" view: who owes whom directly, netted per pair but not across third parties. */
export function pairwiseDebts(expenses) {
  const owes = new Map(); // "a>b" -> cents a owes b
  for (const e of expenses) {
    for (const s of e.splits) {
      if (s.member_id === e.paid_by) continue;
      const key = `${s.member_id}>${e.paid_by}`;
      owes.set(key, (owes.get(key) || 0) + s.share_cents);
    }
  }
  const out = [];
  const seen = new Set();
  for (const key of owes.keys()) {
    const [a, b] = key.split('>').map(Number);
    const pair = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    const d = (owes.get(`${a}>${b}`) || 0) - (owes.get(`${b}>${a}`) || 0);
    if (d > 0) out.push({ from: a, to: b, amount_cents: d });
    else if (d < 0) out.push({ from: b, to: a, amount_cents: -d });
  }
  return out;
}

/**
 * Greedy min-cash-flow: repeatedly match the biggest debtor with the biggest creditor.
 * Fast and never needs more than (people - 1) payments, but it is not always optimal.
 * This is what most expense apps do.
 */
export function greedySettle(net) {
  const debtors = [];
  const creditors = [];
  for (const [id, v] of Object.entries(net)) {
    if (v < 0) debtors.push({ id: Number(id), amt: -v });
    else if (v > 0) creditors.push({ id: Number(id), amt: v });
  }
  const byAmount = (a, b) => b.amt - a.amt || a.id - b.id;
  debtors.sort(byAmount);
  creditors.sort(byAmount);
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

/** Above this many people with a non-zero balance the exact search is skipped (2^n states). */
export const EXACT_LIMIT = 18;

/**
 * The fewest possible payments that settle everyone, plus the "circles" that make it work.
 *
 * Key fact: if the k people who owe or are owed can be split into m groups whose balances
 * each sum to zero, every group can settle on its own with (size - 1) payments, so the
 * whole thing takes k - m payments, and no plan can do better. Finding the minimum number
 * of payments is therefore the same as finding the largest such partition, which is
 * NP-hard in general. With k <= EXACT_LIMIT we solve it exactly with a DP over subsets:
 *
 *   dp[mask] = max over i in mask of dp[mask without i]  (+1 if mask's balances sum to 0)
 *
 * Walking from the full set down to empty, the zero-sum masks along the best path are
 * nested; their differences are the circles. O(2^k * k): ~50k steps for 12 people.
 *
 * Returns { payments, circles: [[ids...]], greedyCount, exact }.
 */
export function settlePlan(net) {
  const people = Object.entries(net)
    .filter(([, v]) => v !== 0)
    .map(([id, v]) => ({ id: Number(id), v }))
    .sort((a, b) => a.id - b.id); // deterministic: same ledger, same plan, on server and browser
  const greedy = greedySettle(net);
  const k = people.length;
  if (k === 0) return { payments: [], circles: [], greedyCount: 0, exact: true };
  if (k > EXACT_LIMIT) return { payments: greedy, circles: [people.map((p) => p.id)], greedyCount: greedy.length, exact: false };

  const full = (1 << k) - 1;
  const sum = new Float64Array(full + 1); // cents fit exactly in a double
  const dp = new Int8Array(full + 1);
  for (let mask = 1; mask <= full; mask++) {
    const low = mask & -mask;
    sum[mask] = sum[mask ^ low] + people[31 - Math.clz32(low)].v;
    let best = 0;
    for (let rest = mask; rest; rest &= rest - 1) {
      const d = dp[mask ^ (rest & -rest)];
      if (d > best) best = d;
    }
    dp[mask] = best + (sum[mask] === 0 ? 1 : 0);
  }

  // Walk back down, collecting the nested zero-sum masks.
  const zeroMasks = [];
  for (let mask = full; mask; ) {
    if (sum[mask] === 0) zeroMasks.push(mask);
    const target = dp[mask] - (sum[mask] === 0 ? 1 : 0);
    let next = 0;
    for (let rest = mask; rest; rest &= rest - 1) {
      const bit = rest & -rest;
      if (dp[mask ^ bit] === target) { next = mask ^ bit; break; }
    }
    mask = next;
  }
  zeroMasks.reverse(); // smallest first

  const circles = [];
  const payments = [];
  let prev = 0;
  for (const mask of zeroMasks) {
    const members = people.filter((_, i) => (mask & ~prev) & (1 << i));
    prev = mask;
    circles.push(members.map((p) => p.id));
    payments.push(...greedySettle(Object.fromEntries(members.map((p) => [p.id, p.v]))));
  }
  // largest circle first reads best in the UI
  circles.sort((a, b) => b.length - a.length || a[0] - b[0]);
  return { payments, circles, greedyCount: greedy.length, exact: true };
}

/** Optimal payments only (kept for callers that don't need the circles). */
export const simplify = (net) => settlePlan(net).payments;

/**
 * Everything derived from a ledger: balances, the tangled web and the optimal plan.
 * Used for the live state and for every frame of the time machine.
 */
export function deriveDebts(members, expenses) {
  const net = computeNet(members, expenses);
  const plan = settlePlan(net);
  return {
    net,
    debts: {
      // once everyone nets to zero nothing is owed, so the tangled view is empty too
      raw: plan.payments.length ? pairwiseDebts(expenses) : [],
      simplified: plan.payments,
      circles: plan.circles,
      greedyCount: plan.greedyCount,
      exact: plan.exact,
    },
  };
}
