const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.NODE_ENV = 'test';
process.env.DB_FILE = path.join(os.tmpdir(), `starsplit-test-${process.pid}.db`);
for (const f of fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(`starsplit-test-${process.pid}`))) fs.rmSync(path.join(os.tmpdir(), f));
const mail = require('../src/mail');
const outbox = [];
mail.sendMail = async (m) => { outbox.push(m); };
const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');

let base, server;
test.before(async () => {
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api`;
});
test.after(() => { server.close(); for (const f of fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(`starsplit-test-${process.pid}`))) { try { fs.rmSync(path.join(os.tmpdir(), f), { force: true }); } catch { /* still open on Windows */ } } });

let cookie = '';
const call = async (path, method = 'GET', body, { jar = true } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(jar && cookie ? { Cookie: cookie } : {}) },
    body: body && JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (jar && set) cookie = set.split(';')[0];
  return { status: res.status, data: await res.json(), setCookie: set };
};

test('accounts: signup, me, logout, login, and the API is locked without a session', async () => {
  assert.equal((await call('/groups', 'POST', { name: 'x', members: ['a', 'b'] }, { jar: false })).status, 401);

  const weak = await call('/auth/signup', 'POST', { name: 'Ana', email: 'ana@example.com', password: 'short' });
  assert.equal(weak.status, 400);
  const up = await call('/auth/signup', 'POST', { name: 'Ana', email: 'Ana@Example.com', password: 'correct horse' });
  assert.equal(up.status, 201);
  assert.match(up.setCookie, /HttpOnly/i);
  assert.equal((await call('/auth/me')).data.user.email, 'ana@example.com');
  assert.equal((await call('/auth/signup', 'POST', { name: 'Ana', email: 'ana@example.com', password: 'correct horse' })).status, 409);

  await call('/auth/logout', 'POST');
  cookie = '';
  assert.equal((await call('/auth/me')).data.user, null);
  assert.equal((await call('/auth/login', 'POST', { email: 'ana@example.com', password: 'wrong pass' })).status, 401);
  assert.equal((await call('/auth/login', 'POST', { email: 'ana@example.com', password: 'correct horse' })).status, 200);
});

test('forgot and reset password', async () => {
  const before = cookie;
  cookie = '';
  await call('/auth/signup', 'POST', { name: 'Cy', email: 'cy@example.com', password: 'first password' });
  cookie = '';
  // unknown emails get the same answer and no email is sent
  assert.equal((await call('/auth/forgot', 'POST', { email: 'nobody@example.com' })).status, 200);
  assert.equal(outbox.length, 0);
  await call('/auth/forgot', 'POST', { email: 'CY@example.com' });
  assert.equal(outbox.length, 1);
  const token = outbox[0].text.match(/#\/reset\/([\w-]+)/)[1];

  assert.equal((await call('/auth/reset', 'POST', { token: 'nope', password: 'new password 1' })).status, 400);
  const reset = await call('/auth/reset', 'POST', { token, password: 'new password 1' });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.user.email, 'cy@example.com');
  // the link works once
  assert.equal((await call('/auth/reset', 'POST', { token, password: 'again password' })).status, 400);
  cookie = '';
  assert.equal((await call('/auth/login', 'POST', { email: 'cy@example.com', password: 'first password' })).status, 401);
  assert.equal((await call('/auth/login', 'POST', { email: 'cy@example.com', password: 'new password 1' })).status, 200);
  cookie = before;
});

test('groups are linked to the accounts that create or open them', async () => {
  const { data } = await call('/groups', 'POST', { name: 'Mine', members: ['a', 'b'] });
  const mine = (await call('/me/groups')).data.groups;
  assert.ok(mine.some((g) => g.code === data.code));

  // a second user sees it only after opening the invite code
  const ana = cookie;
  cookie = '';
  await call('/auth/signup', 'POST', { name: 'Ben', email: 'ben@example.com', password: 'another one' });
  assert.equal((await call('/me/groups')).data.groups.length, 0);
  await call('/groups/' + data.code);
  assert.equal((await call('/me/groups')).data.groups[0].code, data.code);
  await call('/me/groups/' + data.code, 'DELETE');
  assert.equal((await call('/me/groups')).data.groups.length, 0);
  cookie = ana;
});

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

test('rename the group, rename and remove people', async () => {
  const { data } = await call('/groups', 'POST', { name: 'Old name', members: ['a', 'b', 'c'] });
  const code = data.code;
  const { data: s } = await call('/groups/' + code);
  const [a, b, c] = s.members.map((m) => m.id);

  const renamed = await call('/groups/' + code, 'PATCH', { name: 'New name' });
  assert.equal(renamed.data.group.name, 'New name');

  const person = await call(`/groups/${code}/members/${b}`, 'PATCH', { name: 'Bea' });
  assert.equal(person.data.members.find((m) => m.id === b).name, 'Bea');
  const clash = await call(`/groups/${code}/members/${b}`, 'PATCH', { name: 'A' });
  assert.equal(clash.status, 400);

  // someone in the ledger can't be removed; someone untouched can
  await call(`/groups/${code}/expenses`, 'POST', { description: 'Lunch', amount: 20, paidBy: a, splitAmong: [a, b] });
  assert.equal((await call(`/groups/${code}/members/${b}`, 'DELETE')).status, 409);
  const removed = await call(`/groups/${code}/members/${c}`, 'DELETE');
  assert.equal(removed.status, 200);
  assert.equal(removed.data.members.length, 2);

  // and the group never drops below two people
  assert.equal((await call(`/groups/${code}/members/${a}`, 'DELETE')).status, 400);
});

test('guest access: one call gives a working session, and a guest cannot be logged into by password', async () => {
  const before = cookie;
  cookie = '';
  const g = await call('/auth/guest', 'POST');
  assert.equal(g.status, 201);
  assert.equal(g.data.user.name, 'Guest');
  assert.match(g.setCookie, /HttpOnly/i);
  assert.equal((await call('/auth/me')).data.user.name, 'Guest');
  const made = await call('/groups', 'POST', { name: 'Demo', currency: 'INR', members: ['A', 'B'] });
  assert.equal(made.status, 201);
  assert.equal((await call('/me/groups')).data.groups.length, 1);
  cookie = '';
  const login = await call('/auth/login', 'POST', { email: g.data.user.email, password: '' });
  assert.equal(login.status, 401);
  assert.equal(login.data.error, 'Wrong email or password');
  cookie = before;
});
