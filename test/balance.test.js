const test = require('node:test');
const assert = require('node:assert/strict');
const { splitEqually, computeNet, pairwiseDebts, simplify } = require('../balance');

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

const { buildSplits } = require('../balance');
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
