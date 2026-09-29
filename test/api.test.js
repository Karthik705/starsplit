process.env.DB_FILE = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');

let base, server;
test.before(async () => {
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api`;
});
test.after(() => server.close());

const call = async (path, method = 'GET', body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
};

test('full flow: create, add expenses, settle, delete', async () => {
  const created = await call('/groups', 'POST', { name: 'Trip', currency: 'EUR', members: ['Ana', 'Ben', 'Cy'] });
  assert.equal(created.status, 201);
  const code = created.data.code;

  let { data: s } = await call('/groups/' + code);
  const [ana, ben, cy] = s.members.map((m) => m.id);

  // Ana pays 90 for all three -> Ben and Cy owe her 30 each
  const added = await call(`/groups/${code}/expenses`, 'POST', {
    description: 'Dinner', amount: 90, paidBy: ana, splitAmong: [ana, ben, cy], category: 'food',
  });
  assert.equal(added.status, 201);
  assert.equal(added.data.net[ana], 6000);
  assert.equal(added.data.debts.simplified.length, 2);

  // Ben pays Ana back
  const settled = await call(`/groups/${code}/settle`, 'POST', { from: ben, to: ana, amount: 30 });
  assert.equal(settled.data.net[ben], 0);
  assert.equal(settled.data.debts.simplified.length, 1);

  // Deleting the dinner leaves only the payment
  const dinner = settled.data.expenses.find((e) => e.kind === 'expense');
  const afterDel = await call(`/groups/${code}/expenses/${dinner.id}`, 'DELETE');
  assert.equal(afterDel.data.expenses.length, 1);
});

test('validation rejects bad input', async () => {
  assert.equal((await call('/groups', 'POST', { name: '', members: ['a', 'b'] })).status, 400);
  assert.equal((await call('/groups', 'POST', { name: 'X', members: ['solo'] })).status, 400);
  assert.equal((await call('/groups/NOPE99')).status, 404);

  const { data } = await call('/groups', 'POST', { name: 'V', members: ['a', 'b'] });
  const { data: s } = await call('/groups/' + data.code);
  const [a, b] = s.members.map((m) => m.id);
  const base = { description: 'x', paidBy: a, splitAmong: [a, b] };
  assert.equal((await call(`/groups/${data.code}/expenses`, 'POST', { ...base, amount: -5 })).status, 400);
  assert.equal((await call(`/groups/${data.code}/expenses`, 'POST', { ...base, amount: 5, paidBy: 9999 })).status, 400);
  assert.equal((await call(`/groups/${data.code}/settle`, 'POST', { from: a, to: a, amount: 5 })).status, 400);
});

test('unequal splits and editing an expense', async () => {
  const { data } = await call('/groups', 'POST', { name: 'Split modes', members: ['a', 'b', 'c'] });
  const code = data.code;
  const { data: s } = await call('/groups/' + code);
  const [a, b, c] = s.members.map((m) => m.id);

  // 60/40 percent split of 100, paid by a
  const pct = await call(`/groups/${code}/expenses`, 'POST', {
    description: 'Hotel', amount: 100, paidBy: a, splitType: 'percent', split: { [a]: 60, [b]: 40 }, date: '2026-01-05',
  });
  assert.equal(pct.status, 201);
  assert.equal(pct.data.net[b], -4000);
  assert.equal(pct.data.expenses[0].spent_on, '2026-01-05');

  // exact amounts that don't add up are rejected
  const badExact = await call(`/groups/${code}/expenses`, 'POST', {
    description: 'Taxi', amount: 30, paidBy: a, splitType: 'exact', split: { [a]: 10, [b]: 10 },
  });
  assert.equal(badExact.status, 400);

  // edit the hotel into a 3-way share split
  const id = pct.data.expenses[0].id;
  const edited = await call(`/groups/${code}/expenses/${id}`, 'PUT', {
    description: 'Hotel (fixed)', amount: 120, paidBy: b, splitType: 'shares', split: { [a]: 1, [b]: 1, [c]: 2 },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.expenses[0].description, 'Hotel (fixed)');
  assert.equal(edited.data.net[b], 12000 - 3000);
  assert.equal(edited.data.net[c], -6000);
});
