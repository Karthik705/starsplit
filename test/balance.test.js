const test = require('node:test');
const assert = require('node:assert/strict');
const { splitEqually, computeNet, pairwiseDebts, simplify } = require('../src/balance');

const members = [{ id: 1 }, { id: 2 }, { id: 3 }];
const exp = (paid_by, amount_cents, ids) => ({ paid_by, amount_cents, splits: splitEqually(amount_cents, ids) });

test('splitEqually distributes leftover cents and keeps the total', () => {
  const s = splitEqually(100, [1, 2, 3]);
  assert.deepEqual(s.map((x) => x.share_cents), [34, 33, 33]);
  assert.equal(s.reduce((a, x) => a + x.share_cents, 0), 100);
});

test('net balances always sum to zero', () => {
  const net = computeNet(members, [exp(1, 1000, [1, 2, 3]), exp(2, 555, [1, 2])]);
  assert.equal(Object.values(net).reduce((a, b) => a + b, 0), 0);
});

test('simplify collapses a chain A->B->C into A->C', () => {
  // 1 pays for 2, 2 pays for 3 (same amount): pairwise has two edges, simplified has one
  const expenses = [exp(1, 1000, [2]), exp(2, 1000, [3])];
  const net = computeNet(members, expenses);
  assert.equal(pairwiseDebts(expenses).length, 2);
  assert.deepEqual(simplify(net), [{ from: 3, to: 1, amount_cents: 1000 }]);
});

test('paying a settlement zeroes the debt', () => {
  const expenses = [exp(1, 900, [1, 2, 3])];
  const payment = { paid_by: 2, amount_cents: 300, splits: [{ member_id: 1, share_cents: 300 }] };
  const net = computeNet(members, [...expenses, payment]);
  assert.equal(net[2], 0);
  assert.deepEqual(simplify(net), [{ from: 3, to: 1, amount_cents: 300 }]);
});

test('pairwise nets opposite debts between the same two people', () => {
  const d = pairwiseDebts([exp(1, 1000, [1, 2]), exp(2, 400, [1, 2])]);
  assert.deepEqual(d, [{ from: 2, to: 1, amount_cents: 300 }]);
});

const { buildSplits } = require('../src/balance');
const total = (s) => s.reduce((a, x) => a + x.share_cents, 0);

test('percent split uses largest remainder and sums exactly', () => {
  const s = buildSplits(1000, 'percent', [{ member_id: 1, value: 33.33 }, { member_id: 2, value: 33.33 }, { member_id: 3, value: 33.34 }]);
  assert.equal(total(s), 1000);
});

test('shares split is proportional', () => {
  const s = buildSplits(900, 'shares', [{ member_id: 1, value: 2 }, { member_id: 2, value: 1 }]);
  assert.deepEqual(s, [{ member_id: 1, share_cents: 600 }, { member_id: 2, share_cents: 300 }]);
});

test('exact split must add up to the total; percent must add up to 100', () => {
  assert.throws(() => buildSplits(1000, 'exact', [{ member_id: 1, value: 400 }, { member_id: 2, value: 500 }]));
  assert.throws(() => buildSplits(1000, 'percent', [{ member_id: 1, value: 60 }, { member_id: 2, value: 30 }]));
  assert.equal(total(buildSplits(1000, 'exact', [{ member_id: 1, value: 400 }, { member_id: 2, value: 600 }])), 1000);
});

const { greedySettle, settlePlan, deriveDebts } = require('../src/balance');

/** Apply payments to balances: everyone must end at exactly zero. */
function settlesEveryone(net, payments) {
  const left = { ...net };
  for (const p of payments) {
    assert.ok(p.amount_cents > 0);
    left[p.from] += p.amount_cents;
    left[p.to] -= p.amount_cents;
  }
  return Object.values(left).every((v) => v === 0);
}

/** Brute force: the largest number of zero-sum groups the non-zero people can be split into. */
function maxZeroSumParts(values) {
  let best = 0;
  const go = (i, groups) => {
    if (i === values.length) {
      if (groups.every((g) => g === 0)) best = Math.max(best, groups.length);
      return;
    }
    for (let g = 0; g < groups.length; g++) { groups[g] += values[i]; go(i + 1, groups); groups[g] -= values[i]; }
    groups.push(values[i]); go(i + 1, groups); groups.pop();
  };
  go(0, []);
  return best;
}

test('exact plan beats greedy when the group splits into independent circles', () => {
  // greedy pairs the two biggest first and ends up with 4 payments; the optimum is 3:
  // {2 -> 3} settles on its own, and {1 -> 4, 1 -> 5} settles the rest
  const net = { 1: -600, 2: -500, 3: 500, 4: 400, 5: 200 };
  assert.equal(greedySettle(net).length, 4);
  const plan = settlePlan(net);
  assert.equal(plan.payments.length, 3);
  assert.equal(plan.greedyCount, 4);
  assert.deepEqual(plan.circles.map((c) => c.sort()), [[1, 4, 5], [2, 3]]);
  assert.ok(settlesEveryone(net, plan.payments));
});

test('exact plan is optimal on random ledgers (checked against brute force)', () => {
  let seed = 42;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
  for (let round = 0; round < 300; round++) {
    const k = 2 + rand(6);
    const vals = Array.from({ length: k - 1 }, () => (rand(2) ? 1 : -1) * (1 + rand(6)) * 100);
    vals.push(-vals.reduce((a, b) => a + b, 0));
    const net = Object.fromEntries(vals.map((v, i) => [i + 1, v]));
    const nonZero = vals.filter((v) => v !== 0);
    const plan = settlePlan(net);
    assert.ok(settlesEveryone(net, plan.payments), 'plan must settle everyone');
    assert.equal(plan.payments.length, nonZero.length - maxZeroSumParts(nonZero), `optimal for ${JSON.stringify(net)}`);
    assert.ok(plan.payments.length <= greedySettle(net).length);
  }
});

test('12 people solve exactly and fast', () => {
  const net = { 1: 5000, 2: -5000, 3: 1200, 4: -700, 5: -500, 6: 3300, 7: -1100, 8: -2200, 9: 900, 10: -400, 11: -500, 12: 0 };
  const t0 = performance.now();
  const plan = settlePlan(net);
  assert.ok(performance.now() - t0 < 200);
  assert.ok(plan.exact);
  assert.ok(settlesEveryone(net, plan.payments));
});

test('deriveDebts exposes circles and the greedy count', () => {
  const members = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const expenses = [exp(1, 1000, [2]), exp(3, 500, [4])];
  const { debts } = deriveDebts(members, expenses);
  assert.equal(debts.simplified.length, 2);
  assert.equal(debts.circles.length, 2);
});
